import * as cdk from "aws-cdk-lib"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import type * as lambda from "aws-cdk-lib/aws-lambda"
import * as logs from "aws-cdk-lib/aws-logs"
import * as constructs from "constructs"

export interface LambdaAlarmsProps {
  /**
   * The CloudWatch alarm action to use for high-severity alarms (ALARM channel).
   */
  alarmAction: cloudwatch.IAlarmAction
  /**
   * The CloudWatch alarm action to use for lower-severity warnings (WARNING channel).
   */
  warningAction: cloudwatch.IAlarmAction
  /**
   * The Lambda to add alarms to.
   */
  lambdaFunction: lambda.IFunction
}

/**
 * Alarms for Lambda functions.
 *
 * By itself, no alarms are created. Use the methods available
 * to add alarms.
 *
 * Create multiple instances of {@link LambdaAlarms} with different `action`
 * if you need an alarm to do multiple things.
 */
export class LambdaAlarms extends constructs.Construct {
  private readonly alarmAction: cloudwatch.IAlarmAction
  private readonly warningAction: cloudwatch.IAlarmAction
  private readonly lambdaFunction: lambda.IFunction

  constructor(
    scope: constructs.Construct,
    id: string,
    props: LambdaAlarmsProps,
  ) {
    super(scope, id)

    this.alarmAction = props.alarmAction
    this.warningAction = props.warningAction
    this.lambdaFunction = props.lambdaFunction
  }

  /**
   * Creates both the single-invocation warning and the
   * multiple invocations alarm with reasonable defaults.
   *
   * Each created alarm can be overridden via the per-alarm props.
   */
  addInvocationErrorAlarm(props?: {
    singleError?: {
      appendToAlarmDescription?: string
      enabled?: boolean
      action?: cloudwatch.IAlarmAction
      /**
       * @default true
       */
      enableOkAction?: boolean
    }
    multipleErrors?: {
      appendToAlarmDescription?: string
      enabled?: boolean
      action?: cloudwatch.IAlarmAction
      /**
       * @default true
       */
      enableOkAction?: boolean
      /**
       * @default 3
       */
      evaluationPeriods?: number
      /**
       * @default 1
       */
      threshold?: number
      /**
       * @default 60
       */
      periodSeconds?: number
    }
  }): void {
    this.addSingleInvocationAlarm(props?.singleError)
    this.addMultipleInvocationAlarms(props?.multipleErrors)
  }

  /**
   * Sets up a CloudWatch Alarm that triggers on a single invocation failure.
   */
  addSingleInvocationAlarm(props?: {
    appendToAlarmDescription?: string
    enabled?: boolean
    action?: cloudwatch.IAlarmAction
    enableOkAction?: boolean
  }): void {
    if (props?.enabled !== false) {
      // Sent to warnings channel by default
      const action = props?.action ?? this.warningAction

      const alarm = new cloudwatch.Metric({
        metricName: "Errors",
        namespace: "AWS/Lambda",
        statistic: "Sum",
        period: cdk.Duration.seconds(60),
        dimensionsMap: {
          FunctionName: this.lambdaFunction.functionName,
        },
      }).createAlarm(this, "SingleInvocationAlarm", {
        alarmDescription: `Invocation for '${this.lambdaFunction.functionName}' had a single failure. ${props?.appendToAlarmDescription ?? ""}`,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 1,
        threshold: 1,
        treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      })

      alarm.addAlarmAction(action)
      if (props?.enableOkAction ?? true) alarm.addOkAction(action)
    }
  }

  /**
   * Sets up a CloudWatch Alarm that triggers when there is a short series of
   * invocation failures.
   */
  addMultipleInvocationAlarms(props?: {
    appendToAlarmDescription?: string
    enabled?: boolean
    action?: cloudwatch.IAlarmAction
    /**
     * @default true
     */
    enableOkAction?: boolean
    /**
     * @default 3
     */
    evaluationPeriods?: number
    /**
     * @default 1
     */
    threshold?: number
    /**
     * @default 60
     */
    periodSeconds?: number
  }): void {
    if (props?.enabled !== false) {
      const alarm = new cloudwatch.Metric({
        metricName: "Errors",
        namespace: "AWS/Lambda",
        statistic: "Sum",
        period: cdk.Duration.seconds(props?.periodSeconds ?? 60),
        dimensionsMap: {
          FunctionName: this.lambdaFunction.functionName,
        },
      }).createAlarm(this, "InvocationSeriesAlarm", {
        alarmDescription: `Invocation for '${this.lambdaFunction.functionName}' failed repeatedly. ${props?.appendToAlarmDescription ?? ""}`,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: props?.evaluationPeriods ?? 3,
        threshold: props?.threshold ?? 1,
        treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      })

      // Sent to alarm channel by default
      alarm.addAlarmAction(props?.action ?? this.alarmAction)
      if (props?.enableOkAction ?? true)
        alarm.addOkAction(props?.action ?? this.alarmAction)
    }
  }

  /**
   * Alerts when ERROR is logged from lambda.
   */
  addErrorAlarm(props: {
    logGroup: logs.ILogGroup
    alarmDescription?: string
    /**
     * @default true
     */
    enableOkAction?: boolean
    /**
     * An action to use for CloudWatch alarm state changes
     * instead of the default warning action
     */
    action?: cloudwatch.IAlarmAction
  }): void {
    const errorMetricFilter = props.logGroup.addMetricFilter(
      "ErrorMetricFilter",
      {
        filterPattern: logs.FilterPattern.literal("ERROR"),
        metricName: "Errors",
        metricNamespace: `stack/${cdk.Stack.of(this).stackName}/${this.lambdaFunction.functionName}/Errors`,
      },
    )

    const errorAlarm = errorMetricFilter
      .metric()
      .with({
        statistic: "Sum",
        period: cdk.Duration.seconds(60),
      })
      .createAlarm(this, "ErrorLogAlarm", {
        alarmDescription:
          props.alarmDescription ??
          `${this.lambdaFunction.functionName} logged an error`,
        evaluationPeriods: 1,
        threshold: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      })

    // Sent to warnings channel by default
    const action = props.action ?? this.warningAction
    errorAlarm.addAlarmAction(action)
    if (props.enableOkAction ?? true) {
      errorAlarm.addOkAction(action)
    }
  }
}
