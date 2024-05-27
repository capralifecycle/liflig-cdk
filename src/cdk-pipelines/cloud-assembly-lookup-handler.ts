/* eslint-disable @typescript-eslint/no-var-requires */
import type { Handler } from "aws-lambda"
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import {
  CodePipelineClient,
  PutJobFailureResultCommand,
  PutJobSuccessResultCommand,
} from "@aws-sdk/client-codepipeline"

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

export const handler: Handler = async (event: CodePipelineEvent, context) => {
  const s3Client = new S3Client()
  const codepipelineClient = new CodePipelineClient()

  const jobId = event["CodePipeline.job"].id

  try {
    const userParametersRaw =
      event["CodePipeline.job"].data.actionConfiguration.configuration
        .UserParameters

    console.log("User parameters", userParametersRaw)

    const userParameters = JSON.parse(
      userParametersRaw,
    ) as CloudAssemblyLookupUserParameters

    const getReferenceDataResp = await s3Client.send(
      new GetObjectCommand({
        Bucket: userParameters.bucketName,
        Key: userParameters.objectKey,
      }),
    )
    const referenceData = getReferenceDataResp.Body!.toString()

    const cloudAssemblyReference = JSON.parse(
      referenceData,
    ) as CloudAssemblyReference

    const outputArtifact = event["CodePipeline.job"].data.outputArtifacts[0]
    const s3Loc = outputArtifact.location.s3Location

    const cloudAssemblyZipData = await s3Client.send(
      new GetObjectCommand({
        Bucket: cloudAssemblyReference.cloudAssemblyBucketName,
        Key: cloudAssemblyReference.cloudAssemblyBucketKey,
      }),
    )
    console.log("Size of Cloud Assembly", cloudAssemblyZipData.ContentLength)

    const authedS3Client = new S3Client({
      credentials: event["CodePipeline.job"].data.artifactCredentials,
    })

    await authedS3Client.send(
      new PutObjectCommand({
        Bucket: s3Loc.bucketName,
        Key: s3Loc.objectKey,
        Body: cloudAssemblyZipData.Body,
      }),
    )

    await codepipelineClient.send(
      new PutJobSuccessResultCommand({
        jobId,
      }),
    )
    console.log("Success")
  } catch (e) {
    await codepipelineClient.send(
      new PutJobFailureResultCommand({
        failureDetails: {
          message: JSON.stringify(e),
          type: "JobFailed",
          externalExecutionId: context.awsRequestId,
        },
        jobId,
      }),
    )
    console.error("Failed", e)
  }
}
