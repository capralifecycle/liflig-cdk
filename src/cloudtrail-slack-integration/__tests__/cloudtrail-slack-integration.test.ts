import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import * as sns from "aws-cdk-lib/aws-sns"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import "jest-cdk-snapshot"
import { CloudTrailSlackIntegration } from ".."

test("setup new cloudtrail to slack integration", () => {
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

  expect(stack).toMatchCdkSnapshot()
})

test("setup new cloudtrail to slack integration with event deduplication", () => {
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

  expect(stack).toMatchCdkSnapshot()
})

test("setup new cloudtrail to slack integration with event deduplication and infrastructure slack alarms", () => {
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

  expect(stack).toMatchCdkSnapshot()
})
