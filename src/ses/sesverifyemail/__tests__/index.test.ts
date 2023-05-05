import * as assertions from "aws-cdk-lib/assertions"
import { App, Stack } from "aws-cdk-lib"
import { SesVerifyEmail } from ".."

test("ses-verify-email", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  new SesVerifyEmail(stack, "SesVerifyEmail", {
    emailAddress: "example@example.com",
  })

  expect(assertions.Template.fromStack(stack).toJSON()).toMatchSnapshot()
})
