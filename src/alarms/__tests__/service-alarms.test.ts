import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as logs from "aws-cdk-lib/aws-logs"
import * as sns from "aws-cdk-lib/aws-sns"
import "jest-cdk-snapshot"
import { ServiceAlarms } from "../service-alarms"

test("create alarms", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack")
  const stack = new Stack(app, "Stack")

  const topic = new sns.Topic(supportStack, "Topic")
  const action = new cloudwatchActions.SnsAction(topic)

  const logGroup = new logs.LogGroup(stack, "LogGroup")

  const alarms = new ServiceAlarms(stack, "ServiceAlarms", {
    serviceName: "service-name",
    alarmAction: action,
    warningAction: action,
  })

  alarms.addJsonErrorAlarm({
    logGroup,
  })

  alarms.addTargetGroupAlarms({
    loadBalancerFullName: "app/my-load-balancer/50dc6c495c0c9188",
    targetGroupFullName: "targetgroup/my-target-group/cbf133c568e0d028",
  })

  expect(stack).toMatchCdkSnapshot()
})
