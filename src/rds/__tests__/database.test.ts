import "@aws-cdk/assert/jest"
import * as ec2 from "@aws-cdk/aws-ec2"
import * as rds from "@aws-cdk/aws-rds"
import { App, Stack } from "@aws-cdk/core"
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
  })

  database.allowConnectionFrom(otherSecurityGroup)

  expect(stack).toMatchCdkSnapshot()
})
