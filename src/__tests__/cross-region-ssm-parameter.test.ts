import * as assertions from "aws-cdk-lib/assertions"
import { App, Stack } from "aws-cdk-lib"

test("cross-region-ssm-parameter", () => {
  const app = new App()
  const stack1 = new Stack(app, "Stack1", {
    env: {
      region: "us-east-1",
    },
  })
  expect(assertions.Template.fromStack(stack1).toJSON()).toMatchSnapshot()
})
