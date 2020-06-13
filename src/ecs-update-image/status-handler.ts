/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-var-requires */
import type { Handler } from "aws-lambda"
import type * as _AWS from "aws-sdk"

interface Response {
  /**
   * The tag is unknown when the stack is not yet fully set up
   * during initial account/service deployment.
   */
  currentTag: string | null
  stabilized: boolean
}

// This function is inline-compiled for the lambda.
// It must be self-contained.
export const statusHandler: Handler<unknown, Response> = async () => {
  const AWS = require("aws-sdk")
  const ecs = new AWS.ECS() as _AWS.ECS

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

  /**
   * Check if the service is considered to be stabilized.
   *
   * Uses the logic described at
   * https://docs.aws.amazon.com/cli/latest/reference/ecs/wait/services-stable.html
   */
  function isStabilized(service: AWS.ECS.Service): boolean {
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
