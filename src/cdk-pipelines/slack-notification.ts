import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as cdk from "aws-cdk-lib"
import type * as codepipeline from "aws-cdk-lib/aws-codepipeline"
import * as eventsTargets from "aws-cdk-lib/aws-events-targets"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import type * as s3 from "aws-cdk-lib/aws-s3"
import type * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import * as constructs from "constructs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
  /**
   * Slack mentions to include in failure notifications (only on new failures, not repeated ones).
   * Use special mentions (@here, @channel, @everyone) or user/group IDs (e.g., 'U1234567890', 'S9876543210').
   * @default - none
   */
  mentions?: string[]
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

    if (props.mentions != null && props.mentions.length > 0) {
      environment.SLACK_MENTIONS = SlackMention.format(props.mentions)
    }

    const reportFunction = new lambda.Function(this, "Function", {
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../assets/pipeline-slack-notification-lambda"),
      ),
      handler: "index.handler",
      runtime: lambda.Runtime.PYTHON_3_13,
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

/**
 * Slack mention formatter with validation per Slack API format:
 * https://docs.slack.dev/messaging/formatting-message-text/
 *
 * Supported mention types:
 * - Special mentions: @here, @channel, @everyone
 * - User IDs: U or W prefix + alphanumeric (e.g., U024BE7LH, W024BE7LH)
 * - User group IDs: S prefix + alphanumeric (e.g., SAZ94GDB8)
 *
 * Usage:
 *   SlackMention.format(['@here', 'U024BE7LH', 'SAZ94GDB8'])
 */
export class SlackMention {
  private static readonly SPECIAL_MENTIONS = [
    "@here",
    "@channel",
    "@everyone",
  ] as const

  // Note: Slack doesn't specify length constraints for these identifiers, leaving them unbounded
  private static readonly USER_PATTERN = /^[UW][A-Z0-9]+$/
  private static readonly USER_GROUP_PATTERN = /^S[A-Z0-9]+$/

  /**
   * Format an array of mentions into a single Slack-formatted string.
   * @param mentions Array of mention strings
   */
  static format(mentions: string[]): string {
    return mentions.map((m) => SlackMention.formatMention(m)).join(" ")
  }

  /**
   * Format a mention string for Slack API message format.
   * Validates format and converts to proper Slack markup:
   *   '@here' -> '<!here>'
   *   'U1234567890' -> '<@U1234567890>'
   *   'S1234567890' -> '<!subteam^S1234567890>'
   *
   * @param mention Mention string (e.g., '@here', 'U1234567890', 'S1234567890')
   * @throws if mention format is invalid
   */
  static formatMention(mention: string): string {
    if (mention.startsWith("@")) {
      return SlackMention.formatSpecialMention(mention)
    }
    if (mention.startsWith("U") || mention.startsWith("W")) {
      return SlackMention.formatUser(mention)
    }
    if (mention.startsWith("S")) {
      return SlackMention.formatUserGroup(mention)
    }
    throw new Error(`Unknown Slack mention format: ${mention}`)
  }

  private static formatSpecialMention(mention: string): string {
    if (
      !SlackMention.SPECIAL_MENTIONS.includes(
        mention as "@here" | "@channel" | "@everyone",
      )
    ) {
      throw new Error(`Invalid special mention: ${mention}`)
    }
    return `<!${mention.substring(1)}>`
  }

  private static formatUser(mention: string): string {
    if (!SlackMention.USER_PATTERN.test(mention)) {
      throw new Error(`Invalid user ID: ${mention}`)
    }
    return `<@${mention}>`
  }

  private static formatUserGroup(mention: string): string {
    if (!SlackMention.USER_GROUP_PATTERN.test(mention)) {
      throw new Error(`Invalid user group ID: ${mention}`)
    }
    return `<!subteam^${mention}>`
  }
}
