import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as sns from "aws-cdk-lib/aws-sns"
import "jest-cdk-snapshot"
import { LambdaAlarms } from "../lambda-alarms"

test("create alarms", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack")
  const stack = new Stack(app, "Stack")

  const topic = new sns.Topic(supportStack, "Topic")
  const action = new cloudwatchActions.SnsAction(topic)

  const lambdaFunction = new lambda.Function(stack, "TestedLambda", {
    runtime: lambda.Runtime.NODEJS_LATEST,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => {}"),
    functionName: "lambda-function-name",
  })

  const alarms = new LambdaAlarms(stack, "LambdaAlarms", {
    action: action,
    lambdaFunction: lambdaFunction,
  })

  alarms.addInvocationErrorAlarm({
    appendToAlarmDescription: "Runbook at https://liflig.no",
  })

  expect(stack).toMatchCdkSnapshot()
})
