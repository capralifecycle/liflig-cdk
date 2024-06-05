/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Handler } from "aws-lambda"

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import {
  CodeBuildClient,
  StartBuildCommand,
  SourceType,
} from "@aws-sdk/client-codebuild"

interface StartDeployExpectedInput {
  bucketName: string
  bucketKey: string
  stackNames: string[]
}

// noinspection JSUnusedGlobalSymbols
export const handler: Handler<Partial<StartDeployExpectedInput>> = async (
  event,
  context,
) => {
  const codeBuildClient = new CodeBuildClient()
  const s3Client = new S3Client()

  function requireEnv(name: string): string {
    const value = process.env[name]
    if (value === undefined) {
      throw new Error(`Missing ${name}`)
    }
    return value
  }

  const projectName = requireEnv("PROJECT_NAME")
  const bucketName = requireEnv("BUCKET_NAME")
  const cdkContext = JSON.parse(requireEnv("CDK_CONTEXT"))

  // Since we pass the stack names as strings to the shell,
  // be a bit restrictive of the valid values we can use.
  const validStackName = /^[a-z0-9_][a-z0-9\-_]*$/i
  const s3KeyPrefix = `${context.awsRequestId}/`

  // Validate the input.
  if (
    typeof event.bucketName !== "string" ||
    typeof event.bucketKey !== "string" ||
    !Array.isArray(event.stackNames) ||
    !event.stackNames.every(
      (it) => typeof it === "string" && validStackName.test(it),
    )
  ) {
    throw new Error("Input invalid: " + JSON.stringify(event, undefined, "  "))
  }

  async function putObject(name: string, data: string) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: `${s3KeyPrefix}${name}`,
        Body: data,
      }),
    )
  }

  await putObject("stack-names.txt", event.stackNames.join(" "))
  // Ensure that we run the script using same feature flags.
  await putObject("cdk.json", JSON.stringify({ context: cdkContext }))

  const { build } = await codeBuildClient.send(
    new StartBuildCommand({
      projectName,
      sourceTypeOverride: SourceType.S3,
      sourceLocationOverride: `${bucketName}/${s3KeyPrefix}`,
      secondarySourcesOverride: [
        {
          type: SourceType.S3,
          location: `${event.bucketName}/${event.bucketKey}`,
          sourceIdentifier: "CLOUDASSEMBLY",
        },
      ],
    }),
  )
  const buildId = build?.id

  if (buildId == null) {
    throw new Error("Unknown build ID")
  }

  return {
    // This is the value the caller will use to fetch updated status.
    // Avoid exposing what kind of ID this is, because we should be free
    // to change implementation details.
    jobId: buildId,
  }
}
