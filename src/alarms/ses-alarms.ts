import * as cdk from "aws-cdk-lib"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import * as constructs from "constructs"
import { Unit } from "aws-cdk-lib/aws-cloudwatch"

export interface SesAlarmsProps extends cdk.StackProps {
  /**
   * The default action to use for CloudWatch alarm state changes
   */
  action: cloudwatch.IAlarmAction
  /**
   * Configuration for an alarm for high rate bounced messages.
   *
   * @default Configured with sane defaults.
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
     * @default 4(%)
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
     * @default 0.07(%)
     * 0.10% is the threshold at which AWS considers putting an account under review
     */
    threshold?: number
  }
}

/**
 *
 * See SlackAlarm construct for SNS Action.
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
      unit: Unit.PERCENT,
      period: cdk.Duration.days(1),
    }).createAlarm(this, "BouncedMessagesAlarm", {
      alarmDescription: `The SES bounce rate is over ${
        props?.bouncedMessagesAlarm?.threshold ?? 4
      }/%`,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      threshold: props?.bouncedMessagesAlarm?.threshold ?? 4,
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
      unit: Unit.PERCENT,
      period: cdk.Duration.days(1),
    }).createAlarm(this, "ComplaintMessagesAlarm", {
      alarmDescription: `The SES complaint rate is over ${
        props?.complaintRateAlarm?.threshold ?? 0.07
      }/%`,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      threshold: props?.complaintRateAlarm?.threshold ?? 0.07,
      treatMissingData: cloudwatch.TreatMissingData.IGNORE,
    })

    if (props?.complaintRateAlarm?.enabled ?? true) {
      complaintMessagesAlarm.addAlarmAction(
        props?.complaintRateAlarm?.action || this.action,
      )
    }
  }
}
