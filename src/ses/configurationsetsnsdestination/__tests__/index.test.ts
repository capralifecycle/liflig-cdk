import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Stack } from "aws-cdk-lib"
import * as sns from "aws-cdk-lib/aws-sns"
import { ConfigurationSetSnsDestination } from "../index"

configureCdkSnapshots()

test("configuration-set-sns-destination", (t) => {
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

  t.assert.snapshot(
    cdkTemplate(stack, {
      ignoreAssets: true,
    }),
  )
})
