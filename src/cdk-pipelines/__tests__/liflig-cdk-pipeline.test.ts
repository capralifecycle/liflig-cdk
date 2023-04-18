import * as assertions from "aws-cdk-lib/assertions"
import { App, CfnOutput, Stack, Stage } from "aws-cdk-lib"
import { LifligCdkPipeline } from "../liflig-cdk-pipeline"
import { FEATURE_FLAG_CDK_PIPELINES_SPEED_UP } from "../../feature-flags"

test("liflig-cdk-pipeline-with-feature-flag", () => {
  const app = new App({
    context: {
      [FEATURE_FLAG_CDK_PIPELINES_SPEED_UP]: true,
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
    sourceType: "cdk-source",
  })

  pipeline.cdkPipeline.addStage(stage)
  const template = assertions.Template.fromStack(pipelineStack)

  // Assert that S3 polling is deactivated
  template.hasResourceProperties("AWS::CodePipeline::Pipeline", {
    Stages: assertions.Match.arrayWith([
      assertions.Match.objectLike({
        Actions: assertions.Match.arrayWith([
          assertions.Match.objectLike({
            ActionTypeId: assertions.Match.objectEquals({
              Category: "Source",
              Owner: "AWS",
              Provider: "S3",
              Version: "1",
            }),
            Configuration: assertions.Match.objectLike({
              PollForSourceChanges: false,
            }),
          }),
        ]),
      }),
    ]),
  })

  // Assert that there are no actions that creates changesets
  template.hasResourceProperties("AWS::CodePipeline::Pipeline", {
    Stages: assertions.Match.not(
      assertions.Match.arrayWith([
        assertions.Match.objectLike({
          Actions: assertions.Match.arrayWith([
            assertions.Match.objectLike({
              ActionTypeId: assertions.Match.objectEquals({
                Category: "Deploy",
                Owner: "AWS",
                Provider: "CloudFormation",
                Version: "1",
              }),
              Configuration: assertions.Match.objectLike({
                ActionMode: "CHANGE_SET_REPLACE",
              }),
            }),
          ]),
        }),
      ]),
    ),
  })
  // Assert that there's an EventBridge rule set up to trigger the pipeline
  template.hasResource("AWS::Events::Rule", {})
})
