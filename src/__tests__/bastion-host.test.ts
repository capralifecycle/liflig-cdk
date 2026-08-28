import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Stack } from "aws-cdk-lib"
import { SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2"
import { BastionHost } from ".."

configureCdkSnapshots()

test("minimal bastion-host", (t) => {
  const app = new App()
  const stack1 = new Stack(app, "Stack1")
  const stack2 = new Stack(app, "Stack2")

  const vpc = new Vpc(stack1, "Vpc")

  new BastionHost(stack2, "BastionHost", {
    vpc,
  })

  t.assert.snapshot(cdkTemplate(stack2))
})

test("bastion-host with custom security group", (t) => {
  const app = new App()
  const stack1 = new Stack(app, "Stack1")
  const stack2 = new Stack(app, "Stack2")

  const vpc = new Vpc(stack1, "Vpc")
  const securityGroup = new SecurityGroup(stack1, "CustomSecurityGroup", {
    vpc,
  })

  new BastionHost(stack2, "BastionHost", {
    securityGroup,
    vpc,
  })

  t.assert.snapshot(cdkTemplate(stack2))
})

test("bastion-host with custom instance name", (t) => {
  const app = new App()
  const stack1 = new Stack(app, "Stack1")
  const stack2 = new Stack(app, "Stack2")

  const vpc = new Vpc(stack1, "Vpc")

  new BastionHost(stack2, "BastionHost", {
    vpc,
    instanceName: "CustomInstanceName",
  })

  t.assert.snapshot(cdkTemplate(stack2))
})
