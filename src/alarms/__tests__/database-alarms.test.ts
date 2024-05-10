import "@aws-cdk/assert/jest"
import { App, Stack, Size } from "aws-cdk-lib"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as sns from "aws-cdk-lib/aws-sns"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import "jest-cdk-snapshot"
import { DatabaseAlarms } from "../database-alarms"
import { throws } from "node:assert"

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

  alarms.addCpuCreditsAlarm({
    appendToAlarmDescription: "Runbook at https://liflig.no",
  })
  alarms.addCpuUtilizationAlarm({
    threshold: 75,
    appendToAlarmDescription: "Runbook at https://liflig.no",
  })

  alarms.addStorageSpaceAlarms({
    appendToAlarmDescription: "Runbook at https://liflig.no",
  })

  expect(stack).toMatchCdkSnapshot()
})

test("throws on non-burstable", () => {
  // Given
  const app = new App()
  const supportStack = new Stack(app, "SupportStack")
  const stack = new Stack(app, "Stack")

  const topic = new sns.Topic(supportStack, "Topic")
  const action = new cloudwatchActions.SnsAction(topic)

  const alarms = new DatabaseAlarms(stack, "DatabaseAlarms", {
    instanceIdentifier: "database-name",
    instanceType: ec2.InstanceType.of(
      ec2.InstanceClass.M6G /* Not burstable! */,
      ec2.InstanceSize.LARGE,
    ),
    allocatedStorage: Size.gibibytes(25),
    action,
  })

  // Then
  throws(
    () => {
      // When
      alarms.addCpuCreditsAlarm()
    },
    {
      message: /only relevant for burstable/,
    },
  )
})
