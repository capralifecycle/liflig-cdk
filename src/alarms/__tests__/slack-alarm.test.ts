import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import "jest-cdk-snapshot"
import { SlackAlarm } from "../slack-alarm"

test("create slack alarm resources", () => {
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

  expect(stack).toHaveResource("AWS::SNS::Topic")

  // Synthesize to obtain the packaged assets and final template
  const assembly = app.synth()
  const synthStack = assembly.getStackByName(stack.stackName)

  // We expect two Lambda functions: the alarm SNS handler and the log-handler
  const lambdaFunctions = Object.values(
    synthStack.template?.Resources ?? {},
  ).filter((r: any) => r.Type === "AWS::Lambda::Function")
  expect(lambdaFunctions.length).toBeGreaterThanOrEqual(2)

  expect(synthStack.template?.Resources).toBeDefined()
  expect(stack).toHaveResourceLike("AWS::SNS::Subscription", {
    Protocol: "lambda",
  })

  expect(stack).toMatchCdkSnapshot()
})
