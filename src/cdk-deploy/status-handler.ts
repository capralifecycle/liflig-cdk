/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-var-requires */
import { Handler } from "aws-lambda"
import type * as _AWS from "aws-sdk"

interface StatusExpectedInput {
  jobId: string
}

// This function is inline-compiled for the lambda.
// It must be self-contained.
export const statusHandler: Handler<Partial<StatusExpectedInput>> = async (
  event,
) => {
  const AWS = require("aws-sdk")

  function requireEnv(name: string): string {
    const value = process.env[name]
    if (value === undefined) {
      throw new Error(`Missing ${name}`)
    }
    return value
  }

  /**
   * Get success status.
   *
   * A value of true means the job has completed successfully, while
   * a value of false means the job did complete but not successfully.
   *
   * A null value means the job is still in progress and the
   * completion status is not yet known.
   */
  function getSuccess(status: AWS.CodeBuild.StatusType): boolean | null {
    if (status == "SUCCEEDED") {
      return true
    }

    if (status == "IN_PROGRESS") {
      return null
    }

    return false
  }

  async function getBuild(buildId: string): Promise<AWS.CodeBuild.Build> {
    const codebuild: AWS.CodeBuild = new AWS.CodeBuild() as _AWS.CodeBuild
    const result = await codebuild.batchGetBuilds({ ids: [buildId] }).promise()

    if (result.builds?.length !== 1) {
      throw new Error(
        `Expected 1 item, found ${result.builds?.length ?? "unknown"}`,
      )
    }

    return result.builds[0]
  }

  async function getLogs(build: AWS.CodeBuild.Build) {
    if (build.logs == null) {
      throw new Error("Missing logs attribute on build")
    }

    if (build.logs.groupName == null) {
      throw new Error("Missing log groupName")
    }

    if (build.logs.streamName == null) {
      throw new Error("Missing log streamName")
    }

    const cloudwatchlogs: AWS.CloudWatchLogs = new AWS.CloudWatchLogs() as _AWS.CloudWatchLogs
    const data = await cloudwatchlogs
      .getLogEvents({
        logGroupName: build.logs.groupName,
        logStreamName: build.logs.streamName,
        startFromHead: true,
      })
      .promise()

    if (data.events == null) {
      throw new Error("Failed to fetch log events")
    }

    // The logs contain newlines, so no need to add more.
    return data.events.map((it) => it.message).join("")
  }

  const projectName = requireEnv("PROJECT_NAME")

  // Validate the input.
  if (
    typeof event.jobId !== "string" ||
    !event.jobId.startsWith(`${projectName}:`)
  ) {
    throw new Error("Input invalid: " + JSON.stringify(event, undefined, "  "))
  }

  const build = await getBuild(event.jobId)

  const success =
    build.buildStatus == null ? null : getSuccess(build.buildStatus)

  // Read logs from CloudWatch if completed.
  const logs = success != null ? await getLogs(build) : null

  return {
    jobId: event.jobId,
    success,
    logs,
  }
}
