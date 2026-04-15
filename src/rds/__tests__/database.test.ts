import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as rds from "aws-cdk-lib/aws-rds"
import * as sns from "aws-cdk-lib/aws-sns"
import "jest-cdk-snapshot"
import { Database } from ".."

test("create database", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack")
  const stack = new Stack(app, "Stack")

  const vpc = new ec2.Vpc(supportStack, "Vpc")

  const otherSecurityGroup = new ec2.SecurityGroup(
    supportStack,
    "SecurityGroup",
    {
      vpc,
    },
  )

  const database = new Database(stack, "Database", {
    vpc: vpc,
    engine: rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_12,
    }),
    instanceType: ec2.InstanceType.of(
      ec2.InstanceClass.BURSTABLE3,
      ec2.InstanceSize.MICRO,
    ),
    instanceIdentifier: "example-database-v1",
    snapshotIdentifier: undefined,
    usePublicSubnets: true,
    alarms: { enabled: false },
  })

  database.allowConnectionFrom(otherSecurityGroup)

  expect(stack).toMatchCdkSnapshot()
})

test("should set publiclyAccessible also when in private subnets", () => {
  // This is mainly due to compatibility to previous setups.
  // If the attribute is removed later it will cause a replacement.

  const app = new App()
  const stack = new Stack(app, "Stack")
  const vpc = new ec2.Vpc(stack, "Vpc")

  new Database(stack, "Database", {
    vpc: vpc,
    engine: rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_12,
    }),
    instanceType: ec2.InstanceType.of(
      ec2.InstanceClass.BURSTABLE3,
      ec2.InstanceSize.MICRO,
    ),
    instanceIdentifier: "example-database-v1",
    snapshotIdentifier: undefined,
    usePublicSubnets: false,
    alarms: { enabled: false },
  })

  expect(stack).toHaveResourceLike("AWS::RDS::DBInstance", {
    PubliclyAccessible: false,
  })
})

test("creates storage space and CPU utilization alarms by default when alarms enabled", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack")
  const stack = new Stack(app, "Stack")

  const vpc = new ec2.Vpc(supportStack, "Vpc")
  const alarmTopic = new sns.Topic(supportStack, "AlarmTopic")
  const warningTopic = new sns.Topic(supportStack, "WarningTopic")

  new Database(stack, "Database", {
    vpc: vpc,
    engine: rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_12,
    }),
    instanceType: ec2.InstanceType.of(
      ec2.InstanceClass.BURSTABLE3,
      ec2.InstanceSize.MICRO,
    ),
    instanceIdentifier: "example-database-v1",
    snapshotIdentifier: undefined,
    usePublicSubnets: false,
    alarms: {
      alarmAction: new cloudwatchActions.SnsAction(alarmTopic),
      warningAction: new cloudwatchActions.SnsAction(warningTopic),
    },
  })

  // Should have CPU utilization alarm (sent to warnings by default)
  expect(stack).toHaveResourceLike("AWS::CloudWatch::Alarm", {
    MetricName: "CPUUtilization",
    Namespace: "AWS/RDS",
  })

  // Should have storage space alarms (critically low -> alarms, low -> warnings)
  expect(stack).toHaveResourceLike("AWS::CloudWatch::Alarm", {
    MetricName: "FreeStorageSpace",
    ComparisonOperator: "LessThanThreshold",
  })
})
