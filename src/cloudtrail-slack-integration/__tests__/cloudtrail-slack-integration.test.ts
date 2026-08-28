import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Stack } from "aws-cdk-lib"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as sns from "aws-cdk-lib/aws-sns"
import { CloudTrailSlackIntegration } from ".."

configureCdkSnapshots()

test("setup new cloudtrail to slack integration", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack", {
    env: {
      region: "us-east-1",
    },
  })

  new CloudTrailSlackIntegration(stack, "CloudTrailSlackIntegration", {
    slackChannel: "#example-channel",
    slackWebhookUrl:
      "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX",
    rolesToMonitor: ["arn:aws:iam::123456789012:role/example-role"],
    friendlyNames: {
      "123456789012": "example-friendly-name",
    },
  })

  t.assert.snapshot(cdkTemplate(stack))
})

test("setup new cloudtrail to slack integration with event deduplication", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack", {
    env: {
      region: "us-east-1",
    },
  })

  new CloudTrailSlackIntegration(stack, "CloudTrailSlackIntegration", {
    slackChannel: "#example-channel",
    slackWebhookUrl:
      "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX",
    rolesToMonitor: ["arn:aws:iam::123456789012:role/example-role"],
    deduplicateEvents: true,
  })

  t.assert.snapshot(cdkTemplate(stack))
})

test("setup new cloudtrail to slack integration with event deduplication and infrastructure slack alarms", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack", {
    env: {
      region: "us-east-1",
    },
  })
  const topic = new sns.Topic(stack, "Topic")
  const action = new cloudwatchActions.SnsAction(topic)

  new CloudTrailSlackIntegration(stack, "CloudTrailSlackIntegration", {
    slackChannel: "#example-channel",
    slackWebhookUrl:
      "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX",
    rolesToMonitor: ["arn:aws:iam::123456789012:role/example-role"],
    deduplicateEvents: true,
    infrastructureAlarmAction: action,
  })

  t.assert.snapshot(cdkTemplate(stack))
})
