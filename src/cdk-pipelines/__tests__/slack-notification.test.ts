import "@aws-cdk/assert/jest"
import { App, CfnOutput, Stack, Stage } from "aws-cdk-lib"
import { LifligCdkPipeline } from "../liflig-cdk-pipeline"
import { SlackNotification } from "../slack-notification"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"

test("slack-notification", () => {
  const app = new App({
    context: {
      "@aws-cdk/core:newStyleStackSynthesis": true,
    },
  })

  const supportStack = new Stack(app, "SupportStack")

  const secret = new secretsmanager.Secret(supportStack, "TestSecret", {
    secretName: "TestSecret",
  })

  const stage = new Stage(app, "Stage")
  const stack = new Stack(stage, "Stack")
  new CfnOutput(stack, "ExampleOutput", {
    value: "hello world",
  })

  const pipelineStack = new Stack(app, "PipelineStack")

  const pipeline = new LifligCdkPipeline(pipelineStack, "Pipeline", {
    pipelineName: "test-pipeline",
    sourceType: "cloud-assembly",
  })

  pipeline.cdkPipeline.addStage(stage)

  pipeline.addSlackNotification({
    slackWebhookUrlSecret: secret,
  })

  new SlackNotification(pipelineStack, "ExtraSlackNotification", {
    pipeline: pipeline.codePipeline,
    slackWebhookUrlSecret: secret,
    artifactsBucket: pipeline.artifactsBucket,
  })

  expect(pipelineStack).toHaveResourceLike("AWS::Events::Rule", {
    EventPattern: {
      source: ["aws.codepipeline"],
    },
  })
})
