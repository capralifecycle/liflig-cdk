#!/usr/bin/env node
import * as cdk from "@aws-cdk/core"
import "source-map-support/register"
import { EcsUpdateImageArtifactStatus, tagResources } from "../src"
import { CdkDeployStack } from "./cdk-deploy-stack"
import { EcsUpdateImageStack } from "./ecs-update-image-stack"

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
