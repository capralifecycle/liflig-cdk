import { App, Stack } from "aws-cdk-lib"
import * as sns from "aws-cdk-lib/aws-sns"
import "jest-cdk-snapshot"
import { ConfigurationSetSnsDestination } from "../index"

test("configuration-set-sns-destination", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  const snsTopic = new sns.Topic(stack, "Topic")

  new ConfigurationSetSnsDestination(stack, "SnsDestination", {
    configurationSetName: "exampleconfigurationset",
    eventDestinationName: "sns",
    snsTopic: snsTopic,
    matchingEventTypes: [
      "BOUNCE",
      "COMPLAINT",
      "DELIVERY",
      "DELIVERY_DELAY",
      "REJECT",
      "SEND",
    ],
  })

  expect(stack).toMatchCdkSnapshot({
    ignoreAssets: true,
  })
})
