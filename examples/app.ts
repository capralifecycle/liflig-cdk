#!/usr/bin/env node
import * as cdk from "aws-cdk-lib"
import "source-map-support/register"
import { EcsUpdateImageArtifactStatus, tagResources } from "../src"
import { BuildArtifactsStack } from "./build-artifacts"
import {
  LifligCdkPipelineCdkSourceStack,
  LifligCdkPipelineCloudAssemblyStack,
} from "./cdk-pipelines"
import { EcsUpdateImageStack } from "./ecs-update-image-stack"
import { SsmParameterReaderStack } from "./ssm-parameter-reader-stack"
import { WebappStack } from "./webapp-stack"

const app = new cdk.App()
tagResources(app, (stack) => ({
  StackName: stack.stackName,
  Project: "my-project",
  SourceRepo: "github/capralifecycle/liflig-cdk",
}))

const env = {
  account: "112233445566",
  region: "eu-west-1",
}

new BuildArtifactsStack(app, "build-artifacts", { env })

new EcsUpdateImageStack(app, "ecs-update-image-no-artifact", {
  env,
  artifactStatus: new EcsUpdateImageArtifactStatus({
    artifactPushedAndTagUpdated: false,
  }),
})

new EcsUpdateImageStack(app, "ecs-update-image", {
  env,
  artifactStatus: new EcsUpdateImageArtifactStatus({
    artifactPushedAndTagUpdated: true,
  }),
})

// This stack is used primarily to have a stack with assets.
new SsmParameterReaderStack(app, "ssm-parameter-reader", { env })

// CDK Pipelines don't work well with snapshots yet.
new LifligCdkPipelineCdkSourceStack(app, "cdk-pipeline-cdk-source")
new LifligCdkPipelineCloudAssemblyStack(app, "cdk-pipeline-cloud-assembly")

new WebappStack(app, "webapp", { env })
