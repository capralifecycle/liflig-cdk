import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Stack } from "aws-cdk-lib"
import { ConfigurationSetDeliveryOptions } from "../index"

configureCdkSnapshots()

test("configuration-set-delivery-options", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  new ConfigurationSetDeliveryOptions(stack, "DeliveryOptions", {
    configurationSetName: "exampleconfigurationset",
    tlsPolicy: "Require",
  })

  t.assert.snapshot(
    cdkTemplate(stack, {
      ignoreAssets: true,
    }),
  )
})
