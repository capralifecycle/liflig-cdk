import type { Handler } from "aws-lambda"

import {
  ECSClient,
  DescribeTaskDefinitionCommand,
  RegisterTaskDefinitionCommand,
  UpdateServiceCommand,
  DescribeServicesCommand,
  TaskDefinition,
  Service,
  RegisterTaskDefinitionCommandInput,
} from "@aws-sdk/client-ecs"

import {
  SecretsManagerClient,
  UpdateSecretCommand,
} from "@aws-sdk/client-secrets-manager"

interface ExpectedInput {
  tag: string
}

// This function is inline-compiled for the lambda.
// It must be self-contained.
export const handler: Handler<Partial<ExpectedInput>> = async (event) => {
  const ecsClient = new ECSClient()
  const smClient = new SecretsManagerClient()

  function requireEnv(name: string): string {
    const value = process.env[name]
    if (value === undefined) {
      throw new Error(`Missing ${name}`)
    }
    return value
  }

  async function getService(
    clusterName: string,
    serviceName: string,
  ): Promise<Service> {
    const services = await ecsClient.send(
      new DescribeServicesCommand({
        cluster: clusterName,
        services: [serviceName],
      }),
    )

    if (services.services?.length !== 1) {
      throw new Error(`Service not found: ${clusterName}/${serviceName}`)
    }

    return services.services[0]
  }

  async function getTaskDefinition(
    taskDefinition: string,
  ): Promise<TaskDefinition> {
    return (
      await ecsClient.send(
        new DescribeTaskDefinitionCommand({ taskDefinition }),
      )
    ).taskDefinition!
  }

  async function updateServiceToImage(
    clusterName: string,
    serviceName: string,
    image: string,
  ) {
    console.log(`Cluster name: ${clusterName}`)
    console.log(`Service name: ${serviceName}`)

    const service = await getService(clusterName, serviceName)
    const prevTaskDefinition = await getTaskDefinition(service.taskDefinition!)

    // Don't bother updating the service if the image is already the latest.
    const prevImage = prevTaskDefinition.containerDefinitions![0].image!
    if (prevImage === image) {
      return
    }

    console.log(
      `Updating image for service '${serviceName}' from '${prevImage}' to '${image}'`,
    )

    const exclude = [
      "registeredAt",
      "registeredBy",
      "compatibilities",
      "requiresAttributes",
      "revision",
      "status",
      "taskDefinitionArn",
    ]

    const updatedSpec: RegisterTaskDefinitionCommandInput = {
      ...Object.fromEntries(
        Object.entries(prevTaskDefinition).filter(
          ([key]) => !exclude.includes(key),
        ),
      ),
      containerDefinitions: [
        {
          ...prevTaskDefinition.containerDefinitions![0],
          image,
        },
      ],
    } as RegisterTaskDefinitionCommandInput

    const updatedTaskDefinition = (
      await ecsClient.send(new RegisterTaskDefinitionCommand(updatedSpec))
    ).taskDefinition!

    await ecsClient.send(
      new UpdateServiceCommand({
        cluster: clusterName,
        service: serviceName,
        taskDefinition: updatedTaskDefinition.taskDefinitionArn,
      }),
    )
    console.log("Service is updated")
  }

  const clusterName = requireEnv("CLUSTER_NAME")
  const serviceName = requireEnv("SERVICE_NAME")
  const repositoryUrl = requireEnv("REPOSITORY_URL")
  const ecrTagSecretArn = requireEnv("ECR_TAG_SECRET_ARN")

  // Validate the input.
  if (typeof event.tag !== "string") {
    throw new Error("Input invalid: " + JSON.stringify(event, undefined, "  "))
  }

  // Register tag as current target.
  // This is needed so that CloudFormation deployments, e.g.
  // updates to the Task Definition, will use the same image.
  await smClient.send(
    new UpdateSecretCommand({
      SecretId: ecrTagSecretArn,
      SecretString: JSON.stringify({
        tag: event.tag,
      }),
    }),
  )

  // Update the service if we know the service name. This is unknown
  // during initial deployment of the stack.
  if (serviceName !== "") {
    const image = `${repositoryUrl}:${event.tag}`
    await updateServiceToImage(clusterName, serviceName, image)
  }

  return {}
}
