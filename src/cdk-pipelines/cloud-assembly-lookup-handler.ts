/* eslint-disable @typescript-eslint/no-var-requires */
import type { Handler } from "aws-lambda"
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"
import {
  CodePipelineClient,
  PutJobFailureResultCommand,
  PutJobSuccessResultCommand,
} from "@aws-sdk/client-codepipeline"
import { Upload } from "@aws-sdk/lib-storage"

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

    console.log("Parsing user parameters")
    const userParameters = JSON.parse(
      userParametersRaw,
    ) as CloudAssemblyLookupUserParameters

    console.log("Fetching reference data from S3")
    const getReferenceDataResp = await s3Client.send(
      new GetObjectCommand({
        Bucket: userParameters.bucketName,
        Key: userParameters.objectKey,
      }),
    )
    const referenceData =
      await getReferenceDataResp.Body!.transformToString("utf-8")

    console.log("Parsing reference data from S3")
    const cloudAssemblyReference = JSON.parse(
      referenceData,
    ) as CloudAssemblyReference

    const outputArtifact = event["CodePipeline.job"].data.outputArtifacts[0]
    const s3Loc = outputArtifact.location.s3Location

    console.log("Fetching Cloud Assembly ZIP data from S3")
    const cloudAssemblyZipData = await s3Client.send(
      new GetObjectCommand({
        Bucket: cloudAssemblyReference.cloudAssemblyBucketName,
        Key: cloudAssemblyReference.cloudAssemblyBucketKey,
      }),
    )
    console.log(
      "Content-Length of Cloud Assembly (bytes)",
      cloudAssemblyZipData.ContentLength,
    )

    console.log("Creating authenticated S3 client for artifact upload")
    const artifactCreds = event["CodePipeline.job"].data.artifactCredentials
    if (artifactCreds === undefined) {
      console.error("No artifact credentials found in job event")
    }
    const authedS3Client = new S3Client({
      credentials: artifactCreds,
    })

    console.log(
      `Uploading Cloud Assembly ZIP to s3://${s3Loc.bucketName}/${s3Loc.objectKey}`,
    )

    const upload = new Upload({
      client: authedS3Client,
      params: {
        Bucket: s3Loc.bucketName,
        Key: s3Loc.objectKey,
        Body: cloudAssemblyZipData.Body,
      },
    })

    upload.on("httpUploadProgress", (progress) => {
      console.log(progress)
    })

    await upload.done()

    console.log("Sending success result to CodePipeline")
    await codepipelineClient.send(
      new PutJobSuccessResultCommand({
        jobId,
      }),
    )
    console.log("Success")
  } catch (e) {
    console.log("Sending failure result to CodePipeline")
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
