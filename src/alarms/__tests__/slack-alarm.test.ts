import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import "jest-cdk-snapshot"
import { SlackAlarm } from "../slack-alarm"

test("create slack alarm", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  new SlackAlarm(stack, "SlackAlarm", {
    envName: "dev",
    projectName: "my-project",
    slackChannel: "#my-channel",
    slackUrl: "https://hooks.slack.com/services/ABC/DEF/123",
  })

  expect(stack).toMatchCdkSnapshot()
})
