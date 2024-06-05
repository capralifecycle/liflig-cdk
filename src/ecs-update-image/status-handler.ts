import type { Handler } from "aws-lambda"
import {
  ECSClient,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  Service,
  TaskDefinition,
} from "@aws-sdk/client-ecs"

interface Response {
  /**
   * The tag is unknown when the stack is not yet fully set up
   * during initial account/service deployment.
   */
  currentTag: string | null
  stabilized: boolean
}

export const handler: Handler<unknown, Response> = async () => {
  const ecsClient = new ECSClient()

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
    const resp = await ecsClient.send(
      new DescribeTaskDefinitionCommand({ taskDefinition }),
    )
    return resp.taskDefinition!
  }

  /**
   * Check if the service is considered to be stabilized.
   *
   * Uses the logic described at
   * https://docs.aws.amazon.com/cli/latest/reference/ecs/wait/services-stable.html
   */
  function isStabilized(service: Service): boolean {
    return (
      service.deployments?.length == 1 &&
      service.runningCount == service.desiredCount
    )
  }

  function extractTag(image: string): string | null {
    if (!image.includes(":")) {
      return null
    }
    return image.replace(/.*:/, "")
  }

  const clusterName = requireEnv("CLUSTER_NAME")
  const serviceName = requireEnv("SERVICE_NAME")

  // The service name is unknown during initial deployment of the stack.
  // In this case we return stabilized status as true.
  if (serviceName === "") {
    return {
      currentTag: null,
      stabilized: true,
    }
  }

  const service = await getService(clusterName, serviceName)
  const mainDeployment = service.deployments?.find(
    (it) => it.status === "PRIMARY",
  )

  const taskDefinition = await getTaskDefinition(
    mainDeployment!.taskDefinition!,
  )

  // Only one container is supported for the task definition.

  return {
    currentTag: extractTag(taskDefinition.containerDefinitions![0].image!),
    stabilized: isStabilized(service),
  }
}
