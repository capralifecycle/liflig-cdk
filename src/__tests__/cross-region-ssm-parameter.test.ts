import { App, Stack } from "aws-cdk-lib"
import "jest-cdk-snapshot"

test("cross-region-ssm-parameter", () => {
  const app = new App()
  const stack1 = new Stack(app, "Stack1", {
    env: {
      region: "us-east-1",
    },
  })

  expect(stack1).toMatchCdkSnapshot()
})
