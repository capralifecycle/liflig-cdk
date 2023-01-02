import * as cdk from "aws-cdk-lib"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import * as constructs from "constructs"

export interface SesAlarmsProps extends cdk.StackProps {
  /**
   * The default action to use for CloudWatch alarm state changes
   */
  action: cloudwatch.IAlarmAction
  /**
   * Configuration for an alarm for high rate bounced messages.
   *
   * @default Configured with reasonable defaults.
   */
  bouncedMessagesAlarm?: {
    /**
     * @default true
     */
    enabled?: boolean
    /**
     * An action to use for CloudWatch alarm state changes instead of the default action
     */
    action?: cloudwatch.IAlarmAction
    /**
     * @default 10 minutes
     */
    period?: cdk.Duration
    /**
     * Threshold value for alarm as a percent
     * @default 2.5(%)
     * 5% is the threshold at which AWS considers putting an account under review
     */
    threshold?: number
  }
  /**
   * Configuration for an alarm for high complaint rate.
   *
   * @default Configured with sane defaults.
   */
  complaintRateAlarm?: {
    /**
     * @default true
     */
    enabled?: boolean
    /**
     * An action to use for CloudWatch alarm state changes instead of the default action
     */
    action?: cloudwatch.IAlarmAction
    /**
     * @default 10 minutes
     */
    period?: cdk.Duration
    /**
     * Threshold value for alarm as a percent
     * @default 0.05(%)
     * 0.10% is the threshold at which AWS considers putting an account under review
     */
    threshold?: number
  }
}

/**
 *
 * Construct that configures various sensible CloudWatch alarms for AWS SES
 */
export class SesAlarms extends constructs.Construct {
  private readonly action: cloudwatch.IAlarmAction

  constructor(scope: constructs.Construct, id: string, props: SesAlarmsProps) {
    super(scope, id)

    this.action = props.action

    const bouncedMessagesAlarm = new cloudwatch.Metric({
      metricName: "Reputation.BounceRate",
      namespace: "AWS/SES",
      statistic: "Maximum",
      period: props?.bouncedMessagesAlarm?.period ?? cdk.Duration.minutes(10),
    }).createAlarm(this, "BouncedMessagesAlarm", {
      alarmDescription: `The SES bounce rate is over ${
        props?.bouncedMessagesAlarm?.threshold ?? 2.5
      }%`,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      threshold: (props?.bouncedMessagesAlarm?.threshold ?? 2.5) / 100,
    })

    if (props?.bouncedMessagesAlarm?.enabled ?? true) {
      bouncedMessagesAlarm.addAlarmAction(
        props?.bouncedMessagesAlarm?.action || this.action,
      )
    }

    const complaintMessagesAlarm = new cloudwatch.Metric({
      metricName: "Reputation.ComplaintRate",
      namespace: "AWS/SES",
      statistic: "Maximum",
      period: props?.complaintRateAlarm?.period ?? cdk.Duration.minutes(10),
    }).createAlarm(this, "ComplaintMessagesAlarm", {
      alarmDescription: `The SES complaint rate is over ${
        props?.complaintRateAlarm?.threshold ?? 0.05
      }%`,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      threshold: (props?.complaintRateAlarm?.threshold ?? 0.05) / 100,
      treatMissingData: cloudwatch.TreatMissingData.IGNORE,
    })

    if (props?.complaintRateAlarm?.enabled ?? true) {
      complaintMessagesAlarm.addAlarmAction(
        props?.complaintRateAlarm?.action || this.action,
      )
    }
  }
}
