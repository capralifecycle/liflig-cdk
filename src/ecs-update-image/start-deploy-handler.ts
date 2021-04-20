/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-var-requires */
import type { Handler } from "aws-lambda"
import type * as _AWS from "aws-sdk"

interface ExpectedInput {
  tag: string
}

// This function is inline-compiled for the lambda.
// It must be self-contained.
export const startDeployHandler: Handler<Partial<ExpectedInput>> = async (
  event,
) => {
  const AWS = require("aws-sdk")
  const ecs = new AWS.ECS() as _AWS.ECS
  const sm = new AWS.SecretsManager() as _AWS.SecretsManager

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
  ): Promise<AWS.ECS.Service> {
    const services = await ecs
      .describeServices({
        cluster: clusterName,
        services: [serviceName],
      })
      .promise()

    if (services.services?.length !== 1) {
      throw new Error(`Service not found: ${clusterName}/${serviceName}`)
    }

    return services.services[0]
  }

  async function getTaskDefinition(
    taskDefinition: string,
  ): Promise<AWS.ECS.TaskDefinition> {
    return (
      await ecs
        .describeTaskDefinition({
          taskDefinition: taskDefinition,
        })
        .promise()
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatedSpec: any = {
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
    }

    const updatedTaskDefinition = (
      await ecs.registerTaskDefinition(updatedSpec).promise()
    ).taskDefinition!

    await ecs
      .updateService({
        cluster: clusterName,
        service: serviceName,
        taskDefinition: updatedTaskDefinition.taskDefinitionArn,
      })
      .promise()

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
  await sm
    .updateSecret({
      SecretId: ecrTagSecretArn,
      SecretString: JSON.stringify({
        tag: event.tag,
      }),
    })
    .promise()

  // Update the service if we know the service name. This is unknown
  // during initial deployment of the stack.
  if (serviceName !== "") {
    const image = `${repositoryUrl}:${event.tag}`
    await updateServiceToImage(clusterName, serviceName, image)
  }

  return {}
}
