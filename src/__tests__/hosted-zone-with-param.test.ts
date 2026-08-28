import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, CfnOutput, Stack } from "aws-cdk-lib"
import { HostedZoneWithParam } from "../hosted-zone-with-param"

configureCdkSnapshots()

test("hosted-zone-with-param for same region", (t) => {
  const app = new App()
  const stack1 = new Stack(app, "Stack1", {
    env: {
      region: "eu-west-1",
    },
  })
  const stack2 = new Stack(app, "Stack2", {
    env: {
      region: "eu-west-1",
    },
  })

  const hostedZone1 = new HostedZoneWithParam(stack1, "HostedZone", {
    zoneName: "example.com",
  })

  const hostedZone2 = hostedZone1.getHostedZone(stack2, "HostedZone")

  new CfnOutput(stack2, "HostedZoneId", {
    value: hostedZone2.hostedZoneId,
  })

  t.assert.snapshot(cdkTemplate(stack1))
  t.assert.snapshot(cdkTemplate(stack2))
})

test("hosted-zone-with-param for different region", (t) => {
  const app = new App()
  const stack1 = new Stack(app, "Stack1", {
    env: {
      region: "eu-west-1",
    },
  })
  const stack2 = new Stack(app, "Stack2", {
    env: {
      region: "us-east-1",
    },
  })

  const hostedZone1 = new HostedZoneWithParam(stack1, "HostedZone", {
    zoneName: "example.com",
  })

  const hostedZone2 = hostedZone1.getHostedZone(stack2, "HostedZone")

  new CfnOutput(stack2, "HostedZoneId", {
    value: hostedZone2.hostedZoneId,
  })

  t.assert.snapshot(cdkTemplate(stack1))
  t.assert.snapshot(cdkTemplate(stack2))
})
