import * as cdk from "aws-cdk-lib"
import type { IAlarmAction } from "aws-cdk-lib/aws-cloudwatch"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import * as constructs from "constructs"

export interface QueueAlarmsProps {
  // Action to use for high-severity alarms
  alarmAction: cloudwatch.IAlarmAction
  // Action to use for warnings
  warningAction: cloudwatch.IAlarmAction
  queueName: string
}

/**
 * This construct provides a thin wrapper that creates two alarms for
 * SQS queues.
 *
 * Unlike RDS and ECS alarm constructs in this package, `QueueAlarms` is
 * set up manually by consumers (it doesn't auto-wire to resources).
 *
 * Defaults:
 *  - Messages-not-being-processed alarm -> sent to `alarmAction` by default
 *  - Approximate-age alarm -> sent to `warningAction` by default
 */
export class QueueAlarms extends constructs.Construct {
  private readonly alarmAction: cloudwatch.IAlarmAction
  private readonly warningAction: cloudwatch.IAlarmAction
  private readonly queueName: string

  constructor(
    scope: constructs.Construct,
    id: string,
    props: QueueAlarmsProps,
  ) {
    super(scope, id)

    this.alarmAction = props.alarmAction
    this.warningAction = props.warningAction
    this.queueName = props.queueName
  }
  /**
   * Sets up a CloudWatch Composite Alarm that triggers if messages are not being deleted
   * from queue, and there are visible messages on the queue.
   */
  addMessagesNotBeingProcessedAlarm(props?: {
    /**
     * Period for metric evaluation as a CDK Duration
     * @default cdk.Duration.seconds(300)
     */
    period?: cdk.Duration
    /**
     * Evaluation periods for MessagesVisible metric
     * @default 2
     */
    evaluationPeriodsMessagesVisible?: number
    /**
     * Threshold for MessagesVisible metric (minimum)
     * @default 1
     */
    thresholdMessagesVisible?: number
    /**
     * Evaluation periods for NumberOfMessagesDeleted metric
     * @default 4
     */
    evaluationPeriodsMessagesDeleted?: number
    /**
     * Threshold for NumberOfMessagesDeleted (sum)
     * @default 0
     */
    thresholdMessagesDeleted?: number
    /**
     * @default true
     */
    enableOkAlarm?: boolean
    /** Per-alarm override of the action to use instead of the construct alarmAction */
    action?: IAlarmAction
  }): void {
    const period = props?.period ?? cdk.Duration.seconds(300)
    const evaluationPeriodsMessagesVisible =
      props?.evaluationPeriodsMessagesVisible ?? 2
    const thresholdMessagesVisible = props?.thresholdMessagesVisible ?? 1
    const evaluationPeriodsMessagesDeleted =
      props?.evaluationPeriodsMessagesDeleted ?? 4
    const thresholdMessagesDeleted = props?.thresholdMessagesDeleted ?? 0

    const messagesVisibleAlarm = new cloudwatch.Metric({
      metricName: "ApproximateNumberOfMessagesVisible",
      namespace: "AWS/SQS",
      statistic: "Minimum",
      period,
      dimensionsMap: {
        QueueName: this.queueName,
      },
    }).createAlarm(this, "MessagesVisibleAlarm", {
      alarmDescription:
        "Service might be unavailable! It has available messages on the SQS queue, but these messages are not being deleted (processed).",
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: evaluationPeriodsMessagesVisible,
      threshold: thresholdMessagesVisible,
      treatMissingData: cloudwatch.TreatMissingData.IGNORE,
    })

    const messagesNotBeingDeletedAlarm = new cloudwatch.Metric({
      metricName: "NumberOfMessagesDeleted",
      namespace: "AWS/SQS",
      statistic: "Sum",
      period,
      dimensionsMap: {
        QueueName: this.queueName,
      },
    }).createAlarm(this, "MessagesNotBeingDeleted", {
      alarmDescription:
        "Service might be unavailable! It has available messages on the SQS queue, but these messages are not being deleted (processed).",
      comparisonOperator:
        cloudwatch.ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: evaluationPeriodsMessagesDeleted,
      threshold: thresholdMessagesDeleted,
      treatMissingData: cloudwatch.TreatMissingData.IGNORE,
    })

    const messagesNotBeingProcessedAlarm = new cloudwatch.CompositeAlarm(
      this,
      "MessagesNotBeingProcessedAlarm",
      {
        alarmRule: cloudwatch.AlarmRule.allOf(
          messagesVisibleAlarm,
          messagesNotBeingDeletedAlarm,
        ),
        actionsEnabled: true,
        alarmDescription:
          "Service might be unavailable! It has available messages on the SQS queue, but these messages are not being deleted (processed).",
      },
    )

    // Sent to alarm channel by default
    const action = props?.action ?? this.alarmAction
    messagesNotBeingProcessedAlarm.addAlarmAction(action)
    if (props?.enableOkAlarm ?? true) {
      messagesNotBeingProcessedAlarm.addOkAction(action)
    }
  }

  /**
   * Alerts when the ApproximateAgeOfOldestMessage metric is high.
   */
  addApproximateAgeOfOldestMessageAlarm(props?: {
    alarmDescription?: string
    /**
     * @default cdk.Duration.seconds(900) (15 minutes)
     */
    period?: cdk.Duration
    /**
     * @default 2
     */
    evaluationPeriods?: number
    /**
     * Threshold in seconds for the age of the oldest message
     * @default 900 seconds (15 minutes)
     */
    thresholdSeconds?: number
    /**
     * @default false
     */
    enableOkAlarm?: boolean
    /** An action to use for CloudWatch alarm state changes instead of the default warningAction */
    action?: IAlarmAction
  }): void {
    const period = props?.period ?? cdk.Duration.seconds(900)
    const evaluationPeriods = props?.evaluationPeriods ?? 2
    const threshold = props?.thresholdSeconds ?? 900

    const ageMetric = new cloudwatch.Metric({
      metricName: "ApproximateAgeOfOldestMessage",
      namespace: "AWS/SQS",
      statistic: "Maximum",
      period,
      dimensionsMap: {
        QueueName: this.queueName,
      },
    })

    const ageAlarm = ageMetric.createAlarm(
      this,
      "ApproximateAgeOfOldestMessageAlarm",
      {
        alarmDescription:
          props?.alarmDescription ??
          `${this.queueName} has an oldest message older than ${threshold} seconds`,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods,
        threshold,
        treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      },
    )

    // Sent to warnings channel by default
    const action = props?.action ?? this.warningAction
    ageAlarm.addAlarmAction(action)
    if (props?.enableOkAlarm) {
      ageAlarm.addOkAction(action)
    }
  }

  /**
   * Alerts when too many messages exist on the queue.
   */
  addTooManyMessagesExistAlarm(props: {
    /**
     * Maximum number of visible messages before triggering the alarm
     */
    messageAmountLimit: number
    alarmDescription?: string
    /**
     * @default cdk.Duration.seconds(300)
     */
    period?: cdk.Duration
    /**
     * @default 1
     */
    evaluationPeriods?: number
    /**
     * @default true
     */
    enableOkAlarm?: boolean
    /** An action to use for CloudWatch alarm state changes instead of the default warningAction */
    action?: IAlarmAction
  }): void {
    const period = props.period ?? cdk.Duration.seconds(300)
    const evaluationPeriods = props.evaluationPeriods ?? 1

    const alarm = new cloudwatch.Metric({
      metricName: "ApproximateNumberOfMessagesVisible",
      namespace: "AWS/SQS",
      statistic: "Sum",
      period,
      dimensionsMap: {
        QueueName: this.queueName,
      },
    }).createAlarm(
      this,
      `TooManyMessagesExist${props.messageAmountLimit}Alarm`,
      {
        alarmDescription:
          props.alarmDescription ??
          `${this.queueName} has too many messages (>${props.messageAmountLimit})`,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods,
        threshold: props.messageAmountLimit,
        treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      },
    )

    // Sent to warnings channel by default
    const action = props.action ?? this.warningAction
    alarm.addAlarmAction(action)
    if (props.enableOkAlarm ?? true) {
      alarm.addOkAction(action)
    }
  }
}
