/* eslint-disable @typescript-eslint/no-var-requires */
import type { Handler } from "aws-lambda"

// Relevant fields from
// https://docs.amazonaws.cn/en_us/lambda/latest/dg/services-codepipeline.html
interface CodePipelineEvent {
  "CodePipeline.job": {
    id: string
    data: {
      actionConfiguration: {
        configuration: {
          // JSON
          UserParameters: string
        }
      }
      outputArtifacts: {
        name: string
        location: {
          s3Location: {
            bucketName: string
            objectKey: string
          }
        }
      }[]
      artifactCredentials: {
        accessKeyId: string
        secretAccessKey: string
        sessionToken: string
      }
    }
  }
}

interface CloudAssemblyReference {
  cloudAssemblyBucketName: string
  cloudAssemblyBucketKey: string
}

export interface CloudAssemblyLookupUserParameters {
  bucketName: string
  objectKey: string
}

// This is a self-contained function that will be serialized as a lambda.
export const cloudAssemblyLookupHandler: Handler = async (
  event: CodePipelineEvent,
  context,
) => {
  const AWS = require("aws-sdk") as typeof import("aws-sdk")
  const s3 = new AWS.S3()
  const codepipeline = new AWS.CodePipeline()

  const jobId = event["CodePipeline.job"].id

  try {
    const userParametersRaw =
      event["CodePipeline.job"].data.actionConfiguration.configuration
        .UserParameters

    console.log("User parameters", userParametersRaw)

    const userParameters = JSON.parse(
      userParametersRaw,
    ) as CloudAssemblyLookupUserParameters

    const referenceData = await s3
      .getObject({
        Bucket: userParameters.bucketName,
        Key: userParameters.objectKey,
      })
      .promise()
      .then((it) => it.Body!.toString())

    const cloudAssemblyReference = JSON.parse(
      referenceData,
    ) as CloudAssemblyReference

    const outputArtifact = event["CodePipeline.job"].data.outputArtifacts[0]
    const s3Loc = outputArtifact.location.s3Location

    const cloudAssemblyZipData = await s3
      .getObject({
        Bucket: cloudAssemblyReference.cloudAssemblyBucketName,
        Key: cloudAssemblyReference.cloudAssemblyBucketKey,
      })
      .promise()

    console.log("Size of Cloud Assembly", cloudAssemblyZipData.ContentLength)

    await new AWS.S3({
      credentials: event["CodePipeline.job"].data.artifactCredentials,
    })
      .putObject({
        Bucket: s3Loc.bucketName,
        Key: s3Loc.objectKey,
        Body: cloudAssemblyZipData.Body,
      })
      .promise()

    await codepipeline
      .putJobSuccessResult({
        jobId,
      })
      .promise()

    console.log("Success")
  } catch (e) {
    await codepipeline
      .putJobFailureResult({
        failureDetails: {
          message: JSON.stringify(e),
          type: "JobFailed",
          externalExecutionId: context.awsRequestId,
        },
        jobId,
      })
      .promise()

    console.error("Failed", e)
  }
}
