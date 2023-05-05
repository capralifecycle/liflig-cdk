import * as assertions from "aws-cdk-lib/assertions"
import { App, Stack } from "aws-cdk-lib"
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

  expect(assertions.Template.fromStack(stack).toJSON()).toMatchSnapshot()
})
