import "@aws-cdk/assert/jest"
import { App, Stack } from "@aws-cdk/core"
import * as ec2 from "@aws-cdk/aws-ec2"
import "jest-cdk-snapshot"
import { PostgresDatabase } from "../postgres-database"

test("create postgres database", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  const vpc = new ec2.Vpc(stack, "Vpc", {
    subnetConfiguration: [
      {
        cidrMask: 19,
        name: "Public",
        subnetType: ec2.SubnetType.PUBLIC,
      },
    ],
  })

  new PostgresDatabase(stack, "Database", {
    vpc: vpc,
    instanceType: ec2.InstanceType.of(
      ec2.InstanceClass.BURSTABLE3,
      ec2.InstanceSize.MICRO,
    ),
    instanceIdentifier: "example-database-v1",
    snapshotIdentifier: undefined,
    usePublicSubnets: true,
  })

  expect(stack).toMatchCdkSnapshot()
})
