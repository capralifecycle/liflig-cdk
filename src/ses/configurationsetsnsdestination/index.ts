/** biome-ignore-all lint/suspicious/useIterableCallbackReturn: ignore newly added rule */
import { createRequire } from "node:module"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as cdk from "aws-cdk-lib"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs"
import { RetentionDays } from "aws-cdk-lib/aws-logs"
import type * as sns from "aws-cdk-lib/aws-sns"
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions"
import * as cr from "aws-cdk-lib/custom-resources"
import type { SNSHandler } from "aws-lambda"
import * as constructs from "constructs"

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
      runtime: lambda.Runtime.NODEJS_22_X,
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
      onEventHandler: new NodejsFunction(this, "Function", {
        entry: require.resolve(`${__dirname}/handler`),
        runtime: lambda.Runtime.NODEJS_22_X,
        timeout: cdk.Duration.minutes(5),
        awsSdkConnectionReuse: false,
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
