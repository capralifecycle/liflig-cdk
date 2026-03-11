import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as logs from "aws-cdk-lib/aws-logs"
import * as sns from "aws-cdk-lib/aws-sns"
import "jest-cdk-snapshot"
import { LambdaAlarms } from "../lambda-alarms"

test("no handler: metric-based error filter is created", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  const topic = new sns.Topic(stack, "Topic")
  const action = new cloudwatchActions.SnsAction(topic)

  const fn = new lambda.Function(stack, "TestedLambda", {
    runtime: lambda.Runtime.NODEJS_LATEST,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => {}"),
  })

  const logGroup = new logs.LogGroup(stack, "LogGroup")

  const alarms = new LambdaAlarms(stack, "LambdaAlarms", {
    alarmAction: action,
    warningAction: action,
    lambdaFunction: fn,
  })

  alarms.addErrorAlarm({ logGroup })

  expect(stack).toHaveResourceLike("AWS::Logs::MetricFilter", {
    MetricTransformations: [
      {
        MetricName: "Errors",
      },
    ],
  })

  expect(stack).not.toHaveResource("AWS::Logs::SubscriptionFilter")

  expect(stack).toMatchCdkSnapshot()
})

test("with handler: subscription filter is created and metric filter omitted", () => {
  const app = new App()
  const stack = new Stack(app, "Stack2")

  const topic = new sns.Topic(stack, "Topic2")
  const action = new cloudwatchActions.SnsAction(topic)

  const fn = new lambda.Function(stack, "TestedLambda2", {
    runtime: lambda.Runtime.NODEJS_LATEST,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => {}"),
  })

  const handlerFn = new lambda.Function(stack, "Handler", {
    runtime: lambda.Runtime.NODEJS_LATEST,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => {}"),
  })

  const logGroup = new logs.LogGroup(stack, "LogGroup2")

  const alarms = new LambdaAlarms(stack, "LambdaAlarms2", {
    alarmAction: action,
    warningAction: action,
    lambdaFunction: fn,
    logHandler: handlerFn,
  })

  alarms.addErrorAlarm({ logGroup })

  expect(stack).toHaveResource("AWS::Logs::SubscriptionFilter")
  expect(stack).not.toHaveResource("AWS::Logs::MetricFilter")
  expect(stack).toMatchCdkSnapshot()
})
