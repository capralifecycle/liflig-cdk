import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Stack } from "aws-cdk-lib"
import { HostedZone } from "aws-cdk-lib/aws-route53"
import { SesDomain } from ".."

configureCdkSnapshots()

test("ses-domain with hosted zone", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  const hostedZone = HostedZone.fromHostedZoneId(
    stack,
    "HostedZone",
    "ABCDEF12345678",
  )

  new SesDomain(stack, "SesDomain", {
    domainName: "example.com",
    hostedZone: hostedZone,
  })

  t.assert.snapshot(
    cdkTemplate(stack, {
      ignoreAssets: true,
    }),
  )
})

test("ses-domain without hosted zone", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  new SesDomain(stack, "SesDomain", {
    domainName: "example.com",
  })

  t.assert.snapshot(
    cdkTemplate(stack, {
      ignoreAssets: true,
    }),
  )
})

test("ses-domain with default configuration set", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  new SesDomain(stack, "SesDomain", {
    domainName: "example.com",
    defaultConfigurationSetName: "exampleconfigset",
  })

  t.assert.snapshot(
    cdkTemplate(stack, {
      ignoreAssets: true,
    }),
  )
})

test("ses-domain with custom SPF values", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  new SesDomain(stack, "SesDomain", {
    domainName: "example.com",
    spfRecord: {
      value:
        "v=spf1 include:spf.protection.outlook.com include:_spf.intility.com -all",
    },
  })

  t.assert.snapshot(
    cdkTemplate(stack, {
      ignoreAssets: true,
    }),
  )
})
