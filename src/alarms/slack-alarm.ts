import * as constructs from "constructs"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as iam from "aws-cdk-lib/aws-iam"
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as sns from "aws-cdk-lib/aws-sns"
import { Duration } from "aws-cdk-lib"
import * as path from "path"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"

export interface SlackAlarmProps {
  projectName: string
  envName: string
  /**
   * A plaintext secret containing the URL of a Slack incoming webhook.
   * The webhook should be created through a Slack app, and only allows posting to one specific Slack channel.
   * See Slack's official documentation (e.g., https://api.slack.com/messaging/webhooks) for more details.
   *
   * NOTE: Incoming webhooks created through legacy custom integrations in Slack are not supported.
   */
  slackWebhookUrlSecret: secretsmanager.ISecret
}

/**
 * SNS Topic that can be used to action alarms, with a Lambda
 * that will send a message to Slack for the alarm.
 */
export class SlackAlarm extends constructs.Construct {
  public readonly alarmTopic: sns.Topic
  public readonly snsAction: cloudwatchActions.SnsAction

  constructor(scope: constructs.Construct, id: string, props: SlackAlarmProps) {
    super(scope, id)

    this.alarmTopic = new sns.Topic(this, "Topic")

    this.snsAction = new cloudwatchActions.SnsAction(this.alarmTopic)

    const slackLambda = new lambda.Function(this, "Function", {
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../../assets/slack-alarm-lambda"),
      ),
      description:
        "Receives CloudWatch Alarms through SNS and sends a formatted version to Slack",
      handler: "index.handler",
      memorySize: 128,
      runtime: lambda.Runtime.PYTHON_3_11,
      timeout: Duration.seconds(6),
      environment: {
        SLACK_URL_SECRET_NAME: props.slackWebhookUrlSecret.secretName,
        PROJECT_NAME: props.projectName,
        ENVIRONMENT_NAME: props.envName,
      },
    })

    props.slackWebhookUrlSecret.grantRead(slackLambda)

    slackLambda.addPermission("InvokePermission", {
      action: "lambda:InvokeFunction",
      principal: new iam.ServicePrincipal("sns.amazonaws.com"),
      sourceArn: this.alarmTopic.topicArn,
    })
    slackLambda.addToRolePolicy(
      new PolicyStatement({
        actions: ["cloudwatch:DescribeAlarms"],
        effect: Effect.ALLOW,
        resources: ["*"],
      }),
    )

    new sns.Subscription(this, "Subscription", {
      endpoint: slackLambda.functionArn,
      protocol: sns.SubscriptionProtocol.LAMBDA,
      topic: this.alarmTopic,
    })
  }
}
