import * as cdk from "aws-cdk-lib"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import * as logs from "aws-cdk-lib/aws-logs"
import * as constructs from "constructs"

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
export class ServiceAlarms extends constructs.Construct {
  private readonly action: cloudwatch.IAlarmAction
  private readonly serviceName: string

  constructor(
    scope: constructs.Construct,
    id: string,
    props: ServiceAlarmsProps,
  ) {
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
    /** Set to `false` to stop the alarm from sending OK events.
     * @default true */
    enableOkAction?: boolean
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
    if (props.enableOkAction ?? true) {
      errorAlarm.addOkAction(this.action)
    }
  }

  /**
   * Monitor healthy host count, 5xx status codes and connection errors from load balancer.
   */
  addTargetGroupAlarm(props: {
    targetGroupFullName: string
    loadBalancerFullName: string
    tooMany5xxResponsesFromTargetsAlarmOverride?: {
      period: cdk.Duration
      evaluationPeriods: number
      threshold: number
    }
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

    const tooMany5xxResponsesFromTargetsAlarm = new cloudwatch.Metric({
      metricName: "HTTPCode_Target_5XX_Count",
      namespace: "AWS/ApplicationELB",
      statistic: "Sum",
      period:
        props.tooMany5xxResponsesFromTargetsAlarmOverride?.period ??
        cdk.Duration.seconds(60),
      dimensionsMap: {
        TargetGroup: props.targetGroupFullName,
        LoadBalancer: props.loadBalancerFullName,
      },
    }).createAlarm(this, "AlbTargets5xxAlarm", {
      actionsEnabled: true,
      alarmDescription:
        "Load balancer received too many 5XX response codes from its targets.",
      evaluationPeriods:
        props.tooMany5xxResponsesFromTargetsAlarmOverride?.evaluationPeriods ??
        1,
      threshold:
        props.tooMany5xxResponsesFromTargetsAlarmOverride?.threshold ?? 10,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })

    tooMany5xxResponsesFromTargetsAlarm.addAlarmAction(this.action)
    tooMany5xxResponsesFromTargetsAlarm.addOkAction(this.action)
  }

  /**
   * Monitor 5xx status codes produced by load balancer.
   */
  addAlbAlarms(props: {
    targetGroupFullName: string
    loadBalancerFullName: string
    tooMany5xxResponsesFromAlbAlarmOverride?: {
      period: cdk.Duration
      evaluationPeriods: number
      threshold: number
    }
  }): void {
    const tooMany5xxResponsesFromAlbAlarm = new cloudwatch.Metric({
      metricName: "HTTPCode_ELB_5XX_Count",
      namespace: "AWS/ApplicationELB",
      statistic: "Sum",
      period:
        props.tooMany5xxResponsesFromAlbAlarmOverride?.period ??
        cdk.Duration.seconds(60),
      dimensionsMap: {
        TargetGroup: props.targetGroupFullName,
        LoadBalancer: props.loadBalancerFullName,
      },
    }).createAlarm(this, "Alb5xxAlarm", {
      actionsEnabled: true,
      alarmDescription: "Load balancer returns too many 5XX response codes.",
      evaluationPeriods:
        props.tooMany5xxResponsesFromAlbAlarmOverride?.evaluationPeriods ?? 1,
      threshold: props.tooMany5xxResponsesFromAlbAlarmOverride?.threshold ?? 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })

    tooMany5xxResponsesFromAlbAlarm.addAlarmAction(this.action)
    tooMany5xxResponsesFromAlbAlarm.addOkAction(this.action)
  }
}
