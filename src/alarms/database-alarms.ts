import * as cdk from "aws-cdk-lib"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import type * as ec2 from "aws-cdk-lib/aws-ec2"
import * as constructs from "constructs"

export interface DatabaseAlarmsProps {
  /**
   * The default action to use for CloudWatch alarm state changes
   */
  action: cloudwatch.IAlarmAction
  instanceIdentifier: string
  instanceType: ec2.InstanceType
  allocatedStorage: cdk.Size
}

// Based on https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-credits-baseline-concepts.html#earning-CPU-credits
const cpuCreditBalanceByInstanceType: {
  [instanceType: string]: number
} = {
  "t2.nano": 72,
  "t2.micro": 144,
  "t2.small": 288,
  "t2.medium": 576,
  "t2.large": 864,
  "t2.xlarge": 1296,
  "t2.2xlarge": 1958.4,
  "t3.nano": 144,
  "t3.micro": 288,
  "t3.small": 576,
  "t3.medium": 576,
  "t3.large": 864,
  "t3.xlarge": 2304,
  "t3.2xlarge": 4608,
  "t3a.nano": 144,
  "t3a.micro": 288,
  "t3a.small": 576,
  "t3a.medium": 576,
  "t3a.large": 864,
  "t3a.xlarge": 2304,
  "t3a.2xlarge": 4608,
  "t4g.nano": 144,
  "t4g.micro": 288,
  "t4g.small": 576,
  "t4g.medium": 576,
  "t4g.large": 864,
  "t4g.xlarge": 2304,
  "t4g.2xlarge": 4608,
}

export class DatabaseAlarms extends constructs.Construct {
  private readonly action: cloudwatch.IAlarmAction
  private readonly databaseInstanceIdentifier: string
  private readonly instanceType: ec2.InstanceType
  private readonly allocatedStorage: cdk.Size

  constructor(
    scope: constructs.Construct,
    id: string,
    props: DatabaseAlarmsProps,
  ) {
    super(scope, id)

    this.action = props.action
    this.databaseInstanceIdentifier = props.instanceIdentifier
    this.instanceType = props.instanceType
    this.allocatedStorage = props.allocatedStorage
  }

  /**
   * Sets up a CloudWatch Alarm that triggers if the CPU credit balance for
   * a burstable instance breach a certain threshold.
   *
   * NOTE: This alarm is only applicable for burstable instances, and a balance of 0 credits will only have performance
   * implications for T2 instances. T3 and T4g instances will instead cost more for prolonged high CPU utilization after
   * the balance is depleted.
   */
  addCpuCreditsAlarm(
    /**
     * Configuration for an alarm.
     *
     * @default Configured with sane defaults.
     */
    props?: {
      /**
       * An action to use for CloudWatch alarm state changes instead of the default action
       */
      action?: cloudwatch.IAlarmAction
      /**
       * The CloudWatch Alarm will change its state to ALARM if the number of CPU credits drops below this threshold.
       *
       * See https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-credits-baseline-concepts.html#earning-CPU-credits for an overview of maximum CPU credits for various instance types.
       *
       * @default 10% of the maximum earned CPU credits for the instance type.
       */
      threshold?: number
      /**
       * Add extra information to the alarm description, like Runbook URL or steps to triage.
       */
      appendToAlarmDescription?: string
    },
  ): void {
    if (!this.instanceType.isBurstable()) {
      throw new Error(
        "CPU credits are only relevant for burstable instance types.",
      )
    }

    const defaultThreshold =
      cpuCreditBalanceByInstanceType[this.instanceType.toString()] * 0.1
    const threshold = props?.threshold ?? defaultThreshold
    if (!threshold) {
      throw new Error(
        `No threshold supplied, and unable to determine a default value for instance type '${this.instanceType.toString()}'`,
      )
    }
    new cloudwatch.Metric({
      metricName: "CPUCreditBalance",
      namespace: "AWS/RDS",
      statistic: "Minimum",
      period: cdk.Duration.minutes(5),
      dimensionsMap: {
        DBInstanceIdentifier: this.databaseInstanceIdentifier,
      },
    })
      .createAlarm(this, "CreditsAlarm", {
        alarmDescription: `Less than ${threshold} CPU credits remaining for RDS database '${
          this.databaseInstanceIdentifier
        }'. ${
          this.instanceType.toString().startsWith("t2.")
            ? "If this reaches 0, the instance will be limited to a baseline CPU utilization."
            : "If the balance is depleted, AWS adds additional charges."
        } ${props?.appendToAlarmDescription ?? ""}`,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        evaluationPeriods: 1,
        threshold: threshold,
        treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      })
      .addAlarmAction(this.action)
  }

  /**
   * Sets up two CloudWatch Alarms for monitoring disk storage space:
   * 1) one that triggers if the available disk storage space is low.
   * 2) one that triggers if the available disk storage space is critcally low.
   *
   * You may want to use different alarm actions for the two alarms, e.g., one can be
   * categorized as a "warning", while the other one can be considered an "alarm".
   */
  addStorageSpaceAlarms(props?: {
    /**
     * Configuration for an alarm.
     *
     * @default Configured with sane defaults.
     */
    lowStorageSpaceAlarm?: {
      /**
       * @default true
       */
      enabled?: boolean
      /**
       * An action to use for CloudWatch alarm state changes instead of the default action
       */
      action?: cloudwatch.IAlarmAction
      /**
       * @default 25% of the allocated storage.
       */
      threshold?: cdk.Size
    }
    /**
     * Configuration for an alarm.
     *
     * @default Configured with sane defaults.
     */
    criticallyLowStorageSpaceAlarm?: {
      /**
       * @default true
       */
      enabled?: boolean
      /**
       * An action to use for CloudWatch alarm state changes instead of the default action
       */
      action?: cloudwatch.IAlarmAction
      /**
       * @default 5% of the allocated storage.
       */
      threshold?: cdk.Size
    }
    /**
     * Add extra information to the alarm description, like Runbook URL or steps to triage.
     */
    appendToAlarmDescription?: string
  }): void {
    const lowStorageSpaceAlarm = new cloudwatch.Metric({
      metricName: "FreeStorageSpace",
      namespace: "AWS/RDS",
      statistic: "Minimum",
      period: cdk.Duration.minutes(5),
      dimensionsMap: {
        DBInstanceIdentifier: this.databaseInstanceIdentifier,
      },
    }).createAlarm(this, "LowStorageSpaceAlarm", {
      alarmDescription: `Low storage space available on RDS database '${this.databaseInstanceIdentifier}'. ${props?.appendToAlarmDescription ?? ""}`,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
      threshold:
        props?.lowStorageSpaceAlarm?.threshold?.toBytes() ??
        this.allocatedStorage.toBytes() * 0.25,
      treatMissingData: cloudwatch.TreatMissingData.IGNORE,
    })
    if (props?.lowStorageSpaceAlarm?.enabled ?? true) {
      lowStorageSpaceAlarm.addAlarmAction(
        props?.lowStorageSpaceAlarm?.action || this.action,
      )
      lowStorageSpaceAlarm.addOkAction(
        props?.lowStorageSpaceAlarm?.action || this.action,
      )
    }

    const criticallyLowStorageSpaceAlarm = new cloudwatch.Metric({
      metricName: "FreeStorageSpace",
      namespace: "AWS/RDS",
      statistic: "Minimum",
      period: cdk.Duration.minutes(5),
      dimensionsMap: {
        DBInstanceIdentifier: this.databaseInstanceIdentifier,
      },
    }).createAlarm(this, "CriticallyLowStorageSpaceAlarm", {
      alarmDescription: `Critically low storage space available on RDS database '${this.databaseInstanceIdentifier}'. ${props?.appendToAlarmDescription ?? ""}`,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
      threshold:
        props?.criticallyLowStorageSpaceAlarm?.threshold?.toBytes() ??
        this.allocatedStorage.toBytes() * 0.05,
      treatMissingData: cloudwatch.TreatMissingData.IGNORE,
    })
    if (props?.criticallyLowStorageSpaceAlarm?.enabled ?? true) {
      criticallyLowStorageSpaceAlarm.addAlarmAction(
        props?.criticallyLowStorageSpaceAlarm?.action || this.action,
      )
      criticallyLowStorageSpaceAlarm.addOkAction(
        props?.criticallyLowStorageSpaceAlarm?.action || this.action,
      )
    }
  }

  /**
   * Sets up a CloudWatch Alarm that triggers if the average CPU utilization for
   * the RDS instance exceeds a given threshold.
   */
  addCpuUtilizationAlarm(
    /**
     * Configuration for an alarm.
     *
     * @default Configured with sane defaults.
     */
    props?: {
      /**
       * An action to use for CloudWatch alarm state changes instead of the default action
       */
      action?: cloudwatch.IAlarmAction
      /**
       * The threshold defined as a percentage that determines if CPU utilization should trigger an alarm or not.
       * @default 80
       */
      threshold?: number
      /**
       * @default 5
       */
      evaluationPeriods?: number
      /**
       * @default 2 minutes
       */
      period?: cdk.Duration
      /**
       * Add extra information to the alarm description, like Runbook URL or steps to triage.
       */
      appendToAlarmDescription?: string
    },
  ): void {
    const alarm = new cloudwatch.Metric({
      metricName: "CPUUtilization",
      namespace: "AWS/RDS",
      statistic: "Average",
      period: props?.period ?? cdk.Duration.minutes(2),
      dimensionsMap: {
        DBInstanceIdentifier: this.databaseInstanceIdentifier,
      },
    }).createAlarm(this, "CpuUtilizationAlarm", {
      alarmDescription: `RDS database '${this.databaseInstanceIdentifier}' has a higher than expected CPU utilization. ${props?.appendToAlarmDescription ?? ""}`,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: props?.evaluationPeriods ?? 5,
      threshold: props?.threshold ?? 80,
      treatMissingData: cloudwatch.TreatMissingData.IGNORE,
    })
    alarm.addAlarmAction(props?.action ?? this.action)
    alarm.addOkAction(props?.action ?? this.action)
  }
}
