import * as constructs from "constructs"
import * as codepipeline from "aws-cdk-lib/aws-codepipeline"
import * as eventsTargets from "aws-cdk-lib/aws-events-targets"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as cdk from "aws-cdk-lib"
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
  accountGroupName?: string
  /**
   * @default no description
   */
  accountDescription?: string
  /**
   * @default false
   */
  alwaysShowSucceeded?: boolean

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
      ALWAYS_SHOW_SUCCEEDED: String(props.alwaysShowSucceeded ?? false),
    }

    if (props.accountGroupName != null) {
      environment.ACCOUNT_GROUP_NAME = props.accountGroupName
    }

    if (props.accountDescription != null) {
      environment.ACCOUNT_DESC = props.accountDescription
    }

    const reportFunction = new lambda.SingletonFunction(this, "Function", {
      uuid: props.singletonLambdaUuid ?? "55954fc8-182e-497e-bd60-7af1496dc222",
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

    props.pipeline.onStateChange("Event" + (props.singletonLambdaUuid ?? ""), {
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
