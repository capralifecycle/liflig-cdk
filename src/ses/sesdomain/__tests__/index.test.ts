import { HostedZone } from "@aws-cdk/aws-route53"
import { App, Stack } from "@aws-cdk/core"
import "jest-cdk-snapshot"
import { SesDomain } from ".."

test("ses-domain with hosted zone", () => {
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

  expect(stack).toMatchCdkSnapshot({
    ignoreAssets: true,
  })
})

test("ses-domain without hosted zone", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  new SesDomain(stack, "SesDomain", {
    domainName: "example.com",
  })

  expect(stack).toMatchCdkSnapshot({
    ignoreAssets: true,
  })
})

test("ses-domain with default configuration set", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  new SesDomain(stack, "SesDomain", {
    domainName: "example.com",
    defaultConfigurationSetName: "exampleconfigset",
  })

  expect(stack).toMatchCdkSnapshot({
    ignoreAssets: true,
  })
})
