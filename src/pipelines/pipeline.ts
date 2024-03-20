import * as constructs from "constructs"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as events from "aws-cdk-lib/aws-events"
import * as eventsTargets from "aws-cdk-lib/aws-events-targets"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as sfn from "aws-cdk-lib/aws-stepfunctions"
import { Condition } from "aws-cdk-lib/aws-stepfunctions"
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks"
import * as cdk from "aws-cdk-lib"
import type { Handler } from "aws-lambda"
import type * as _AWS from "aws-sdk"
import { getGriidArtefactBucket } from "../griid"
import { pipelineS3Prefix, pipelineS3TriggerKey } from "./conventions"
import { DeployEnv } from "./deploy-env"

export interface PipelineProps {
  /**
   * Bucket holding pipeline configuration and trigger file.
   *
   * @default - use existing bucket based on Griid conventions
   */
  artifactsBucket?: s3.IBucket
  /**
   * Environments for this pipeline. Each environment is deployed sequentially
   * in the order given.
   */
  environments: PipelineEnvironment[]
  /**
   * Name of pipeline. This is used for the path where configuration
   * is stored in S3.
   */
  pipelineName: string
  /**
   * Trigger the pipeline when the trigger file is written.
   *
   * @default - true
   */
  triggerEnabled?: boolean
  /**
   * VPC used for Fargate resources.
   */
  vpc: ec2.IVpc
}

export interface PipelineEnvironment {
  /**
   * Account number hosting the environment.
   */
  accountId: string
  /**
   * Additional tasks to run after the environment has been deployed.
   */
  afterSuccessfulDeploy?: sfn.Chain
  /**
   * Name of environment.
   */
  name: string
}

/**
 * Pipeline for doing a multi-account CDK deployment based
 * on a built CDK Cloud Assembly and parameters stored in S3.
 *
 * The accounts being deployed to must be provisioned with
 * the LifligCdkDeployerDeps construct so expected IAM
 * roles is present.
 *
 * The pipeline starts by writing an empty file to
 * s3://<artifacts-bucket>/pipelines/<pipeline-name>/trigger
 *
 * The CDK deploy process is handled by liflig-cdk-deployer.
 * See https://github.com/capralifecycle/liflig-cdk-deployer
 *
 * Configuration files are read from S3 at the path
 * s3://<artifacts-bucket>/pipelines/<pipeline-name>/
 *
 *  - cloud-assembly.json which has the format described as
 *    CDK_CLOUD_ASSEMBLY in liflig-cdk-deployer
 *
 *  - variables*.json which can be zero or more files
 *    with string-string map that will be concatenated to
 *    form the format described as CDK_VARIABLES in
 *    liflig-cdk-deployer
 *
 * The separation of Cloud Assembly details and variables enables
 * separation of IaC code and application code if they are not
 * colocated in the same repository.
 */
export class Pipeline extends constructs.Construct {
  constructor(scope: constructs.Construct, id: string, props: PipelineProps) {
    super(scope, id)

    const s3Prefix = pipelineS3Prefix(props.pipelineName)
    const s3TriggerKey = pipelineS3TriggerKey(props.pipelineName)

    const artifactsBucket =
      props.artifactsBucket ?? getGriidArtefactBucket(this)

    const checkCanRunFn = new lambda.SingletonFunction(this, "CheckCanRunFn", {
      uuid: "30ad3abb-f774-4804-a6ef-2c2f4a247362",
      code: new lambda.InlineCode(
        `exports.handler = ${checkCanRunHandler.toString()};`,
      ),
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: "index.handler",
      timeout: cdk.Duration.seconds(10),
    })

    const checkCanRunTask = new tasks.LambdaInvoke(
      this,
      "Check if the process can run",
      {
        lambdaFunction: checkCanRunFn,
        outputPath: "$.Payload",
        payload: sfn.TaskInput.fromObject({
          "stateMachineId.$": "$$.StateMachine.Id",
          "executionId.$": "$$.Execution.Id",
        }),
      },
    )

    const wait = new sfn.Wait(this, "Wait before rechecking status", {
      time: sfn.WaitTime.duration(cdk.Duration.seconds(15)),
    })

    const skip = new sfn.Succeed(this, "Skip")

    const collectFilesFn = new lambda.SingletonFunction(
      this,
      "CollectFilesFn",
      {
        uuid: "c49cbfe1-50e0-4721-8964-fb20f4e5a7ad",
        code: new lambda.InlineCode(
          `exports.handler = ${collectFilesHandler.toString()};`,
        ),
        runtime: lambda.Runtime.NODEJS_16_X,
        handler: "index.handler",
        timeout: cdk.Duration.seconds(30),
      },
    )

    artifactsBucket.grantRead(collectFilesFn)

    const collectFilesTask = new tasks.LambdaInvoke(
      this,
      "Collect files from S3",
      {
        lambdaFunction: collectFilesFn,
        outputPath: "$.Payload",
        payload: sfn.TaskInput.fromObject({
          bucketName: artifactsBucket.bucketName,
          bucketPrefix: s3Prefix,
          envNames: props.environments.map((it) => it.name),
        }),
      },
    )

    let run: sfn.Chain = sfn.Chain.start(collectFilesTask)

    const ifHavingStacks = (name: string, work: sfn.Chain) =>
      new sfn.Choice(this, `Check if ${name} has stacks`)
        .when(
          Condition.or(
            Condition.isNull(`$.StackCountPerEnv.${name}`),
            Condition.numberEquals(`$.StackCountPerEnv.${name}`, 0),
          ),
          new sfn.Pass(this, `Skip ${name}`),
        )
        .otherwise(work)
        .afterwards()

    for (const env of props.environments) {
      const it = new DeployEnv(this, env.name, {
        accountId: env.accountId,
        afterSuccessfulDeploy: env.afterSuccessfulDeploy,
        artefactBucket: artifactsBucket,
        envName: env.name,
        vpc: props.vpc,
      })

      run = run.next(ifHavingStacks(env.name, it.chain))
    }

    const definition: sfn.Chain = sfn.Chain.start(checkCanRunTask).next(
      new sfn.Choice(this, "Can run?")
        .when(Condition.stringEquals("$.CanRunState", "CONTINUE"), run)
        .when(Condition.stringEquals("$.CanRunState", "SKIP"), skip)
        .otherwise(wait.next(checkCanRunTask)),
    )

    const machine = new sfn.StateMachine(this, "StateMachine", {
      definition,
      // https://docs.aws.amazon.com/step-functions/latest/dg/sfn-stuck-execution.html
      timeout: cdk.Duration.hours(3),
    })

    new iam.Policy(this, "CheckCanRunPolicy", {
      roles: [checkCanRunFn.role!],
      statements: [
        new iam.PolicyStatement({
          actions: ["states:ListExecutions"],
          resources: [machine.stateMachineArn],
        }),
      ],
    })

    if (props.triggerEnabled ?? true) {
      artifactsBucket.onCloudTrailWriteObject("Trigger", {
        paths: [s3TriggerKey],
        target: new eventsTargets.SfnStateMachine(machine, {
          input: events.RuleTargetInput.fromObject({}),
        }),
      })
    }
  }
}

interface CloudAssembly {
  cloudAssemblyBucketName: string
  cloudAssemblyBucketKey: string
  environments: {
    name: string
    stackNames: string[]
  }[]
  parameters: {
    name: string
    value: unknown
  }[]
}

// This is a self-contained function that will be serialized as a lambda.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const collectFilesHandler: Handler = async (event: Record<string, any>) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires,@typescript-eslint/no-unsafe-assignment
  const AWS = require("aws-sdk")
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
  const s3 = new AWS.S3() as _AWS.S3

  console.log("Event received: ", event)

  const bucketName = event.bucketName as string
  const bucketPrefix = event.bucketPrefix as string
  const envNames = event.envNames as string[]

  if (bucketPrefix.slice(-1) !== "/") {
    throw new Error(
      `Expected bucket prefix to end with '/' but its value is '${bucketPrefix}'`,
    )
  }

  const files = await s3
    .listObjectsV2({
      Bucket: bucketName,
      Prefix: bucketPrefix,
    })
    .promise()

  async function getData(key: string): Promise<string> {
    const result = await s3
      .getObject({
        Bucket: bucketName,
        Key: key,
      })
      .promise()
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return result.Body!.toString()
  }

  let cloudAssembly: CloudAssembly | null = null
  let variables: Record<string, string> = {}

  for (const file of files.Contents ?? []) {
    const key = file.Key!
    const filename = key.slice(bucketPrefix.length)

    console.log(`File: ${filename}`)

    if (filename === "cloud-assembly.json") {
      console.log("Found Cloud Assembly")
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      cloudAssembly = JSON.parse(await getData(key))
    } else if (/^variables.*\.json$/.test(filename)) {
      console.log("Found variables file")
      variables = {
        ...variables,
        ...(JSON.parse(await getData(key)) as Record<string, string>),
      }
    } else {
      console.log("Ignoring unknown file")
    }
  }

  if (cloudAssembly === null) {
    throw new Error("cloud-assembly.json not found")
  }

  return {
    CloudAssembly: JSON.stringify(cloudAssembly),
    Variables: JSON.stringify(variables),
    StackCountPerEnv: Object.fromEntries(
      envNames.map((name) => [
        name,
        cloudAssembly!.environments.find((it) => it.name === name)?.stackNames
          .length ?? 0,
      ]),
    ),
  }
}

// This is a self-contained function that will be serialized as a lambda.
const checkCanRunHandler: Handler = async (event: Record<string, string>) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires,@typescript-eslint/no-unsafe-assignment
  const AWS = require("aws-sdk")
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call,@typescript-eslint/no-unsafe-member-access
  const sf = new AWS.StepFunctions() as _AWS.StepFunctions

  console.log("Event received: ", event)

  const stateMachineArn = event["stateMachineId"]
  const currentExecutionArn = event["executionId"]

  const executions = (
    await sf
      .listExecutions({
        stateMachineArn,
        statusFilter: "RUNNING",
      })
      .promise()
  ).executions

  console.log("Executions: ", executions)

  const currentExecution = executions.find(
    (it) => it.executionArn == currentExecutionArn,
  )

  if (!currentExecution) {
    throw new Error("Could not find current execution")
  }

  const newer = executions.filter(
    (it) => it.startDate > currentExecution.startDate,
  ).length

  return {
    CanRunState:
      newer > 0 ? "SKIP" : executions.length == 1 ? "CONTINUE" : "WAIT",
  }
}
