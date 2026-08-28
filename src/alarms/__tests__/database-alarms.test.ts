import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Size, Stack } from "aws-cdk-lib"
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
