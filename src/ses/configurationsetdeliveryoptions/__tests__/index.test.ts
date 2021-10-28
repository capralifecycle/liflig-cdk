import { App, Stack } from "@aws-cdk/core"
import "jest-cdk-snapshot"
import { ConfigurationSetDeliveryOptions } from "../index"

test("configuration-set-delivery-options", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  new ConfigurationSetDeliveryOptions(stack, "DeliveryOptions", {
    configurationSetName: "exampleconfigurationset",
    tlsPolicy: "REQUIRE",
    sendingPoolName: "Test",
  })

  expect(stack).toMatchCdkSnapshot({
    ignoreAssets: true,
  })
})
