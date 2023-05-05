import * as assertions from "aws-cdk-lib/assertions"
import { App, Stack } from "aws-cdk-lib"
import { ConfigurationSetDeliveryOptions } from "../index"

test("configuration-set-delivery-options", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  new ConfigurationSetDeliveryOptions(stack, "DeliveryOptions", {
    configurationSetName: "exampleconfigurationset",
    tlsPolicy: "Require",
  })

  expect(assertions.Template.fromStack(stack).toJSON()).toMatchSnapshot()
})
