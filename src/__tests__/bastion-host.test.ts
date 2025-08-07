import { App, Stack } from "aws-cdk-lib"
import { SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2"
import "jest-cdk-snapshot"
import { BastionHost } from ".."

test("minimal bastion-host", () => {
  const app = new App()
  const stack1 = new Stack(app, "Stack1")
  const stack2 = new Stack(app, "Stack2")

  const vpc = new Vpc(stack1, "Vpc")

  new BastionHost(stack2, "BastionHost", {
    vpc,
  })

  expect(stack2).toMatchCdkSnapshot()
})

test("bastion-host with custom security group", () => {
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

  expect(stack2).toMatchCdkSnapshot()
})
