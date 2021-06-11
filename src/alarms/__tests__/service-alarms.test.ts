import "@aws-cdk/assert/jest"
import * as cloudwatchActions from "@aws-cdk/aws-cloudwatch-actions"
import * as logs from "@aws-cdk/aws-logs"
import * as sns from "@aws-cdk/aws-sns"
import { App, Stack } from "@aws-cdk/core"
import "jest-cdk-snapshot"
import { ServiceAlarms } from "../service-alarms"

test("create alarms", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack")
  const stack = new Stack(app, "Stack")

  const topic = new sns.Topic(supportStack, "Topic")
  const snsAction = new cloudwatchActions.SnsAction(topic)

  const logGroup = new logs.LogGroup(stack, "LogGroup")

  const alarms = new ServiceAlarms(stack, "ServiceAlarms", {
    serviceName: "service-name",
    snsAction,
  })

  alarms.addJsonErrorAlarm({
    logGroup,
  })

  alarms.addTargetGroupAlarm({
    loadBalancerFullName: "app/my-load-balancer/50dc6c495c0c9188",
    targetGroupFullName: "targetgroup/my-target-group/cbf133c568e0d028",
  })

  expect(stack).toMatchCdkSnapshot()
})
