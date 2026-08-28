import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Stack } from "aws-cdk-lib"
import { SesVerifyEmail } from ".."

configureCdkSnapshots()

test("ses-verify-email", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  new SesVerifyEmail(stack, "SesVerifyEmail", {
    emailAddress: "example@example.com",
  })

  t.assert.snapshot(
    cdkTemplate(stack, {
      ignoreAssets: true,
    }),
  )
})
