import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import * as logs from "aws-cdk-lib/aws-logs"
import "jest-cdk-snapshot"
import { KinesisToDatadogStream } from "../kinesis-to-datadog-stream"

test("create kinesis stream", () => {
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

  expect(stack).toMatchCdkSnapshot()
})
