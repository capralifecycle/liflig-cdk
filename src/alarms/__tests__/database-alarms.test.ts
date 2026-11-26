import assert from "node:assert/strict"
import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Fn, Size, Stack } from "aws-cdk-lib"
import * as assertions from "aws-cdk-lib/assertions"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as sns from "aws-cdk-lib/aws-sns"
import { DatabaseAlarms } from "../database-alarms"

configureCdkSnapshots()

test("create alarms", (t) => {
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
    alarmAction: action,
    warningAction: action,
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

  t.assert.snapshot(cdkTemplate(stack))
})

function synthAllAlarms(instanceIdentifier: string) {
  const app = new App()
  const stack = new Stack(app, "Stack")
  const action = new cloudwatchActions.SnsAction(new sns.Topic(stack, "Topic"))

  const alarms = new DatabaseAlarms(stack, "DatabaseAlarms", {
    instanceIdentifier,
    instanceType: ec2.InstanceType.of(
      ec2.InstanceClass.BURSTABLE3,
      ec2.InstanceSize.MICRO,
    ),
    allocatedStorage: Size.gibibytes(25),
    alarmAction: action,
    warningAction: action,
  })
  alarms.addCpuCreditsAlarm()
  alarms.addCpuUtilizationAlarm()
  alarms.addStorageSpaceAlarms()

  return assertions.Template.fromStack(stack)
}

test("uses the lowercase instance identifier as the metric dimension", () => {
  const alarms = synthAllAlarms("Example-Database-V1").findResources(
    "AWS::CloudWatch::Alarm",
  )

  assert.equal(Object.keys(alarms).length, 4)
  for (const alarm of Object.values(alarms)) {
    assert.deepEqual(alarm.Properties.Dimensions, [
      { Name: "DBInstanceIdentifier", Value: "example-database-v1" },
    ])
  }
})

test("keeps an unresolved instance identifier as it is", () => {
  const alarms = synthAllAlarms(
    Fn.importValue("Example-Database-Identifier"),
  ).findResources("AWS::CloudWatch::Alarm")

  assert.equal(Object.keys(alarms).length, 4)
  for (const alarm of Object.values(alarms)) {
    assert.deepEqual(alarm.Properties.Dimensions, [
      {
        Name: "DBInstanceIdentifier",
        Value: { "Fn::ImportValue": "Example-Database-Identifier" },
      },
    ])
  }
})
