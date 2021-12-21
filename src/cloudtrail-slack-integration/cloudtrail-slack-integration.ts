import * as cdk from "@aws-cdk/core"
import * as iam from "@aws-cdk/aws-iam"
import * as logs from "@aws-cdk/aws-logs"
import * as cloudwatch from "@aws-cdk/aws-cloudwatch"
import * as lambda from "@aws-cdk/aws-lambda"
import * as events from "@aws-cdk/aws-events"
import * as sources from "@aws-cdk/aws-lambda-event-sources"
import * as sqs from "@aws-cdk/aws-sqs"
import * as targets from "@aws-cdk/aws-events-targets"
import * as path from "path"

export interface CloudTrailSlackIntegrationProps extends cdk.StackProps {
  /**
   * A key-value pair of AWS account IDs and friendly names of these accounts
   * to use when sending messages to Slack.
   */
  accountFriendlyNames?: {
    [key: string]: string
  }
  slackWebhookUrl: string
  slackChannel: string
  /**
   * A list of ARNs of roles in the current account to monitor usage of.
   */
  rolesToMonitor?: string[]
  /**
   * Whether to monitor various IAM API calls associated with the current account's root user (e.g., console login, password reset, etc.)
   *
   * @default true
   */
  monitorRootUserActions?: boolean
  /**
   * Whether to set up additional AWS infrastructure to deduplicate CloudTrail events in order to avoid duplicate Slack messages. May be used to decrease noise.
   *
   * @default false
   */
  deduplicateEvents?: boolean
  /**
   * If supplied, CloudWatch alarms will be created for the construct's underlying infrastructure (e.g., Lambda functions) and the action will be used to notify on OK and ALARM actions.
   */
  infrastructureAlarmAction?: cloudwatch.IAlarmAction
}

/**
 * Forward a predefined set of CloudTrail API events to Slack using EventBridge, Lambda
 * and an optional SQS FIFO queue for deduplicating events.
 * The API events are limited to monitoring access to the current account's root user and/or specific IAM roles.
 *
 * NOTE: The construct needs to be provisioned in us-east-1, and requires an existing CloudTrail set up in that region.
 */
export class CloudTrailSlackIntegration extends cdk.Construct {
  constructor(
    scope: cdk.Construct,
    id: string,
    props: CloudTrailSlackIntegrationProps,
  ) {
    super(scope, id)

    const eventTransformer = new lambda.Function(
      this,
      "EventTransformerLambda",
      {
        code: lambda.Code.fromAsset(
          path.join(
            __dirname,
            "../../assets/cloudtrail-slack-integration-lambda",
          ),
        ),
        description:
          "Formats CloudTrail API calls sent through EventBridge, and posts them directly to Slack or first to an SQS FIFO queue for deduplication",
        handler: "main.handler_event_transformer",
        runtime: lambda.Runtime.PYTHON_3_9,
        timeout: cdk.Duration.seconds(15),
        logRetention: logs.RetentionDays.SIX_MONTHS,
        environment: {
          SLACK_CHANNEL: props.slackChannel,
          DEDUPLICATE_EVENTS: JSON.stringify(!!props.deduplicateEvents),
          ACCOUNT_FRIENDLY_NAMES: JSON.stringify(
            props.accountFriendlyNames || {},
          ),
          SLACK_WEBHOOK_URL: props.slackWebhookUrl,
        },
      },
    )
    eventTransformer.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["iam:ListAccountAliases"],
        resources: ["*"],
      }),
    )
    if (props.infrastructureAlarmAction) {
      const eventTransformerAlarm = eventTransformer
        .metricErrors({
          period: cdk.Duration.minutes(5),
          statistic: cloudwatch.Statistic.SUM,
        })
        .createAlarm(this, "EventTransformerErrorAlarm", {
          threshold: 1,
          evaluationPeriods: 1,
          alarmDescription:
            "Triggers if the Lambda function that transforms CloudTrail API calls received through EventBridge fails (e.g., it fails to process the event)",
          datapointsToAlarm: 1,
          treatMissingData: cloudwatch.TreatMissingData.IGNORE,
        })
      eventTransformerAlarm.addOkAction(props.infrastructureAlarmAction)
      eventTransformerAlarm.addAlarmAction(props.infrastructureAlarmAction)
    }
    if (props.deduplicateEvents) {
      const deduplicationQueue = new sqs.Queue(this, "Queue", {
        // We explicitly give the queue a name due to bug https://github.com/aws/aws-cdk/issues/5860
        queueName:
          `${this.node.id.substring(0, 33)}${this.node.addr}`.substring(0, 75) +
          ".fifo",
        fifo: true,
      })
      eventTransformer.addEnvironment(
        "SQS_QUEUE_URL",
        deduplicationQueue.queueUrl,
      )
      deduplicationQueue.grantSendMessages(eventTransformer)
      const slackForwarder = new lambda.Function(this, "SlackForwarderLambda", {
        code: lambda.Code.fromAsset(
          path.join(
            __dirname,
            "../../assets/cloudtrail-slack-integration-lambda",
          ),
        ),
        description:
          "Polls from an SQS FIFO queue containing formatted CloudTrail API calls and sends them to Slack.",
        handler: "main.handler_slack_forwarder",
        runtime: lambda.Runtime.PYTHON_3_9,
        timeout: cdk.Duration.seconds(15),
        logRetention: logs.RetentionDays.TWO_WEEKS,
      })

      if (props.infrastructureAlarmAction) {
        const slackForwarderAlarm = slackForwarder
          .metricErrors({
            period: cdk.Duration.minutes(5),
            statistic: cloudwatch.Statistic.SUM,
          })
          .createAlarm(this, "SlackForwarderErrorAlarm", {
            threshold: 1,
            alarmDescription:
              "Triggers if the Lambda function that polls from SQS and posts deduplicated CloudTrail API calls received through EventBridge to Slack fails (e.g., invalid Slack webhook URL)",
            evaluationPeriods: 1,
            datapointsToAlarm: 1,
            treatMissingData: cloudwatch.TreatMissingData.IGNORE,
          })
        slackForwarderAlarm.addOkAction(props.infrastructureAlarmAction)
        slackForwarderAlarm.addAlarmAction(props.infrastructureAlarmAction)
      }
      slackForwarder.addEventSource(
        new sources.SqsEventSource(deduplicationQueue),
      )
    }

    if (props.rolesToMonitor && props.rolesToMonitor.length > 0) {
      new events.Rule(this, "RuleForAssumeRole", {
        enabled: true,
        targets: [new targets.LambdaFunction(eventTransformer)],
        eventPattern: {
          detail: {
            eventName: ["AssumeRole"],
            requestParameters: {
              roleArn: props.rolesToMonitor,
            },
          },
        },
      })
    }

    if (props.monitorRootUserActions !== false) {
      // Triggers when the root password has been changed
      new events.Rule(this, "RuleForRootUserPasswordChange", {
        enabled: true,
        targets: [new targets.LambdaFunction(eventTransformer)],
        eventPattern: {
          detail: {
            userIdentity: {
              type: ["Root"],
            },
            eventName: ["PasswordUpdated"],
            eventType: ["AwsConsoleSignIn"],
          },
        },
      })

      // Triggers when MFA for the root user has been set up
      new events.Rule(this, "RuleForRootUserMfaChange", {
        enabled: true,
        targets: [new targets.LambdaFunction(eventTransformer)],
        eventPattern: {
          detail: {
            userIdentity: {
              type: ["Root"],
            },
            eventName: ["EnableMFADevice"],
            requestParameters: {
              userName: ["AWS ROOT USER"],
            },
          },
        },
      })

      // Triggers when a root user succesfully logs in to the console
      new events.Rule(this, "RuleForRootUserSuccessfulLogin", {
        enabled: true,
        targets: [new targets.LambdaFunction(eventTransformer)],
        eventPattern: {
          detail: {
            userIdentity: {
              type: ["Root"],
            },
            eventName: ["ConsoleLogin"],
            eventType: ["AwsConsoleSignIn"],
            responseElements: {
              ConsoleLogin: ["Success"],
            },
          },
        },
      })

      // Triggers for bad login attemps for root user (e.g., wrong password)
      new events.Rule(this, "RuleForRootUserUnsuccessfulLogin", {
        enabled: true,
        targets: [new targets.LambdaFunction(eventTransformer)],
        eventPattern: {
          detail: {
            userIdentity: {
              type: ["Root"],
            },
            eventName: ["ConsoleLogin"],
            eventType: ["AwsConsoleSignIn"],
            responseElements: {
              ConsoleLogin: ["Failure"],
            },
          },
        },
      })

      // Triggered when password reset has been requested
      new events.Rule(this, "RuleForRootUserPasswordRecoveryRequest", {
        enabled: true,
        targets: [new targets.LambdaFunction(eventTransformer)],
        eventPattern: {
          detail: {
            userIdentity: {
              type: ["Root"],
            },
            eventName: ["PasswordRecoveryRequested"],
            eventType: ["AwsConsoleSignIn"],
            responseElements: {
              PasswordRecoveryRequested: ["Success"],
            },
          },
        },
      })

      // Triggered when password has been successfully reset
      new events.Rule(this, "RuleForRootUserPasswordRecoveryComplete", {
        enabled: true,
        targets: [new targets.LambdaFunction(eventTransformer)],
        eventPattern: {
          detail: {
            userIdentity: {
              type: ["Root"],
            },
            eventName: ["PasswordRecoveryCompleted"],
            eventType: ["AwsConsoleSignIn"],
            responseElements: {
              PasswordRecoveryCompleted: ["Success"],
            },
          },
        },
      })
    }
  }
}
