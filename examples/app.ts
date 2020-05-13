#!/usr/bin/env node
import * as cdk from "@aws-cdk/core"
import "source-map-support/register"
import { CdkDeploy } from "../src/cdk-deploy"
import { tagResources } from "../src/tags"

const app = new cdk.App()
tagResources(app, (stack) => ({
  StackName: stack.stackName,
  Project: "my-project",
  SourceRepo: "github/capralifecycle/liflig-cdk",
}))

const example1 = new cdk.Stack(app, "example1", {
  env: {
    account: "112233445566",
    region: "eu-west-1",
  },
})

new CdkDeploy(example1, "CdkDeploy", {
  callerRoleArn: "role-arn",
  roleName: "some-role-name",
  artifactsBucketName: "artifacts",
  startDeployFunctionName: "start-deploy",
  statusFunctionName: "status",
  cdkToolkitStackName: "cdk",
  cdkContext: {},
})

new cdk.Stack(app, "example2", {
  env: {
    account: "112233445566",
    region: "eu-west-1",
  },
})
