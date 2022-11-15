import * as constructs from "constructs"
import * as codepipeline from "aws-cdk-lib/aws-codepipeline"
import * as codebuild from "aws-cdk-lib/aws-codebuild"
import * as codepipelineActions from "aws-cdk-lib/aws-codepipeline-actions"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as cdk from "aws-cdk-lib"
import * as pipelines from "aws-cdk-lib/pipelines"
import * as fs from "fs"
import * as path from "path"
import { getGriidArtefactBucket } from "../griid/artefact-bucket"
import {
  cloudAssemblyLookupHandler,
  CloudAssemblyLookupUserParameters,
} from "./cloud-assembly-lookup-handler"
import { SlackNotification, SlackNotificationProps } from "./slack-notification"

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
  /**
   * The namespace used for parameters in Parameter Store.
   *
   * Only relevant for sourceType of "cdk-soruce".
   *
   * @default default
   */
  parametersNamespace?: string
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
export class LifligCdkPipeline extends constructs.Construct {
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

  public readonly cdkPipeline: pipelines.CodePipeline
  public readonly codePipeline: codepipeline.Pipeline

  constructor(
    scope: constructs.Construct,
    id: string,
    props: LifligCdkPipelineProps,
  ) {
    super(scope, id)

    const artifactsBucket =
      props.artifactsBucket ?? getGriidArtefactBucket(this)

    const cloudAssemblyArtifact = new codepipeline.Artifact()

    let synth: pipelines.IFileSetProducer
    let stages: codepipeline.StageProps[]

    switch (props.sourceType) {
      case "cloud-assembly":
        const cloudAssembly = this.cloudAssemblyStage(
          cloudAssemblyArtifact,
          artifactsBucket,
          props.pipelineName,
        )
        synth = cloudAssembly.synth
        stages = cloudAssembly.stages
        break
      case "cdk-source":
        const cdkSource = this.cdkSourceStage(
          cloudAssemblyArtifact,
          artifactsBucket,
          props.pipelineName,
          props.parametersNamespace ?? "default",
        )
        synth = cdkSource.synth
        stages = cdkSource.stages
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

    this.cdkPipeline = new pipelines.CodePipeline(this, "CdkPipeline", {
      synth,
      codePipeline: this.codePipeline,
      synthCodeBuildDefaults: {
        buildEnvironment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_6_0,
        },
      },
    })
  }

  private static getAwsCdkPackageJsonFile(): string | undefined {
    // Also look up the tree a bit to handle yarn workspaces.
    const candidates = [
      path.join(process.cwd(), "node_modules/aws-cdk/package.json"),
      path.join(process.cwd(), "../node_modules/aws-cdk/package.json"),
      path.join(process.cwd(), "../../node_modules/aws-cdk/package.json"),
      path.join(process.cwd(), "../../../node_modules/aws-cdk/package.json"),
    ]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }

    return undefined
  }

  private cloudAssemblyStage(
    cloudAssemblyArtifact: codepipeline.Artifact,
    cdkBucket: s3.IBucket,
    pipelineName: string,
  ): { stages: codepipeline.StageProps[]; synth: pipelines.IFileSetProducer } {
    const cloudAssemblyLookupFn = new lambda.Function(
      this,
      "CloudAssemblyLookupFn",
      {
        code: new lambda.InlineCode(
          `exports.handler = ${cloudAssemblyLookupHandler.toString()};`,
        ),
        handler: "index.handler",
        runtime: lambda.Runtime.NODEJS_16_X,
        timeout: cdk.Duration.minutes(1),
        memorySize: 512,
      },
    )

    cdkBucket.grantReadWrite(cloudAssemblyLookupFn)

    const userParameters: CloudAssemblyLookupUserParameters = {
      bucketName: cdkBucket.bucketName,
      objectKey: `pipelines/${pipelineName}/cloud-assembly.json`,
    }

    const synth = pipelines.CodePipelineFileSet.fromArtifact(
      cloudAssemblyArtifact,
    )

    const stages = [
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
    return { stages, synth }
  }

  private cdkSourceStage(
    cloudAssemblyArtifact: codepipeline.Artifact,
    cdkBucket: s3.IBucket,
    pipelineName: string,
    parametersNamespace: string,
  ): { stages: codepipeline.StageProps[]; synth: pipelines.IFileSetProducer } {
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

    const account = cdk.Stack.of(this).account
    const region = cdk.Stack.of(this).region

    prepareCdkSourceFn.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParametersByPath"],
        resources: [
          `arn:aws:ssm:${region}:${account}:parameter/liflig-cdk/*/pipeline-variables/*`,
        ],
      }),
    )

    cdkBucket.grantReadWrite(prepareCdkSourceFn)

    const cdkSourceArtifact = new codepipeline.Artifact()

    const userParameters: PrepareCdkSourceUserParameters = {
      bucketName: cdkBucket.bucketName,
      prefix: `pipelines/${pipelineName}/`,
      parametersNamespace: parametersNamespace,
    }

    const synth = new pipelines.ShellStep("GenerateCloudAssembly", {
      input: pipelines.CodePipelineFileSet.fromArtifact(cdkSourceArtifact),
      installCommands: ["npm ci"],
      commands: ["npx cdk synth"],
    })
    const stages = [
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
    ]
    return { stages, synth }
  }

  addSlackNotification(props: Omit<SlackNotificationProps, "pipeline">): void {
    new SlackNotification(this, "Slack", {
      pipeline: this.codePipeline,
      ...props,
    })
  }
}

interface PrepareCdkSourceUserParameters {
  bucketName: string
  prefix: string
  parametersNamespace: string
}
