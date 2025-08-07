import { App, type CfnElement, Stack } from "aws-cdk-lib"
import { Match, Template } from "aws-cdk-lib/assertions"
import * as cw_actions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as sns from "aws-cdk-lib/aws-sns"
import "jest-cdk-snapshot"
import { WebappMonitor } from ".."

test("App monitor default vaules snapshot test", () => {
  const app = new App()

  const appMonitorStack = new Stack(app, "AppMonitorStack")

  new WebappMonitor(appMonitorStack, "WebappMonitor", {
    webappDomainName: "webappdomain.example",
    appMonitorName: "local",
    telemetries: ["errors", "http", "performance"],
    defaultAlarmAction: new cw_actions.SnsAction(
      new sns.Topic(appMonitorStack, "Topic"),
    ),
  })

  expect(appMonitorStack).toMatchCdkSnapshot()
})

test("App monitor has custom events alarm properties", () => {
  const app = new App()

  const appMonitorStack = new Stack(app, "AppMonitorStack")

  const alarmActionTopic = new sns.Topic(appMonitorStack, "Topic")

  const alarmAction = new cw_actions.SnsAction(alarmActionTopic)

  const monitor = new WebappMonitor(appMonitorStack, "WebappMonitor", {
    webappDomainName: "webappdomain.example",
    appMonitorName: "AppMonitor",
    telemetries: ["http", "errors", "performance"],
    defaultAlarmAction: alarmAction,
  })

  monitor.configureEventsAlarm({
    enableOkAlarm: true,
  })

  monitor.addErrorsAlarm()

  const template = Template.fromStack(appMonitorStack)

  const snsTopicLogicalId = appMonitorStack.getLogicalId(
    alarmActionTopic.node.findChild("Resource") as CfnElement,
  )

  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    AlarmActions: [
      Match.objectEquals({
        Ref: snsTopicLogicalId,
      }),
    ],
    OKActions: [
      Match.objectEquals({
        Ref: snsTopicLogicalId,
      }),
    ],
    MetricName: "RumEventPayloadSize",
    Namespace: "AWS/RUM",
  })

  template.hasResourceProperties("AWS::CloudWatch::Alarm", {
    AlarmActions: [
      Match.objectEquals({
        Ref: snsTopicLogicalId,
      }),
    ],
    MetricName: "JsErrorCount",
    Namespace: "AWS/RUM",
  })

  // Since adding error alarm, alarm count is now 2
  template.resourceCountIs("AWS::CloudWatch::Alarm", 2)
})
