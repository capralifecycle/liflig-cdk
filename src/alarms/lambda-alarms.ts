import * as constructs from "constructs"
import * as cdk from "aws-cdk-lib"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"

export interface LambdaAlarmsProps {
  actions: cloudwatch.IAlarmAction[]
  lambdaFunctionName: string
}

export class LambdaAlarms extends constructs.Construct {
  private readonly actions: cloudwatch.IAlarmAction[]
  private readonly lambdaFunctionName: string

  constructor(
    scope: constructs.Construct,
    id: string,
    props: LambdaAlarmsProps,
  ) {
    super(scope, id)

    this.actions = props.actions
    this.lambdaFunctionName = props.lambdaFunctionName
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
      period: cdk.Duration.seconds(60), // Standard resolution metric has a minimum of 60s period
      dimensionsMap: {
        FunctionName: this.lambdaFunctionName,
      },
    }).createAlarm(this, "FailedInvocationAlarm", {
      alarmDescription: `Invocation for '${this.lambdaFunctionName}' failed. ${props?.appendToAlarmDescription ?? ""}`,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      threshold: 1,
      treatMissingData: cloudwatch.TreatMissingData.IGNORE,
    })

    this.actions.forEach((action) => {
      alarm.addAlarmAction(action)
      alarm.addOkAction(action)
    })
  }
}
