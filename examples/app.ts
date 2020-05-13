#!/usr/bin/env node
import * as cdk from "@aws-cdk/core"
import "source-map-support/register"
import { tagResources } from "../src/tags"
import { CdkDeployStack } from "./cdk-deploy-stack"

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
