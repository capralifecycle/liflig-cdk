import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Stack } from "aws-cdk-lib"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import { SlackAlarm } from "../slack-alarm"

configureCdkSnapshots()

test("create slack alarm", (t) => {
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

  t.assert.snapshot(cdkTemplate(stack, { ignoreAssets: true }))
})
