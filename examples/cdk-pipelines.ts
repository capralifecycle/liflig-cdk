import {
  CfnOutput,
  Construct,
  Stack,
  StackProps,
  Stage,
  StageProps,
} from "@aws-cdk/core"
import { LifligCdkPipeline } from "../src/cdk-pipelines"

class ExampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    new CfnOutput(this, "ExampleOutput", {
      value: "hello world",
    })
  }
}

class ExampleStage extends Stage {
  constructor(scope: Construct, id: string, props?: StageProps) {
    super(scope, id, props)

    new ExampleStack(this, "example")
  }
}

export class LifligCdkPipelineCdkSourceStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    const pipeline = new LifligCdkPipeline(this, "Pipeline", {
      pipelineName: "test-pipeline",
      sourceType: "cdk-source",
    })

    pipeline.cdkPipeline.addStage(new ExampleStage(this, "example"))
  }
}

export class LifligCdkPipelineCloudAssemblyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    const pipeline = new LifligCdkPipeline(this, "Pipeline", {
      pipelineName: "test-pipeline",
      sourceType: "cloud-assembly",
    })

    pipeline.cdkPipeline.addStage(new ExampleStage(this, "example"))
  }
}
