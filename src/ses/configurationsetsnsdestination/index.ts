import * as constructs from "constructs"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as sns from "aws-cdk-lib/aws-sns"
import * as cdk from "aws-cdk-lib"
import * as cr from "aws-cdk-lib/custom-resources"
import { configurationSetSnsDestinationHandler } from "./handler"
import { RetentionDays } from "aws-cdk-lib/aws-logs"
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions"
import { SNSHandler } from "aws-lambda"

export type ConfigurationSetSnsDestinationEventType =
  | "SEND"
  | "REJECT"
  | "BOUNCE"
  | "COMPLAINT"
  | "DELIVERY"
  | "OPEN"
  | "CLICK"
  | "RENDERING_FAILURE"
  | "DELIVERY_DELAY"
  | "SUBSCRIPTION"

export interface ConfigurationSetSnsDestinationProps {
  /**
   * Whether SES events will be logged to CloudWatch
   * @default true
   */
  logEvents?: boolean
  /**
   * The SES configuration set name
   */
  configurationSetName: string
  /**
   * The SES configuration set event destination name
   */
  eventDestinationName: string
  /**
   * SNS topic to send bounces to
   */
  snsTopic: sns.ITopic
  /**
   * Event types to match
   */
  matchingEventTypes: ConfigurationSetSnsDestinationEventType[]
}

export class ConfigurationSetSnsDestination extends constructs.Construct {
  constructor(
    scope: constructs.Construct,
    id: string,
    props: ConfigurationSetSnsDestinationProps,
  ) {
    super(scope, id)

    new cdk.CustomResource(this, "Resource", {
      serviceToken:
        ConfigurationSetSnsDestinationProvider.getOrCreate(this).serviceToken,
      properties: {
        ConfigurationSetName: props.configurationSetName,
        EventDestinationName: props.eventDestinationName,
        SnsTopicArn: props.snsTopic.topicArn,
        MatchingEventTypes: props.matchingEventTypes,
        Serial: 1,
      },
    })

    const sesEventLoggerFunction = new lambda.Function(this, "EventsHandler", {
      code: new lambda.InlineCode(
        `exports.handler = ${sesEventLoggerHandler.toString()};`,
      ),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_16_X,
      logRetention: RetentionDays.THREE_MONTHS,
    })

    if (props.logEvents ?? true) {
      props.snsTopic.addSubscription(
        new snsSubscriptions.LambdaSubscription(sesEventLoggerFunction),
      )
    }
  }
}

const sesEventLoggerHandler: SNSHandler = (event) => {
  event.Records.forEach((record) =>
    console.log(`SES event message from SNS: ${record.Sns.Message}`),
  )
}

class ConfigurationSetSnsDestinationProvider extends constructs.Construct {
  /**
   * Returns the singleton provider.
   */
  public static getOrCreate(scope: constructs.Construct) {
    const stack = cdk.Stack.of(scope)
    const id = "liflig-cdk.configuration-set-sns-destination"
    return (
      (stack.node.tryFindChild(id) as ConfigurationSetSnsDestinationProvider) ||
      new ConfigurationSetSnsDestinationProvider(stack, id)
    )
  }

  private readonly provider: cr.Provider
  public readonly serviceToken: string

  constructor(scope: constructs.Construct, id: string) {
    super(scope, id)

    this.provider = new cr.Provider(this, "Provider", {
      onEventHandler: new lambda.Function(this, "Function", {
        code: new lambda.InlineCode(
          `exports.handler = ${configurationSetSnsDestinationHandler.toString()};`,
        ),
        handler: "index.handler",
        runtime: lambda.Runtime.NODEJS_16_X,
        timeout: cdk.Duration.minutes(5),
        initialPolicy: [
          new iam.PolicyStatement({
            actions: [
              "ses:CreateConfigurationSetEventDestination",
              "ses:UpdateConfigurationSetEventDestination",
              "ses:DeleteConfigurationSetEventDestination",
              "ses:GetConfigurationSetEventDestinations",
            ],
            resources: ["*"],
          }),
        ],
      }),
    })

    this.serviceToken = this.provider.serviceToken
  }
}
