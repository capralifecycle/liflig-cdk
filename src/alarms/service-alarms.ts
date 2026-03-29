import * as cdk from "aws-cdk-lib"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import type * as lambda from "aws-cdk-lib/aws-lambda"
import * as logs from "aws-cdk-lib/aws-logs"
import * as logsDestinations from "aws-cdk-lib/aws-logs-destinations"
import { jsonErrorFilterPattern } from "./log-filter-patterns"
import * as constructs from "constructs"

export interface ServiceAlarmsProps extends cdk.StackProps {
  /**
   * The CloudWatch Alarm action to use for high-severity alarms.
   */
  alarmAction: cloudwatch.IAlarmAction
  /**
   * The CloudWatch Alarm action to use for warnings.
   */
  warningAction: cloudwatch.IAlarmAction
  /**
   * The name of the ECS service.
   */
  serviceName: string
  /**
   * Optional Lambda function that will receive forwarded log events.
   * If provided, subscription filters will be created to forward matching logs.
   */
  logHandler?: lambda.IFunction
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
  private readonly alarmAction: cloudwatch.IAlarmAction
  private readonly warningAction: cloudwatch.IAlarmAction
  private readonly serviceName: string
  private readonly logHandler?: lambda.IFunction

  constructor(
    scope: constructs.Construct,
    id: string,
    props: ServiceAlarmsProps,
  ) {
    super(scope, id)

    this.alarmAction = props.alarmAction
    this.warningAction = props.warningAction
    this.serviceName = props.serviceName
    this.logHandler = props.logHandler
  }

  /**
   * For logs stored as JSON, monitor log entries logged
   * with level ERROR or higher, as well as any requests
   * that causes 500 for logging with liflig-logging.
   */
  addJsonErrorAlarm(props: {
    logGroup: logs.ILogGroup
    alarmDescription?: string
    /**
     * Set to `false` to stop the alarm from sending OK events.
     * @default true
     */
    enableOkAlarm?: boolean
    /**
     * An action to use for CloudWatch alarm state changes instead of the default action
     */
    action?: cloudwatch.IAlarmAction
  }): void {
    const groupToUse = props.logGroup

    // If no log handler is configured, we create
    // the simple "ERROR" metric alarm.
    if (!this.logHandler) {
      const errorMetricFilter = groupToUse.addMetricFilter(
        "ErrorMetricFilter",
        {
          filterPattern: jsonErrorFilterPattern(),
          metricName: "Errors",
          metricNamespace: `stack/${cdk.Stack.of(this).stackName}/${this.serviceName}/Errors`,
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

      // Default to the warning action
      const actionToUse = props.action ?? this.warningAction
      errorAlarm.addAlarmAction(actionToUse)
      if (props.enableOkAlarm ?? true) {
        errorAlarm.addOkAction(actionToUse)
      }
    }

    if (this.logHandler) {
      props.logGroup.addSubscriptionFilter(
        "liflig-cdk-log-content-to-slack-error-subscription",
        {
          destination: new logsDestinations.LambdaDestination(this.logHandler),
          filterPattern: jsonErrorFilterPattern(),
        },
      )
    }
  }

  addUncaughtJavaExceptionAlarm(props: {
    logGroup: logs.ILogGroup
    alarmDescription?: string
    /**
     * @default false
     */
    enabled?: boolean
    enableOkAlarm?: boolean
    action?: cloudwatch.IAlarmAction
  }): void {
    if (props.enabled) {
      const filterPattern = logs.FilterPattern.allTerms("Exception in thread")

      // If no log handler is configured, create a simple metric alarm.
      if (!this.logHandler) {
        const errorMetricFilter = props.logGroup.addMetricFilter(
          "UncaughtJavaExceptionFilter",
          {
            filterPattern: filterPattern,
            metricName: "UncaughtJavaException",
            metricNamespace: `stack/${cdk.Stack.of(this).stackName}/${this.serviceName}/UncaughtJavaException`,
          },
        )

        const errorAlarm = errorMetricFilter
          .metric()
          .with({
            statistic: "Sum",
            period: cdk.Duration.seconds(60),
          })
          .createAlarm(this, "UncaughtJavaExceptionLogAlarm", {
            alarmDescription:
              props.alarmDescription ??
              `${this.serviceName} logged an uncaught Java exception`,
            evaluationPeriods: 1,
            threshold: 1,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
          })

        // Default to the warning action
        const actionToUse = props.action ?? this.warningAction
        errorAlarm.addAlarmAction(actionToUse)
        if (props.enableOkAlarm ?? true) {
          errorAlarm.addOkAction(actionToUse)
        }
      }

      // If a log handler is configured, forward matching logs to it.
      if (this.logHandler) {
        props.logGroup.addSubscriptionFilter(
          "liflig-cdk-log-content-to-slack-uncaught-exception-subscription",
          {
            destination: new logsDestinations.LambdaDestination(
              this.logHandler,
            ),
            filterPattern: filterPattern,
          },
        )
      }
    }
  }

  /**
   * Sets up CloudWatch alarms for monitoring an ECS service behind a target group:
   * 1) one that triggers if the target is responding with too many 5xx errors (aggregate 5xx count).
   * 2) one that triggers if the 95% percentile of response times from the target is too high.
   * 3) one that triggers if there are no healthy targets or if the load balancer fails to connect to targets.
   * 4) a single5xxResponseAlarm which triggers on a single 5xx response from a target.
   */
  addTargetGroupAlarms(props: {
    /**
     * The full name of the target group.
     */
    targetGroupFullName: string
    /**
     * The full name of the application load balancer.
     */
    loadBalancerFullName: string
    /**
     * Configuration for a composite alarm.
     *
     * @default Configured with sane defaults.
     */
    targetHealthAlarm?: {
      /**
       * @default true
       */
      enabled?: boolean
      /**
       * Whether to attach OK actions for this alarm. @default true
       */
      enableOkAlarm?: boolean
      /**
       * An action to use for CloudWatch alarm state changes instead of the default action
       */
      action?: cloudwatch.IAlarmAction
      /**
       * @default 60 seconds
       */
      period?: cdk.Duration
      /**
       * @default 1
       */
      evaluationPeriods?: number
      /**
       * @default 1
       */
      threshold?: number
      description?: string
    }
    /**
     * Configuration for an alarm.
     *
     * @default Configured with sane defaults.
     */
    tooMany5xxResponsesFromTargetsAlarm?: {
      /**
       * @default true
       */
      enabled?: boolean
      /**
       * Whether to attach OK actions for this alarm. @default true
       */
      enableOkAlarm?: boolean
      /**
       * An action to use for CloudWatch alarm state changes instead of the default action
       */
      action?: cloudwatch.IAlarmAction
      /**
       * @default 60 seconds
       */
      period?: cdk.Duration
      /**
       * @default 3
       */
      evaluationPeriods?: number
      /**
       * @default 10
       */
      threshold?: number
      description?: string
    }
    /**
     * Configuration for an alarm.
     *
     * @default Configured with sane defaults.
     */
    targetResponseTimeAlarm?: {
      /**
       * @default true
       */
      enabled?: boolean
      /**
       * Whether to attach OK actions for this alarm. @default true
       */
      enableOkAlarm?: boolean
      /**
       * An action to use for CloudWatch alarm state changes instead of the default action
       */
      action?: cloudwatch.IAlarmAction
      /**
       * @default 5 minutes
       */
      period?: cdk.Duration
      /**
       * @default 1
       */
      evaluationPeriods?: number
      /**
       * @default 1s
       */
      threshold?: cdk.Duration
      description?: string
    }
    /**
     * Configuration for an alarm.
     *
     * @default Configured with sane defaults.
     */
    single5xxResponseAlarm?: {
      /**
       * @default true
       */
      enabled?: boolean
      /**
       * Whether to attach OK actions for this alarm. @default true
       */
      enableOkAlarm?: boolean
      /**
       * An action to use for CloudWatch alarm state changes instead of the default action
       */
      action?: cloudwatch.IAlarmAction
      /**
       * @default 60 seconds
       */
      period?: cdk.Duration
      /**
       * @default 1
       */
      evaluationPeriods?: number
      /**
       * @default 1
       */
      threshold?: number
      description?: string
    }
  }): void {
    if (props.single5xxResponseAlarm?.enabled !== false) {
      const single5xxMetric = new cloudwatch.Metric({
        metricName: "HTTPCode_Target_5XX_Count",
        namespace: "AWS/ApplicationELB",
        statistic: "Sum",
        period:
          props.single5xxResponseAlarm?.period ?? cdk.Duration.seconds(60),
        dimensionsMap: {
          TargetGroup: props.targetGroupFullName,
          LoadBalancer: props.loadBalancerFullName,
        },
      })

      const single5xxAlarm = single5xxMetric.createAlarm(
        this,
        "AlbTargetsSingle5xxAlarm",
        {
          actionsEnabled: true,
          alarmDescription:
            props.single5xxResponseAlarm?.description ??
            `Load balancer received a 5XX response from target(s) in ECS service '${this.serviceName}'.`,
          evaluationPeriods:
            props.single5xxResponseAlarm?.evaluationPeriods ?? 1,
          threshold: props.single5xxResponseAlarm?.threshold ?? 1,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        },
      )

      // Sent to warnings channel by default
      const single5xxAction =
        props.single5xxResponseAlarm?.action ?? this.warningAction
      single5xxAlarm.addAlarmAction(single5xxAction)
      if (props.single5xxResponseAlarm?.enableOkAlarm ?? true) {
        single5xxAlarm.addOkAction(single5xxAction)
      }
    }

    const targetConnectionErrorAlarm = new cloudwatch.Metric({
      metricName: "TargetConnectionErrorCount",
      namespace: "AWS/ApplicationELB",
      statistic: "Sum",
      period: props.targetHealthAlarm?.period ?? cdk.Duration.seconds(60),
      dimensionsMap: {
        TargetGroup: props.targetGroupFullName,
        LoadBalancer: props.loadBalancerFullName,
      },
    }).createAlarm(this, "ConnectionAlarm", {
      actionsEnabled: true,
      alarmDescription: `Load balancer is failing to connect to target(s) in ECS service '${this.serviceName}'.`,
      evaluationPeriods: props.targetHealthAlarm?.evaluationPeriods ?? 1,
      threshold: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })

    const healthAlarm = new cloudwatch.Metric({
      metricName: "HealthyHostCount",
      namespace: "AWS/ApplicationELB",
      statistic: "Minimum",
      period: props.targetHealthAlarm?.period ?? cdk.Duration.seconds(60),
      dimensionsMap: {
        TargetGroup: props.targetGroupFullName,
        LoadBalancer: props.loadBalancerFullName,
      },
    }).createAlarm(this, "HealthAlarm", {
      alarmDescription: `There are no healthy target(s) in ECS service '${this.serviceName}'.`,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: props.targetHealthAlarm?.evaluationPeriods ?? 1,
      threshold: 1,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    })

    const targetHealthAlarm = new cloudwatch.CompositeAlarm(
      this,
      "TargetHealthAlarm",
      {
        alarmRule: cdk.aws_cloudwatch.AlarmRule.anyOf(
          cdk.aws_cloudwatch.AlarmRule.fromAlarm(
            targetConnectionErrorAlarm,
            cloudwatch.AlarmState.ALARM,
          ),
          cdk.aws_cloudwatch.AlarmRule.fromAlarm(
            healthAlarm,
            cloudwatch.AlarmState.ALARM,
          ),
        ),
        alarmDescription:
          props.targetHealthAlarm?.description ??
          `The load balancer is either receiving bad health checks from or is unable to connect to target(s) in ECS service '${this.serviceName}'`,
      },
    )
    if (props.targetHealthAlarm?.enabled ?? true) {
      // Default to the alarm action
      const thAction = props.targetHealthAlarm?.action ?? this.alarmAction
      targetHealthAlarm.addAlarmAction(thAction)
      if (props.targetHealthAlarm?.enableOkAlarm ?? true) {
        targetHealthAlarm.addOkAction(thAction)
      }
    }

    const tooMany5xxResponsesFromTargetsAlarm = new cloudwatch.Metric({
      metricName: "HTTPCode_Target_5XX_Count",
      namespace: "AWS/ApplicationELB",
      statistic: "Sum",
      period:
        props.tooMany5xxResponsesFromTargetsAlarm?.period ??
        cdk.Duration.seconds(60),
      dimensionsMap: {
        TargetGroup: props.targetGroupFullName,
        LoadBalancer: props.loadBalancerFullName,
      },
    }).createAlarm(this, "AlbTargets5xxAlarm", {
      actionsEnabled: true,
      alarmDescription:
        props.tooMany5xxResponsesFromTargetsAlarm?.description ??
        `Load balancer received too many 5XX responses from target(s) in ECS service '${this.serviceName}'.`,
      evaluationPeriods:
        props.tooMany5xxResponsesFromTargetsAlarm?.evaluationPeriods ?? 3,
      threshold: props.tooMany5xxResponsesFromTargetsAlarm?.threshold ?? 10,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    if (props.tooMany5xxResponsesFromTargetsAlarm?.enabled ?? true) {
      // Default to the alarm action
      const fiveXAction =
        props.tooMany5xxResponsesFromTargetsAlarm?.action ?? this.alarmAction
      tooMany5xxResponsesFromTargetsAlarm.addAlarmAction(fiveXAction)
      if (props.tooMany5xxResponsesFromTargetsAlarm?.enableOkAlarm ?? true) {
        tooMany5xxResponsesFromTargetsAlarm.addOkAction(fiveXAction)
      }
    }

    const targetResponseTimeAlarm = new cloudwatch.Metric({
      metricName: "TargetResponseTime",
      namespace: "AWS/ApplicationELB",
      statistic: "p95",
      period: props.targetResponseTimeAlarm?.period ?? cdk.Duration.minutes(5),
      dimensionsMap: {
        LoadBalancer: props.loadBalancerFullName,
        TargetGroup: props.targetGroupFullName,
      },
    }).createAlarm(this, "TargetResponseTimeAlarm", {
      alarmDescription:
        props.targetResponseTimeAlarm?.description ??
        `5% of responses from ECS service '${
          this.serviceName
        }' are taking longer than the expected duration of ${(
          props.targetResponseTimeAlarm?.threshold ?? cdk.Duration.seconds(1)
        ).toSeconds({ integral: false })} s.`,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: props.targetResponseTimeAlarm?.evaluationPeriods ?? 1,
      threshold: (
        props.targetResponseTimeAlarm?.threshold ?? cdk.Duration.seconds(1)
      ).toSeconds({ integral: false }),
      treatMissingData: cloudwatch.TreatMissingData.IGNORE,
    })
    if (props.targetResponseTimeAlarm?.enabled ?? true) {
      // Default to the warning action
      const rtAction =
        props.targetResponseTimeAlarm?.action ?? this.warningAction
      targetResponseTimeAlarm.addAlarmAction(rtAction)
      if (props.targetResponseTimeAlarm?.enableOkAlarm ?? true) {
        targetResponseTimeAlarm.addOkAction(rtAction)
      }
    }
  }
}
