import * as ec2 from "@aws-cdk/aws-ec2"
import * as rds from "@aws-cdk/aws-rds"
import * as sm from "@aws-cdk/aws-secretsmanager"
import * as cdk from "@aws-cdk/core"

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
}

export class Database extends cdk.Construct {
  public readonly secret: sm.ISecret
  public readonly connections: ec2.Connections

  constructor(scope: cdk.Construct, id: string, props: DatabaseProps) {
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

    this.secret = db.secret!
    this.connections = db.connections

    if (props.usePublicSubnets) {
      // Override due to being in public subnet.
      // It will default to being public accessible which we do not want.
      ;(db.node.defaultChild as rds.CfnDBInstance).publiclyAccessible = false
    }
  }
}
