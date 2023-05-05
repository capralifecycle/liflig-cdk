import * as assertions from "aws-cdk-lib/assertions"
import { App, CfnOutput, Stack } from "aws-cdk-lib"
import { HostedZoneWithParam } from "../hosted-zone-with-param"

test("hosted-zone-with-param for same region", () => {
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

  expect(assertions.Template.fromStack(stack1).toJSON()).toMatchSnapshot()
  expect(assertions.Template.fromStack(stack2).toJSON()).toMatchSnapshot()
})

test("hosted-zone-with-param for different region", () => {
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

  expect(assertions.Template.fromStack(stack1).toJSON()).toMatchSnapshot()
  expect(assertions.Template.fromStack(stack2).toJSON()).toMatchSnapshot()
})
