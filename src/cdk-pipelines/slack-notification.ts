import * as codepipeline from "@aws-cdk/aws-codepipeline"
import * as eventsTargets from "@aws-cdk/aws-events-targets"
import * as iam from "@aws-cdk/aws-iam"
import * as lambda from "@aws-cdk/aws-lambda"
import * as cdk from "@aws-cdk/core"
import * as path from "path"

export interface SlackNotificationProps {
  /**
   * CodePipeline to monitor.
   */
  pipeline: codepipeline.IPipeline
  /**
   * Slack webhook URL.
   */
  slackWebhookUrl: string
  /**
   * Channel name including leading #.
   */
  slackChannel: string
  /**
   * @default no description
   */
  accountDescription?: string
  /**
   * @default false
   */
  alwaysShowSucceeded?: boolean
}

/**
 * Monitor a CodePipeline and send message to Slack on failure
 * and some succeeded events.
 */
export class SlackNotification extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string, props: SlackNotificationProps) {
    super(scope, id)

    const environment: Record<string, string> = {
      SLACK_URL: props.slackWebhookUrl,
      SLACK_CHANNEL: props.slackChannel,
      ALWAYS_SHOW_SUCCEEDED: String(props.alwaysShowSucceeded ?? false),
    }

    if (props.accountDescription != null) {
      environment.ACCOUNT_DESC = props.accountDescription
    }

    const reportFunction = new lambda.SingletonFunction(this, "Function", {
      uuid: "55954fc8-182e-497e-bd60-7af1496dc222",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../assets/pipeline-slack-notification-lambda"),
      ),
      handler: "index.handler",
      runtime: lambda.Runtime.PYTHON_3_8,
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

    props.pipeline.onStateChange("Event", {
      eventPattern: {
        detail: {
          // Available states: https://docs.aws.amazon.com/codepipeline/latest/userguide/detect-state-changes-cloudwatch-events.html
          state: ["SUCCEEDED", "FAILED"],
        },
      },
      target: new eventsTargets.LambdaFunction(reportFunction),
    })
  }
}
