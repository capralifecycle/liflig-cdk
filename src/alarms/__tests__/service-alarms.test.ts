import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as sns from "aws-cdk-lib/aws-sns"
import "jest-cdk-snapshot"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as logs from "aws-cdk-lib/aws-logs"
import { ServiceAlarms } from "../service-alarms"

test("creates single 5xx alarm (enabled) with expected defaults", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack")
  const stack = new Stack(app, "Stack")

  const topic = new sns.Topic(supportStack, "Topic")
  const action = new cloudwatchActions.SnsAction(topic)

  const alarms = new ServiceAlarms(stack, "ServiceAlarms", {
    alarmAction: action,
    warningAction: action,
    serviceName: "my-service",
  })

  alarms.addTargetGroupAlarms({
    targetGroupFullName: "targetgroup/abc/123",
    loadBalancerFullName: "app/my-alb/456",
    single5xxResponseAlarm: {},
  })

  expect(stack).toHaveResourceLike("AWS::CloudWatch::Alarm", {
    MetricName: "HTTPCode_Target_5XX_Count",
    Namespace: "AWS/ApplicationELB",
    EvaluationPeriods: 1,
    Threshold: 1,
  })

  expect(stack).toMatchCdkSnapshot()
})

test("does not create single 5xx alarm when disabled", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack2")
  const stack = new Stack(app, "Stack2")

  const topic = new sns.Topic(supportStack, "Topic2")
  const action = new cloudwatchActions.SnsAction(topic)

  const alarms = new ServiceAlarms(stack, "ServiceAlarms2", {
    alarmAction: action,
    warningAction: action,
    serviceName: "my-service-2",
  })

  alarms.addTargetGroupAlarms({
    targetGroupFullName: "targetgroup/abc/456",
    loadBalancerFullName: "app/my-alb/789",
    single5xxResponseAlarm: { enabled: false },
  })

  // No alarm should be created that matches the single-5xx signature
  expect(stack).not.toHaveResourceLike("AWS::CloudWatch::Alarm", {
    MetricName: "HTTPCode_Target_5XX_Count",
    Namespace: "AWS/ApplicationELB",
    EvaluationPeriods: 1,
    Threshold: 1,
  })

  expect(stack).toMatchCdkSnapshot()
})

test("log group receives exactly two subscription filters when logHandler is present", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack-SubCount")
  const stack = new Stack(app, "Stack-SubCount")

  const topic = new sns.Topic(supportStack, "Topic-SubCount")
  const action = new cloudwatchActions.SnsAction(topic)

  const handlerFn = new lambda.Function(stack, "Handler-SubCount", {
    runtime: lambda.Runtime.NODEJS_24_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => {}"),
  })

  const alarms = new ServiceAlarms(stack, "ServiceAlarms-SubCount", {
    alarmAction: action,
    warningAction: action,
    serviceName: "svc-subcount",
    logHandler: handlerFn,
  })

  const logGroup = new logs.LogGroup(stack, "LogGroup-SubCount")

  alarms.addJsonErrorAlarm({ logGroup })
  alarms.addUncaughtJavaExceptionAlarm({ logGroup, enabled: true })

  const template = app.synth().getStackByName(stack.stackName).template
  const subs = Object.values(template.Resources).filter(
    (r: any) => r.Type === "AWS::Logs::SubscriptionFilter",
  )

  expect(subs.length).toBe(2)
})
