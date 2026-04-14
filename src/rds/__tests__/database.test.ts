import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import { Annotations } from "aws-cdk-lib/assertions"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as rds from "aws-cdk-lib/aws-rds"
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

test("should disable auto minor version upgrade by default", () => {
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
    alarms: { enabled: false },
  })

  expect(stack).toHaveResourceLike("AWS::RDS::DBInstance", {
    AutoMinorVersionUpgrade: false,
  })
})

test("should allow enabling auto minor version upgrade", () => {
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
    autoMinorVersionUpgrade: true,
    alarms: { enabled: false },
  })

  expect(stack).toHaveResourceLike("AWS::RDS::DBInstance", {
    AutoMinorVersionUpgrade: true,
  })
})

test("should warn when auto minor version upgrade is enabled without maintenance window", () => {
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
    autoMinorVersionUpgrade: true,
    alarms: { enabled: false },
  })

  Annotations.fromStack(stack).hasWarning(
    "/Stack/Database",
    "Auto minor version upgrade is enabled but no maintenance window is specified. AWS will choose a default maintenance window which may not suit your availability requirements. [ack: @liflig/cdk:autoMinorVersionUpgradeWithoutMaintenanceWindow]",
  )
})

test("should not warn when auto minor version upgrade is enabled with maintenance window", () => {
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
    autoMinorVersionUpgrade: true,
    preferredMaintenanceWindow: "sun:03:00-sun:04:00",
    alarms: { enabled: false },
  })

  const annotations = Annotations.fromStack(stack)
  annotations.hasNoWarning("/Stack/Database", "*autoMinorVersionUpgrade*")
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
