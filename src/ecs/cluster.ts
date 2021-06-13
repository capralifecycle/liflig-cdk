import * as cloudwatch from "@aws-cdk/aws-cloudwatch"
import * as ec2 from "@aws-cdk/aws-ec2"
import * as ecs from "@aws-cdk/aws-ecs"
import * as events from "@aws-cdk/aws-events"
import * as targets from "@aws-cdk/aws-events-targets"
import * as logs from "@aws-cdk/aws-logs"
import * as cdk from "@aws-cdk/core"

export interface ClusterProps {
  /**
   * @default will be generated
   */
  clusterName?: string
  vpc: ec2.IVpc
  /**
   * @default no alarms will be set up
   */
  alarmAction?: cloudwatch.IAlarmAction
}

export class Cluster extends cdk.Construct {
  public readonly cluster: ecs.Cluster
  public readonly clusterEventLogs: logs.LogGroup

  constructor(scope: cdk.Construct, id: string, props: ClusterProps) {
    super(scope, id)

    this.cluster = new ecs.Cluster(this, "Resource", {
      clusterName: props.clusterName,
      vpc: props.vpc,
      executeCommandConfiguration: {
        // The default would log to the same awslogs setup as
        // the tasks, which would produce different types of
        // outputs in the same log group.
        // We have not set up specific logging for this.
        logging: ecs.ExecuteCommandLogging.NONE,
      },
    })

    // The details in ECS console is available only for short time,
    // so we store it to S3 to improve insight.
    this.clusterEventLogs = new logs.LogGroup(this, "EventLogs", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    new events.Rule(this, "StateRule", {
      eventPattern: {
        source: ["aws.ecs"],
        detail: {
          clusterArn: [this.cluster.clusterArn],
        },
      },
      targets: [new targets.CloudWatchLogGroup(this.clusterEventLogs)],
    })

    if (props.alarmAction) {
      this.addRestartFrequencyAlarm(props.alarmAction)
    }
  }

  /**
   * Monitor high number of restarts which typically signal a failing task.
   */
  private addRestartFrequencyAlarm(action: cloudwatch.IAlarmAction): void {
    const errorMetricFilter = this.clusterEventLogs.addMetricFilter(
      "ProvisioningErrorMetricFilter",
      {
        filterPattern: logs.FilterPattern.all(
          logs.FilterPattern.stringValue(
            "$.detail-type",
            "=",
            "ECS Task State Change",
          ),
          logs.FilterPattern.stringValue(
            "$.detail.lastStatus",
            "=",
            "PROVISIONING",
          ),
        ),
        metricName: "Provisioning",
        metricNamespace: `ECS/Cluster/${this.cluster.clusterName}`,
      },
    )

    const alarm = errorMetricFilter
      .metric()
      .with({
        statistic: "Sum",
        period: cdk.Duration.minutes(10),
      })
      .createAlarm(this, "RestartFrequencyAlarm", {
        alarmDescription: `Tasks in ${this.cluster.clusterName} is frequently provisioning`,
        evaluationPeriods: 1,
        threshold: 25,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      })

    alarm.addAlarmAction(action)
    alarm.addOkAction(action)
  }
}
