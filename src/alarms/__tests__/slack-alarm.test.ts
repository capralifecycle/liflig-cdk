import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import "jest-cdk-snapshot"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import { SlackAlarm } from "../slack-alarm"

test("create slack alarm", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  const secret = new secretsmanager.Secret(stack, "TestSecret", {
    secretName: "TestSecret",
  })

  new SlackAlarm(stack, "SlackAlarm", {
    envName: "dev",
    projectName: "my-project",
    slackWebhookUrlSecret: secret,
  })

  expect(stack).toMatchCdkSnapshot()
})
