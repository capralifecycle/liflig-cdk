import * as cdk from "aws-cdk-lib"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import type * as lambda from "aws-cdk-lib/aws-lambda"
import * as constructs from "constructs"

export interface LambdaAlarmsProps {
  /**
   * The default action to use for CloudWatch alarm state changes.
   */
  action: cloudwatch.IAlarmAction
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
  private readonly action: cloudwatch.IAlarmAction
  private readonly lambdaFunction: lambda.IFunction

  constructor(
    scope: constructs.Construct,
    id: string,
    props: LambdaAlarmsProps,
  ) {
    super(scope, id)

    this.action = props.action
    this.lambdaFunction = props.lambdaFunction
  }

  /**
   * Sets up a CloudWatch Alarm that triggers if the Lambda fails invocations.
   * This usually happens from uncaught exceptions in the lambda.
   */
  addInvocationErrorAlarm(
    /**
     * Configuration for an alarm.
     */
    props?: {
      /**
       * Add extra information to the alarm description, like Runbook URL or steps to triage.
       */
      appendToAlarmDescription?: string
    },
  ): void {
    const alarm = new cloudwatch.Metric({
      metricName: "Errors",
      namespace: "AWS/Lambda",
      statistic: "Sum",
      period: cdk.Duration.seconds(60),
      dimensionsMap: {
        FunctionName: this.lambdaFunction.functionName,
      },
    }).createAlarm(this, "FailedInvocationAlarm", {
      alarmDescription: `Invocation for '${this.lambdaFunction.functionName}' failed. ${props?.appendToAlarmDescription ?? ""}`,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      threshold: 1,
      treatMissingData: cloudwatch.TreatMissingData.IGNORE,
    })

    alarm.addAlarmAction(this.action)
    alarm.addOkAction(this.action)
  }
}
