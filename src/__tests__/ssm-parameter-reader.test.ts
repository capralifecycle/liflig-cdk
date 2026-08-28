import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Stack } from "aws-cdk-lib"
import { CfnParameter } from "aws-cdk-lib/aws-ssm"
import { SsmParameterReader } from "../ssm-parameter-reader"

configureCdkSnapshots()

test("ssm-parameter-reader", (t) => {
  const app = new App()
  const stack1 = new Stack(app, "Stack1")
  const parameterName = "/my/param"

  new CfnParameter(stack1, "Param", {
    type: "String",
    name: parameterName,
    value: "test",
  })

  const stack2 = new Stack(app, "Stack2")
  new SsmParameterReader(stack2, "ParamReader", {
    parameterName,
    region: "eu-west-1",
    nonce: "123",
  })

  t.assert.snapshot(cdkTemplate(stack2))
})
