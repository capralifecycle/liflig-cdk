import { Handler } from "aws-lambda"

import {
  CodeBuildClient,
  BatchGetBuildsCommand,
  StatusType,
  Build,
} from "@aws-sdk/client-codebuild"

import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs"

interface StatusExpectedInput {
  jobId: string
}

export const handler: Handler<Partial<StatusExpectedInput>> = async (event) => {
  const codeBuildClient = new CodeBuildClient()
  const cloudWatchLogsClient = new CloudWatchLogsClient()

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
  function getSuccess(status: StatusType): boolean | null {
    if (status == "SUCCEEDED") {
      return true
    }

    if (status == "IN_PROGRESS") {
      return null
    }

    return false
  }

  async function getBuild(buildId: string): Promise<Build> {
    const { builds } = await codeBuildClient.send(
      new BatchGetBuildsCommand({ ids: [buildId] }),
    )

    if (builds?.length !== 1) {
      throw new Error(`Expected 1 item, found ${builds?.length ?? "unknown"}`)
    }

    return builds[0]
  }

  async function getLogs(build: Build): Promise<string> {
    if (build.logs == null) {
      throw new Error("Missing logs attribute on build")
    }

    if (build.logs.groupName == null) {
      throw new Error("Missing log groupName")
    }

    if (build.logs.streamName == null) {
      throw new Error("Missing log streamName")
    }

    const { events } = await cloudWatchLogsClient.send(
      new GetLogEventsCommand({
        logGroupName: build.logs.groupName,
        logStreamName: build.logs.streamName,
        startFromHead: true,
      }),
    )

    if (events == null) {
      throw new Error("Failed to fetch log events")
    }

    // The logs contain newlines, so no need to add more.
    return events.map((it) => it.message).join("")
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
