import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Stack } from "aws-cdk-lib"

configureCdkSnapshots()

test("cross-region-ssm-parameter", (t) => {
  const app = new App()
  const stack1 = new Stack(app, "Stack1", {
    env: {
      region: "us-east-1",
    },
  })

  t.assert.snapshot(cdkTemplate(stack1))
})
