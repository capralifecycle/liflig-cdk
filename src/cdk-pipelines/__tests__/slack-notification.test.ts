import "@aws-cdk/assert/jest"
import { App, CfnOutput, Stack, Stage } from "aws-cdk-lib"
import { LifligCdkPipeline } from "../liflig-cdk-pipeline"

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

  expect(pipelineStack).toHaveResourceLike("AWS::Events::Rule", {
    EventPattern: {
      source: ["aws.codepipeline"],
    },
  })
})
