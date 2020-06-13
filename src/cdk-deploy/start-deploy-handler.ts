/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-var-requires */
import { Handler } from "aws-lambda"
import type * as _AWS from "aws-sdk"

interface StartDeployExpectedInput {
  bucketName: string
  bucketKey: string
  stackNames: string[]
}

// This function is inline-compiled for the lambda.
// It must be self-contained.
export const startDeployHandler: Handler<Partial<
  StartDeployExpectedInput
>> = async (event, context) => {
  const AWS = require("aws-sdk")

  const codebuild = new AWS.CodeBuild() as _AWS.CodeBuild
  const s3 = new AWS.S3() as _AWS.S3

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

  async function put(name: string, data: AWS.S3.Body) {
    await s3
      .putObject({
        Bucket: bucketName,
        Key: `${s3KeyPrefix}${name}`,
        Body: data,
      })
      .promise()
  }

  await put("stack-names.txt", event.stackNames.join(" "))
  // Ensure that we run the script using same feature flags.
  await put(
    "cdk.json",
    JSON.stringify({
      context: cdkContext,
    }),
  )

  const build = await codebuild
    .startBuild({
      projectName,
      sourceTypeOverride: "S3",
      sourceLocationOverride: `${bucketName}/${s3KeyPrefix}`,
      secondarySourcesOverride: [
        {
          type: "S3",
          location: `${event.bucketName}/${event.bucketKey}`,
          sourceIdentifier: "CLOUDASSEMBLY",
        },
      ],
    })
    .promise()

  const buildId = build.build?.id
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
