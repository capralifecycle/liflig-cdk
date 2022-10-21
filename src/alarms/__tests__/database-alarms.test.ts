import "@aws-cdk/assert/jest"
import { App, Stack, Size } from "aws-cdk-lib"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as sns from "aws-cdk-lib/aws-sns"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import "jest-cdk-snapshot"
import { DatabaseAlarms } from "../database-alarms"

test("create alarms", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack")
  const stack = new Stack(app, "Stack")

  const topic = new sns.Topic(supportStack, "Topic")
  const action = new cloudwatchActions.SnsAction(topic)

  const alarms = new DatabaseAlarms(stack, "DatabaseAlarms", {
    instanceIdentifier: "database-name",
    instanceType: ec2.InstanceType.of(
      ec2.InstanceClass.BURSTABLE3,
      ec2.InstanceSize.MICRO,
    ),
    allocatedStorage: Size.gibibytes(25),
    action,
  })

  alarms.addCpuCreditsAlarm()
  alarms.addCpuUtilizationAlarm({
    threshold: 75,
  })

  alarms.addStorageSpaceAlarms()

  expect(stack).toMatchCdkSnapshot()
})
