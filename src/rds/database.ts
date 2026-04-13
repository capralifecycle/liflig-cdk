import * as cdk from "aws-cdk-lib"
import type * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as rds from "aws-cdk-lib/aws-rds"
import type * as sm from "aws-cdk-lib/aws-secretsmanager"
import * as constructs from "constructs"
import { DatabaseAlarms } from "../alarms"

/**
 * Configure database alarms.
 *
 * Alarms are enabled by default (when you supply an `alarmAction` and
 * `warningAction`). To explicitly disable automatic alarms use
 * `{ enabled: false }`.
 */
export type DatabaseAlarmsConfig =
  | { enabled: false }
  | {
      /**
       * When alarms are enabled, both actions are required.
       */
      alarmAction: cloudwatch.IAlarmAction
      warningAction: cloudwatch.IAlarmAction

      /**
       * CPU credits alarm config
       */
      cpuCreditsAlarm?: {
        /**
         * @default true if instance type is burstable
         */
        enabled?: boolean
        /** Whether to attach OK actions for this alarm. @default true */
        enableOkAlarm?: boolean
        action?: cloudwatch.IAlarmAction
        /** @default 10% of maximum earned credits for instance type */
        threshold?: number
        appendToAlarmDescription?: string
      }

      /**
       * Storage space alarm overrides
       */
      storageSpaceAlarms?: {
        /**
         * Set to `false` to disable all storage space alarms (both low and critically low).
         * @default true
         */
        enabled?: boolean
        lowStorageSpaceAlarm?: {
          action?: cloudwatch.IAlarmAction
          /** Whether to attach OK actions for this alarm. @default true */
          enableOkAlarm?: boolean
          /** @default 25% of allocated storage */
          threshold?: cdk.Size
        }
        criticallyLowStorageSpaceAlarm?: {
          action?: cloudwatch.IAlarmAction
          /** Whether to attach OK actions for this alarm. @default true */
          enableOkAlarm?: boolean
          /** @default 5% of allocated storage */
          threshold?: cdk.Size
        }
        appendToAlarmDescription?: string
      }

      /**
       * CPU utilization alarm overrides.
       */
      cpuUtilizationAlarm?: {
        enabled?: boolean
        /** Whether to attach OK actions for this alarm. @default true */
        enableOkAlarm?: boolean
        action?: cloudwatch.IAlarmAction
        /** @default 80 */
        threshold?: number
        /** @default 5 */
        evaluationPeriods?: number
        /** @default 2 minutes */
        period?: cdk.Duration
        appendToAlarmDescription?: string
      }
    }

export interface DatabaseProps extends cdk.StackProps {
  vpc: ec2.IVpc
  engine: rds.IInstanceEngine
  /**
   * @default master
   */
  masterUsername?: string
  /**
   * @default app
   */
  databaseName?: string
  /**
   * @default 25
   */
  allocatedStorageGb?: number
  instanceType: ec2.InstanceType
  instanceIdentifier: string
  /**
   * @default true
   */
  isMultiAz?: boolean
  /**
   * Must not be removed once it has been set, as changing this
   * results in a new DB instance being created.
   *
   * Also, remember to give database a new name when changing this prop, or else
   * the new instance name will crash with the existing instance.
   */
  snapshotIdentifier?: string
  /**
   * @default false
   */
  usePublicSubnets?: boolean
  overrideDbOptions?: Partial<rds.DatabaseInstanceSourceProps>
  /**
   * Configure database alarms.
   *
   * This property is required and must be one of two shapes:
   *  - `{ enabled: false }` to explicitly disable automatic alarms
   *  - `{ alarmAction, warningAction }` to enable alarms and provide both channels
   *
   * Default: enabled.
   */
  alarms: DatabaseAlarmsConfig
}

export class Database extends constructs.Construct {
  public readonly secret: sm.ISecret
  public readonly connections: ec2.Connections
  public readonly databaseInstance: rds.IDatabaseInstance
  public readonly instanceType: ec2.InstanceType
  public readonly allocatedStorage: cdk.Size

  constructor(scope: constructs.Construct, id: string, props: DatabaseProps) {
    super(scope, id)

    const masterUsername = props.masterUsername ?? "master"
    const databaseName = props.databaseName ?? "app"

    const secret = new rds.DatabaseSecret(this, "Secret", {
      username: masterUsername,
    })

    const options: rds.DatabaseInstanceSourceProps = {
      engine: props.engine,
      allowMajorVersionUpgrade: true,
      instanceIdentifier: props.instanceIdentifier,
      instanceType: props.instanceType,
      vpc: props.vpc,
      vpcSubnets: props.usePublicSubnets
        ? {
            subnetType: ec2.SubnetType.PUBLIC,
          }
        : undefined,
      multiAz: props.isMultiAz ?? true,
      // We default to 25 GiB storage instead of 100 GiB
      // if we do not specify.
      allocatedStorage: props.allocatedStorageGb ?? 25,
      // We specify maximum backup retention.
      backupRetention: cdk.Duration.days(35),
      ...props.overrideDbOptions,
    }
    this.allocatedStorage = cdk.Size.gibibytes(options.allocatedStorage!)
    this.instanceType = options.instanceType!

    const db = props.snapshotIdentifier
      ? new rds.DatabaseInstanceFromSnapshot(this, "Resource", {
          ...options,
          snapshotIdentifier: props.snapshotIdentifier,
          credentials: rds.SnapshotCredentials.fromSecret(secret),
        })
      : new rds.DatabaseInstance(this, "Resource", {
          ...options,
          databaseName,
          credentials: rds.Credentials.fromSecret(secret),
          storageEncrypted: true,
        })

    this.databaseInstance = db

    this.secret = db.secret!
    this.connections = db.connections

    // Override in case we have placed it in a public subnet.
    // It would default to being public accessible which we do not want.
    ;(db.node.defaultChild as rds.CfnDBInstance).publiclyAccessible = false

    if ("alarmAction" in props.alarms) {
      const alarms = props.alarms

      const dbAlarms = new DatabaseAlarms(this, "Alarms", {
        instanceIdentifier: props.instanceIdentifier,
        instanceType: props.instanceType,
        allocatedStorage: cdk.Size.gibibytes(options.allocatedStorage!),
        alarmAction: alarms.alarmAction,
        warningAction: alarms.warningAction,
      })

      // Default mapping:
      // - low CPU credits -> alarm
      // - critically low storage -> alarm
      // - low storage -> warning
      // - high CPU utilization -> warning
      // Only create the CPU credits alarm if the instance type is burstable.
      if (
        this.instanceType.isBurstable() &&
        alarms.cpuCreditsAlarm?.enabled !== false
      ) {
        dbAlarms.addCpuCreditsAlarm({
          action: alarms.cpuCreditsAlarm?.action,
          threshold: alarms.cpuCreditsAlarm?.threshold,
          enableOkAlarm: alarms.cpuCreditsAlarm?.enableOkAlarm,
          appendToAlarmDescription:
            alarms.cpuCreditsAlarm?.appendToAlarmDescription,
        })
      }

      if (alarms.storageSpaceAlarms?.enabled !== false)
        dbAlarms.addStorageSpaceAlarms({
          ...alarms.storageSpaceAlarms,
        })

      if (alarms.cpuUtilizationAlarm?.enabled !== false) {
        dbAlarms.addCpuUtilizationAlarm({
          action: alarms.cpuUtilizationAlarm?.action,
          threshold: alarms.cpuUtilizationAlarm?.threshold,
          evaluationPeriods: alarms.cpuUtilizationAlarm?.evaluationPeriods,
          period: alarms.cpuUtilizationAlarm?.period,
          enableOkAlarm: alarms.cpuUtilizationAlarm?.enableOkAlarm,
          appendToAlarmDescription:
            alarms.cpuUtilizationAlarm?.appendToAlarmDescription,
        })
      }
    }
  }

  public allowConnectionFrom(source: ec2.ISecurityGroup): void {
    this.connections.allowDefaultPortFrom(source)
  }
}
