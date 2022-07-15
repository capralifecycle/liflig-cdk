import "@aws-cdk/assert/jest"
import { App, CfnOutput, Stack, Stage } from "aws-cdk-lib"
import { LifligCdkPipeline } from "../liflig-cdk-pipeline"
import { SlackNotification } from "../slack-notification"

test("slack-notification", () => {
  const app = new App({
    context: {
      "@aws-cdk/core:newStyleStackSynthesis": true,
    },
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
    slackWebhookUrl: "https://hooks.slack.com/services/abc",
    slackChannel: "#test",
  })

  new SlackNotification(pipelineStack, "ExtraSlackNotification", {
    pipeline: pipeline.codePipeline,
    slackWebhookUrl: "https://hooks.slack.com/services/abc",
    slackChannel: "#test-other",
    singletonLambdaUuid: "f0d7e25c-8247-48bb-beb4-5b1d8ff91f30",
  })

  expect(pipelineStack).toHaveResourceLike("AWS::Events::Rule", {
    EventPattern: {
      source: ["aws.codepipeline"],
    },
  })
})
