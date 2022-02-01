import * as constructs from "constructs"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as sns from "aws-cdk-lib/aws-sns"
import { Duration } from "aws-cdk-lib"
import * as path from "path"

export interface SlackAlarmProps {
  projectName: string
  envName: string
  slackChannel: string
  slackUrl: string
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
      runtime: lambda.Runtime.PYTHON_3_8,
      timeout: Duration.seconds(6),
      environment: {
        SLACK_URL: props.slackUrl,
        SLACK_CHANNEL: props.slackChannel,
        PROJECT_NAME: props.projectName,
        ENVIRONMENT_NAME: props.envName,
      },
    })

    slackLambda.addPermission("InvokePermission", {
      action: "lambda:InvokeFunction",
      principal: new iam.ServicePrincipal("sns.amazonaws.com"),
      sourceArn: this.alarmTopic.topicArn,
    })

    new sns.Subscription(this, "Subscription", {
      endpoint: slackLambda.functionArn,
      protocol: sns.SubscriptionProtocol.LAMBDA,
      topic: this.alarmTopic,
    })
  }
}
