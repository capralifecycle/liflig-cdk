import * as constructs from "constructs"
import * as codepipeline from "aws-cdk-lib/aws-codepipeline"
import * as eventsTargets from "aws-cdk-lib/aws-events-targets"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as cdk from "aws-cdk-lib"
import * as path from "path"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"

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
   * A plaintext secret containing the URL of a Slack incoming webhook.
   * The webhook should be created through a Slack app, and only allows posting to one specific Slack channel.
   * See Slack's official documentation (e.g., https://api.slack.com/messaging/webhooks) for more details.
   *
   * NOTE: Incoming webhooks created through legacy custom integrations in Slack are not supported.
   */
  slackWebhookUrlSecret: secretsmanager.ISecret
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
      SLACK_URL_SECRET_NAME: props.slackWebhookUrlSecret.secretName,
      NOTIFICATION_LEVEL: props.notificationLevel ?? "WARN",
    }

    if (props.accountFriendlyName != null) {
      environment.ACCOUNT_FRIENDLY_NAME = props.accountFriendlyName
    }

    const reportFunction = new lambda.Function(this, "Function", {
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

    props.slackWebhookUrlSecret.grantRead(reportFunction)

    props.artifactsBucket.grantRead(reportFunction, props.triggerObjectKey)

    props.pipeline.onStateChange(`Event${id}`, {
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
