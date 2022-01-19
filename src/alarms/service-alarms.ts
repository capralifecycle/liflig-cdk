import * as cloudwatch from "@aws-cdk/aws-cloudwatch"
import * as logs from "@aws-cdk/aws-logs"
import * as cdk from "@aws-cdk/core"

export interface ServiceAlarmsProps extends cdk.StackProps {
  action: cloudwatch.IAlarmAction
  serviceName: string
}

/**
 * Various alarms and monitoring.
 *
 * By itself no alarms is created. Use the methods available
 * to add alarms.
 *
 * See SlackAlarm construct for SNS Action.
 */
export class ServiceAlarms extends cdk.Construct {
  private readonly action: cloudwatch.IAlarmAction
  private readonly serviceName: string

  constructor(scope: cdk.Construct, id: string, props: ServiceAlarmsProps) {
    super(scope, id)

    this.action = props.action
    this.serviceName = props.serviceName
  }

  /**
   * For logs stored as JSON, monitor log entries logged
   * with level ERROR or higher, as well as any requests
   * that causes 500 for logging with liflig-logging.
   */
  addJsonErrorAlarm(props: {
    logGroup: logs.ILogGroup
    alarmDescription?: string
  }): void {
    const errorMetricFilter = props.logGroup.addMetricFilter(
      "ErrorMetricFilter",
      {
        filterPattern: logs.FilterPattern.any(
          logs.FilterPattern.stringValue("$.level", "=", "ERROR"),
          // FATAL covers some applications we run that uses log4j or
          // other libraries. It is not existent in slf4j.
          logs.FilterPattern.stringValue("$.level", "=", "FATAL"),
          logs.FilterPattern.stringValue(
            // For liflig-logging.
            "$.requestInfo.status.code",
            "=",
            "INTERNAL_SERVER_ERROR",
          ),
        ),
        metricName: "Errors",
        metricNamespace: `stack/${cdk.Stack.of(this).stackName}/${
          this.serviceName
        }/Errors`,
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
          props.alarmDescription ?? `${this.serviceName} logged an error`,
        evaluationPeriods: 1,
        threshold: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      })

    errorAlarm.addAlarmAction(this.action)
    errorAlarm.addOkAction(this.action)
  }

  /**
   * Monitor healthy host count and connection errors from load balancer.
   */
  addTargetGroupAlarm(props: {
    targetGroupFullName: string
    loadBalancerFullName: string
  }): void {
    const healthAlarm = new cloudwatch.Metric({
      metricName: "HealthyHostCount",
      namespace: "AWS/ApplicationELB",
      statistic: "Average",
      period: cdk.Duration.seconds(60),
      dimensionsMap: {
        TargetGroup: props.targetGroupFullName,
        LoadBalancer: props.loadBalancerFullName,
      },
    }).createAlarm(this, "HealthAlarm", {
      alarmDescription:
        "Service might be unavailable! It is not responding to health checks.",
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
      threshold: 1,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    })

    healthAlarm.addAlarmAction(this.action)
    healthAlarm.addOkAction(this.action)

    const connectionAlarm = new cloudwatch.Metric({
      metricName: "TargetConnectionErrorCount",
      namespace: "AWS/ApplicationELB",
      statistic: "Sum",
      period: cdk.Duration.seconds(60),
      dimensionsMap: {
        TargetGroup: props.targetGroupFullName,
        LoadBalancer: props.loadBalancerFullName,
      },
    }).createAlarm(this, "ConnectionAlarm", {
      actionsEnabled: true,
      alarmDescription: "Load balancer could not connect to target",
      evaluationPeriods: 1,
      threshold: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })

    connectionAlarm.addAlarmAction(this.action)
    connectionAlarm.addOkAction(this.action)
  }
}
