#!/usr/bin/env node
import * as cdk from "@aws-cdk/core"
import "source-map-support/register"
import { EcsUpdateImageArtifactStatus, tagResources } from "../src"
import { BuildArtifactsStack } from "./build-artifacts"
import { CdkDeployStack } from "./cdk-deploy-stack"
import { EcsUpdateImageStack } from "./ecs-update-image-stack"

// NOTE: New stacks must be added to the manual-stacks.txt file
// so that the jenkinsfileCheckReferencedStacks test works
// as expected.

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

new CdkDeployStack(app, "cdk-deploy-example", { env })

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
