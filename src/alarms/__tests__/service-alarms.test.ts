import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as sns from "aws-cdk-lib/aws-sns"
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

  // Assert an alarm exists for HTTPCode_Target_5XX_Count with the default sensitivity
  expect(stack).toHaveResourceLike("AWS::CloudWatch::Alarm", {
    MetricName: "HTTPCode_Target_5XX_Count",
    Namespace: "AWS/ApplicationELB",
    EvaluationPeriods: 1,
    Threshold: 1,
  })
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
})
