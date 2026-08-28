import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Stack } from "aws-cdk-lib"
import * as logs from "aws-cdk-lib/aws-logs"
import { KinesisToDatadogStream } from "../kinesis-to-datadog-stream"

configureCdkSnapshots()

test("create kinesis stream", (t) => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack", {
    env: {
      region: "eu-west-1",
    },
  })
  const stack = new Stack(app, "Stack", {
    env: {
      region: "eu-west-1",
    },
  })

  const logGroup = new logs.LogGroup(supportStack, "LogGroup")

  new KinesisToDatadogStream(stack, "KinesisToDatadogStream", {
    logGroups: [logGroup],
    datadogApiKeySecretName: "DATADOG-SECRET",
  })

  t.assert.snapshot(cdkTemplate(stack))
})
