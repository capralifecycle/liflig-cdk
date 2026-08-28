import assert from "node:assert/strict"
import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Stack } from "aws-cdk-lib"
import { Template } from "aws-cdk-lib/assertions"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as logs from "aws-cdk-lib/aws-logs"
import * as sns from "aws-cdk-lib/aws-sns"
import { LambdaAlarms } from "../lambda-alarms"

configureCdkSnapshots()

test("no handler: metric-based error filter is created", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  const topic = new sns.Topic(stack, "Topic")
  const action = new cloudwatchActions.SnsAction(topic)

  const fn = new lambda.Function(stack, "TestedLambda", {
    runtime: lambda.Runtime.NODEJS_24_X,
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

  const template = Template.fromStack(stack)

  template.hasResourceProperties("AWS::Logs::MetricFilter", {
    MetricTransformations: [
      {
        MetricName: "Errors",
      },
    ],
  })

  template.resourceCountIs("AWS::Logs::SubscriptionFilter", 0)

  t.assert.snapshot(cdkTemplate(stack))
})

test("with handler: subscription filter is created and metric filter omitted", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack2")

  const topic = new sns.Topic(stack, "Topic2")
  const action = new cloudwatchActions.SnsAction(topic)

  const fn = new lambda.Function(stack, "TestedLambda2", {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => {}"),
  })

  const handlerFn = new lambda.Function(stack, "Handler", {
    runtime: lambda.Runtime.NODEJS_24_X,
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

  const template = Template.fromStack(stack)

  assert.ok(
    Object.keys(template.findResources("AWS::Logs::SubscriptionFilter"))
      .length > 0,
    "expected a subscription filter",
  )
  template.resourceCountIs("AWS::Logs::MetricFilter", 0)
  t.assert.snapshot(cdkTemplate(stack))
})

test("creates invocation error alarms (single and multiple) with defaults", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack3")

  const topic = new sns.Topic(stack, "Topic3")
  const action = new cloudwatchActions.SnsAction(topic)

  const fn = new lambda.Function(stack, "TestedLambda3", {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => {}"),
  })

  const alarms = new LambdaAlarms(stack, "LambdaAlarms3", {
    alarmAction: action,
    warningAction: action,
    lambdaFunction: fn,
  })

  alarms.addInvocationErrorAlarm()

  const template = Template.fromStack(stack)

  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    Namespace: "AWS/Lambda",
    MetricName: "Errors",
    EvaluationPeriods: 1,
    Threshold: 1,
  })

  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    Namespace: "AWS/Lambda",
    MetricName: "Errors",
    EvaluationPeriods: 3,
    Threshold: 1,
  })

  t.assert.snapshot(cdkTemplate(stack))
})

test("addUncaughtJavaExceptionAlarm: without logHandler creates metric filter and alarm", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack-UJ-1")

  const topic = new sns.Topic(stack, "Topic-UJ-1")
  const action = new cloudwatchActions.SnsAction(topic)

  const fn = new lambda.Function(stack, "TestedLambda-UJ-1", {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => {}"),
  })

  const logGroup = new logs.LogGroup(stack, "LogGroup-UJ-1")

  const alarms = new LambdaAlarms(stack, "LambdaAlarms-UJ-1", {
    alarmAction: action,
    warningAction: action,
    lambdaFunction: fn,
  })

  alarms.addUncaughtJavaExceptionAlarm({ logGroup, enabled: true })

  const template = Template.fromStack(stack)

  // Should create a metric filter specifically for UncaughtJavaException
  template.hasResourceProperties("AWS::Logs::MetricFilter", {
    MetricTransformations: [
      {
        MetricName: "UncaughtJavaException",
      },
    ],
  })

  // Should create a CloudWatch alarm for that metric
  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    MetricName: "UncaughtJavaException",
  })

  // No subscription filter when logHandler is not set
  template.resourceCountIs("AWS::Logs::SubscriptionFilter", 0)

  t.assert.snapshot(cdkTemplate(stack))
})

test("addUncaughtJavaExceptionAlarm: with logHandler creates subscription filter and no metric filter", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack-UJ-2")

  const topic = new sns.Topic(stack, "Topic-UJ-2")
  const action = new cloudwatchActions.SnsAction(topic)

  const fn = new lambda.Function(stack, "TestedLambda-UJ-2", {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => {}"),
  })

  const handlerFn = new lambda.Function(stack, "Handler-UJ-2", {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => {}"),
  })

  const logGroup = new logs.LogGroup(stack, "LogGroup-UJ-2")

  const alarms = new LambdaAlarms(stack, "LambdaAlarms-UJ-2", {
    alarmAction: action,
    warningAction: action,
    lambdaFunction: fn,
    logHandler: handlerFn,
  })

  alarms.addUncaughtJavaExceptionAlarm({ logGroup, enabled: true })

  const template = Template.fromStack(stack)

  // Should create a subscription filter forwarding logs to handlerFn
  assert.ok(
    Object.keys(template.findResources("AWS::Logs::SubscriptionFilter"))
      .length > 0,
    "expected a subscription filter",
  )

  // Should not create a metric filter when handler exists
  template.resourceCountIs("AWS::Logs::MetricFilter", 0)

  t.assert.snapshot(cdkTemplate(stack))
})
