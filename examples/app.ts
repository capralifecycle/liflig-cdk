#!/usr/bin/env node
import * as cdk from "@aws-cdk/core"
import "source-map-support/register"
import { tagResources } from "../src/tags"

const app = new cdk.App()
tagResources(app, (stack) => ({
  StackName: stack.stackName,
  Project: "my-project",
  SourceRepo: "github/capralifecycle/liflig-cdk",
}))

new cdk.Stack(app, "example1", {
  env: {
    account: "112233445566",
    region: "eu-west-1",
  },
})

new cdk.Stack(app, "example2", {
  env: {
    account: "112233445566",
    region: "eu-west-1",
  },
})
