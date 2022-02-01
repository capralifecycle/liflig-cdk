import { App, Stack } from "aws-cdk-lib"
import "jest-cdk-snapshot"
import { SesVerifyEmail } from ".."

test("ses-verify-email", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  new SesVerifyEmail(stack, "SesVerifyEmail", {
    emailAddress: "example@example.com",
  })

  expect(stack).toMatchCdkSnapshot({
    ignoreAssets: true,
  })
})
