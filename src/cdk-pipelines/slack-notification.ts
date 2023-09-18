import * as constructs from "constructs"
import * as codepipeline from "aws-cdk-lib/aws-codepipeline"
import * as eventsTargets from "aws-cdk-lib/aws-events-targets"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as cdk from "aws-cdk-lib"
import * as path from "path"
import * as s3 from "aws-cdk-lib/aws-s3"

export interface SlackNotificationProps {
  /**
   * CodePipeline to monitor.
   */
  pipeline: codepipeline.IPipeline
  /**
   * Artifacts bucket used by pipeline
   */
  artifactsBucket: s3.IBucket
  /**
   * Slack webhook URL.
   */
  slackWebhookUrl: string
  /**
   * Channel name including leading #.
   */
  slackChannel: string
  /**
   * An optional friendly name that will be used in the Slack notifications instead of the AWS account ID
   */
  accountFriendlyName?: string
  /**
   * Control the amount and types of notifications being sent to Slack.
   * "WARN" is the least verbose, while "DEBUG" is the most verbose.
   *
   * "WARN" - Includes notifications related to the failure of a pipeline execution.
   * "INFO" - Adds notifications for the success of a pipeline execution.
   * "DEBUG" - Adds notifications for the start and superseding of a pipeline execution.
   *
   * @default "WARN"
   */
  notificationLevel?: "WARN" | "INFO" | "DEBUG"
  /**
   * The key of the object (e.g., `my-prefix/my-file.json`) that triggers the S3 Source Action associated with the pipeline.
   * By configuring this parameter you can specify which objects the Lambda function that sends messages to Slack can access in the artifacts bucket.
   *
   * @default - the Lambda function can read all objects in the artifacts bucket.
   */
  triggerObjectKey?: string
  /**
   * Used to control that only one lambda is created in the account.
   *
   * Specify a value here when you manually create a {@link SlackNotification} for a pipeline
   * without using {@link LifligCdkPipeline.addSlackNotification}.
   * For example: `"65f7a9e0-d0a4-4ba7-ad1f-6dec853bbdb8"`.
   *
   * @default "55954fc8-182e-497e-bd60-7af1496dc222"
   */
  singletonLambdaUuid?: string
}

/**
 * Monitor a CodePipeline and send message to Slack on failure
 * and some succeeded events.
 */
export class SlackNotification extends constructs.Construct {
  constructor(
    scope: constructs.Construct,
    id: string,
    props: SlackNotificationProps,
  ) {
    super(scope, id)

    const environment: Record<string, string> = {
      SLACK_URL: props.slackWebhookUrl,
      SLACK_CHANNEL: props.slackChannel,
      NOTIFICATION_LEVEL: props.notificationLevel ?? "WARN",
    }

    if (props.accountFriendlyName != null) {
      environment.ACCOUNT_FRIENDLY_NAME = props.accountFriendlyName
    }

    const reportFunction = new lambda.SingletonFunction(this, "Function", {
      uuid: props.singletonLambdaUuid ?? "55954fc8-182e-497e-bd60-7af1496dc222",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../assets/pipeline-slack-notification-lambda"),
      ),
      handler: "index.handler",
      runtime: lambda.Runtime.PYTHON_3_11,
      timeout: cdk.Duration.seconds(10),
      environment,
      description:
        "Handle CodePipeline pipeline state change and report to Slack",
    })

    reportFunction.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "codepipeline:ListActionExecutions",
          "codepipeline:ListPipelineExecutions",
        ],
        resources: [props.pipeline.pipelineArn],
      }),
    )

    props.artifactsBucket.grantRead(reportFunction, props.triggerObjectKey)

    props.pipeline.onStateChange("Event" + (props.singletonLambdaUuid ?? ""), {
      eventPattern: {
        detail: {
          // Available states: https://docs.aws.amazon.com/codepipeline/latest/userguide/detect-state-changes-cloudwatch-events.html
          state: ["SUCCEEDED", "FAILED", "STARTED", "SUPERSEDED"],
        },
      },
      target: new eventsTargets.LambdaFunction(reportFunction),
    })
  }
}
