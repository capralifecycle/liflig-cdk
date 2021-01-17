import * as codepipeline from "@aws-cdk/aws-codepipeline"
import * as codepipelineActions from "@aws-cdk/aws-codepipeline-actions"
import * as lambda from "@aws-cdk/aws-lambda"
import * as s3 from "@aws-cdk/aws-s3"
import * as cdk from "@aws-cdk/core"
import * as pipelines from "@aws-cdk/pipelines"
import * as path from "path"
import { getGriidArtefactBucket } from "../griid/artefact-bucket"
import {
  cloudAssemblyLookupHandler,
  CloudAssemblyLookupUserParameters,
} from "./cloud-assembly-lookup-handler"

export interface LifligCdkPipelineProps {
  /**
   * Bucket holding pipeline configuration and trigger file.
   *
   * @default - use existing bucket based on Griid conventions
   */
  artifactsBucket?: s3.IBucket
  /**
   * Name of pipeline. This is used for the path where configuration
   * is stored in S3.
   */
  pipelineName: string
  /**
   * Type of uploaded artifact. This changes the behaviour of the
   * pipeline and what kind of process it performs.
   *
   * Two types are supported:
   *
   *   - cdk-source: The uploaded artifact represents a CDK application
   *     as source code. A build step will compile this into a
   *     CDK Cloud Assembly.
   *
   *     As part of synthesizing this into a CDK Cloud Assembly,
   *     a file "variables.json" will be written for the
   *     CDK application to parameterize the build if any
   *     variables are found in the pipeline source.
   *
   *   - cloud-assembly: The uploaded artifact represents a
   *     CDK Cloud Assembly which is ready for deployment.
   *
   *     This does not support reading variables at the current time
   *     since CDK Pipelines don't support parameterized deploys.
   *     See https://github.com/aws/aws-cdk/issues/9560
   */
  sourceType: "cdk-source" | "cloud-assembly"
}

/**
 * CDK Pipeline for Liflig.
 *
 * Avoid putting multiple pipelines in a stack, since the pipeline
 * will also keep the hosting stack up-to-date.
 *
 * The pipeline is executed by writing an empty file to
 * s3://<artifacts-bucket>/pipelines/<pipeline-name>/trigger
 *
 * Configuration files are read from S3 at the path
 * s3://<artifacts-bucket>/pipelines/<pipeline-name>/
 *
 * For upload type "cdk-source":
 *
 *   - cdk-source.json holding a pointer to the active CDK source
 *     that should be used. Schema:
 *
 *     {
 *       bucketName: string
 *       bucketKey: string
 *     }
 *
 *   - variables*.json which can be zero or more files
 *     with string-string map holding variables that will
 *     be written to variables.json and can be read by the
 *     the CDK application during synthesize.
 *
 * For upload type "cloud-assembly":
 *
 *   - cloud-assembly.json holding a pointer to the active
 *     CDK Cloud Assembly that should be used: Schema:
 *
 *     {
 *       cloudAssemblyBucketName: string
 *       cloudAssemblyBucketKey: string
 *     }
 *
 * Variables enables separation of IaC code and application code if
 * they are not colocated in the same repository.
 */
export class LifligCdkPipeline extends cdk.Construct {
  /**
   * Path on S3 for pipeline configuration.
   */
  static pipelineS3Prefix(pipelineName: string): string {
    return `pipelines/${pipelineName}/`
  }

  /**
   * Key in S3 bucket used to trigger pipeline.
   *
   * This is an empty file within the pipeline path.
   */
  static pipelineS3TriggerKey(pipelineName: string): string {
    return `pipelines/${pipelineName}/trigger`
  }

  public readonly cdkPipeline: pipelines.CdkPipeline
  public readonly codePipeline: codepipeline.Pipeline

  constructor(scope: cdk.Construct, id: string, props: LifligCdkPipelineProps) {
    super(scope, id)

    const artifactsBucket =
      props.artifactsBucket ?? getGriidArtefactBucket(this)

    const cloudAssemblyArtifact = new codepipeline.Artifact()

    let stages: codepipeline.StageProps[]

    switch (props.sourceType) {
      case "cloud-assembly":
        stages = this.cloudAssemblyStage(
          cloudAssemblyArtifact,
          artifactsBucket,
          props.pipelineName,
        )
        break
      case "cdk-source":
        stages = this.cdkSourceStage(
          cloudAssemblyArtifact,
          artifactsBucket,
          props.pipelineName,
        )
        break
    }

    const dummyArtifact = new codepipeline.Artifact()

    this.codePipeline = new codepipeline.Pipeline(this, "CodePipeline", {
      pipelineName: props.pipelineName,
      stages: [
        {
          stageName: "Source",
          actions: [
            new codepipelineActions.S3SourceAction({
              actionName: "source",
              bucket: artifactsBucket,
              bucketKey: LifligCdkPipeline.pipelineS3TriggerKey(
                props.pipelineName,
              ),
              output: dummyArtifact,
            }),
          ],
        },
        ...stages,
      ],
      restartExecutionOnUpdate: true,
    })

    this.cdkPipeline = new pipelines.CdkPipeline(this, "CdkPipeline", {
      cloudAssemblyArtifact: cloudAssemblyArtifact,
      codePipeline: this.codePipeline,
    })
  }

  private cloudAssemblyStage(
    cloudAssemblyArtifact: codepipeline.Artifact,
    cdkBucket: s3.IBucket,
    pipelineName: string,
  ): codepipeline.StageProps[] {
    const cloudAssemblyLookupFn = new lambda.Function(
      this,
      "CloudAssemblyLookupFn",
      {
        code: new lambda.InlineCode(
          `exports.handler = ${cloudAssemblyLookupHandler.toString()};`,
        ),
        handler: "index.handler",
        runtime: lambda.Runtime.NODEJS_12_X,
        timeout: cdk.Duration.minutes(1),
        memorySize: 512,
      },
    )

    cdkBucket.grantReadWrite(cloudAssemblyLookupFn)

    const userParameters: CloudAssemblyLookupUserParameters = {
      bucketName: cdkBucket.bucketName,
      objectKey: `pipelines/${pipelineName}/cloud-assembly.json`,
    }

    return [
      {
        stageName: "PrepareCloudAssembly",
        actions: [
          new codepipelineActions.LambdaInvokeAction({
            actionName: "cloud-assembly-lookup",
            lambda: cloudAssemblyLookupFn,
            outputs: [cloudAssemblyArtifact],
            userParameters,
          }),
        ],
      },
    ]
  }

  private cdkSourceStage(
    cloudAssemblyArtifact: codepipeline.Artifact,
    cdkBucket: s3.IBucket,
    pipelineName: string,
  ): codepipeline.StageProps[] {
    const prepareCdkSourceFn = new lambda.Function(this, "PrepareCdkSourceFn", {
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../assets/prepare-cdk-source-lambda"),
      ),
      handler: "index.handler",
      // Using python instead if NodeJS due to zip-support in stdlib.
      runtime: lambda.Runtime.PYTHON_3_8,
      timeout: cdk.Duration.minutes(1),
      memorySize: 512,
    })

    cdkBucket.grantReadWrite(prepareCdkSourceFn)

    const cdkSourceArtifact = new codepipeline.Artifact()

    const userParameters: PrepareCdkSourceUserParameters = {
      bucketName: cdkBucket.bucketName,
      prefix: `pipelines/${pipelineName}/`,
    }

    return [
      {
        stageName: "PrepareCdkSource",
        actions: [
          new codepipelineActions.LambdaInvokeAction({
            actionName: "prepare-cdk-source",
            lambda: prepareCdkSourceFn,
            outputs: [cdkSourceArtifact],
            userParameters,
          }),
        ],
      },
      {
        stageName: "GenerateCloudAssembly",
        actions: [
          pipelines.SimpleSynthAction.standardNpmSynth({
            cloudAssemblyArtifact,
            sourceArtifact: cdkSourceArtifact,
          }),
        ],
      },
    ]
  }
}

interface PrepareCdkSourceUserParameters {
  bucketName: string
  prefix: string
}
