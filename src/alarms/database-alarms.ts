import * as constructs from "constructs"
import * as cdk from "aws-cdk-lib"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import { Unit } from "aws-cdk-lib/aws-cloudwatch"

export interface DatabaseAlarmsProps {
  action: cloudwatch.IAlarmAction
  databaseInstanceIdentifier: string
}

export class DatabaseAlarms extends constructs.Construct {
  private readonly action: cloudwatch.IAlarmAction
  private readonly databaseInstanceIdentifier: string

  constructor(
    scope: constructs.Construct,
    id: string,
    props: DatabaseAlarmsProps,
  ) {
    super(scope, id)

    this.action = props.action
    this.databaseInstanceIdentifier = props.databaseInstanceIdentifier
  }

  addCpuCreditsAlarm(props: { cpuCreditsThreshold: number }): void {
    new cloudwatch.Metric({
      metricName: "CPUCreditBalance",
      namespace: "AWS/RDS",
      statistic: "Minimum",
      unit: Unit.COUNT,
      period: cdk.Duration.minutes(5),
      dimensionsMap: {
        DBInstanceIdentifier: this.databaseInstanceIdentifier,
      },
    })
      .createAlarm(this, "CreditsAlarm", {
        alarmDescription: `Less than ${props.cpuCreditsThreshold} CPU credits remaining for ${this.databaseInstanceIdentifier}`,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        evaluationPeriods: 1,
        threshold: props.cpuCreditsThreshold,
        treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      })
      .addAlarmAction(this.action)
  }

  addStorageSpaceAlarm(props: { spaceLimitInBytes: number }): void {
    new cloudwatch.Metric({
      metricName: "FreeStorageSpace",
      namespace: "AWS/RDS",
      statistic: "Minimum",
      unit: Unit.BYTES,
      period: cdk.Duration.seconds(300),
      dimensionsMap: {
        DBInstanceIdentifier: this.databaseInstanceIdentifier,
      },
    })
      .createAlarm(this, "SpaceAlarm", {
        alarmDescription: `Less than ${props.spaceLimitInBytes} GB of space left for ${this.databaseInstanceIdentifier}.`,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        evaluationPeriods: 2,
        threshold: props.spaceLimitInBytes,
        treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      })
      .addAlarmAction(this.action)
  }

  addCpuUtilizationAlarm(props: {
    cpuLimitInPercent: number
    evaluationPeriods?: number
    periodInSeconds?: number
  }): void {
    const evaluationPeriods = props?.evaluationPeriods ?? 2
    const periodInSeconds = props?.periodInSeconds ?? 120

    new cloudwatch.Metric({
      metricName: "CPUUtilization",
      namespace: "AWS/RDS",
      statistic: "Average",
      period: cdk.Duration.seconds(periodInSeconds),
      dimensionsMap: {
        DBInstanceIdentifier: this.databaseInstanceIdentifier,
      },
    })
      .createAlarm(this, "CpuUtilizationAlarm", {
        alarmDescription: `${
          this.databaseInstanceIdentifier
        } has utilized more than ${props.cpuLimitInPercent}% for over ${
          evaluationPeriods * periodInSeconds
        } seconds.`,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        evaluationPeriods: evaluationPeriods,
        threshold: props.cpuLimitInPercent,
        treatMissingData: cloudwatch.TreatMissingData.IGNORE,
      })
      .addAlarmAction(this.action)
  }
}
