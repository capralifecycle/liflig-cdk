import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as sns from "aws-cdk-lib/aws-sns"
import "jest-cdk-snapshot"
import { LambdaAlarms } from "../lambda-alarms"

test("create alarms", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack")
  const stack = new Stack(app, "Stack")

  const topic = new sns.Topic(supportStack, "Topic")
  const action = new cloudwatchActions.SnsAction(topic)

  const alarms = new LambdaAlarms(stack, "LambdaAlarms", {
    actions: [action],
    lambdaFunctionName: "lambda-function-name",
  })

  alarms.addInvocationErrorAlarm({
    appendToAlarmDescription: "Runbook at https://liflig.no",
  })

  expect(stack).toMatchCdkSnapshot()
})
