import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as sns from "aws-cdk-lib/aws-sns"
import "jest-cdk-snapshot"
import { DatabaseAlarms } from "../database-alarms"

test("create alarms", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack")
  const stack = new Stack(app, "Stack")

  const topic = new sns.Topic(supportStack, "Topic")
  const action = new cloudwatchActions.SnsAction(topic)

  const alarms = new DatabaseAlarms(stack, "DatabaseAlarms", {
    databaseInstanceIdentifier: "database-name",
    action,
  })

  alarms.addCpuCreditsAlarm({
    cpuCreditsThreshold: 5,
  })

  alarms.addCpuUtilizationAlarm({
    cpuLimitInPercent: 80,
  })

  alarms.addStorageSpaceAlarm({
    spaceLimitInBytes: 2_147_483_648,
  })

  expect(stack).toMatchCdkSnapshot()
})
