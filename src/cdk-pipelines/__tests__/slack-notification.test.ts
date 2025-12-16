import "@aws-cdk/assert/jest"
import { App, CfnOutput, Stack, Stage } from "aws-cdk-lib"
import { Bucket } from "aws-cdk-lib/aws-s3"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import { LifligCdkPipeline } from "../liflig-cdk-pipeline"
import { SlackNotification } from "../slack-notification"

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

  const artifactsBucket = new Bucket(pipelineStack, "ArtifactsBucket")
  const pipeline = new LifligCdkPipeline(pipelineStack, "Pipeline", {
    artifactsBucket: artifactsBucket,
    pipelineName: "test-pipeline",
    sourceType: "cloud-assembly",
  })

  pipeline.cdkPipeline.addStage(stage)

  const slackMentions = {
    here: { raw: "@here", expected: "<!here>" },
    user: { raw: "U1234567890", expected: "<@U1234567890>" },
    workspace_user: { raw: "WABCDEFGHIJ", expected: "<@WABCDEFGHIJ>" },
    group: { raw: "S9876543210", expected: "<!subteam^S9876543210>" },
  }

  pipeline.addSlackNotification({
    slackWebhookUrlSecret: secret,
    mentions: [
      slackMentions.here.raw,
      slackMentions.user.raw,
      slackMentions.workspace_user.raw,
      slackMentions.group.raw,
    ],
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

  const expectedFormattedSlackMentions = [
    slackMentions.here.expected,
    slackMentions.user.expected,
    slackMentions.workspace_user.expected,
    slackMentions.group.expected,
  ].join(" ")

  expect(pipelineStack).toHaveResourceLike("AWS::Lambda::Function", {
    Environment: {
      Variables: {
        SLACK_MENTIONS: expectedFormattedSlackMentions,
      },
    },
  })
})
