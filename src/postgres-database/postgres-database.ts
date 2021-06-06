import * as ec2 from "@aws-cdk/aws-ec2"
import * as rds from "@aws-cdk/aws-rds"
import * as sm from "@aws-cdk/aws-secretsmanager"
import * as cdk from "@aws-cdk/core"

interface Props extends cdk.StackProps {
  vpc: ec2.IVpc
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
}

export class PostgresDatabase extends cdk.Construct {
  public readonly secret: sm.ISecret
  public readonly connections: ec2.Connections

  constructor(scope: cdk.Construct, id: string, props: Props) {
    super(scope, id)

    const masterUsername = props.masterUsername ?? "master"
    const databaseName = props.databaseName ?? "app"

    const dbSecret = new rds.DatabaseSecret(this, "DbSecret", {
      username: masterUsername,
    })

    const dbOptions: rds.DatabaseInstanceSourceProps = {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_12,
      }),
      allowMajorVersionUpgrade: true,
      instanceIdentifier: props.instanceIdentifier,
      instanceType: props.instanceType,
      vpc: props.vpc,
      vpcSubnets: props.usePublicSubnets
        ? {
            subnetType: ec2.SubnetType.PUBLIC,
          }
        : undefined,
      multiAz: true,
      // We default to 25 GiB storage instead of 100 GiB
      // if we do not specify.
      allocatedStorage: props.allocatedStorageGb ?? 25,
      // We specify maximum backup retention.
      backupRetention: cdk.Duration.days(35),
    }

    const db = props.snapshotIdentifier
      ? new rds.DatabaseInstanceFromSnapshot(this, "Db", {
          ...dbOptions,
          snapshotIdentifier: props.snapshotIdentifier,
          credentials: rds.SnapshotCredentials.fromSecret(dbSecret),
        })
      : new rds.DatabaseInstance(this, "Db", {
          ...dbOptions,
          databaseName,
          credentials: rds.Credentials.fromSecret(dbSecret),
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
