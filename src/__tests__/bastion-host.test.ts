import { SecurityGroup, Vpc } from "@aws-cdk/aws-ec2"
import { App, Stack } from "@aws-cdk/core"
import "jest-cdk-snapshot"
import { BastionHost } from ".."

test("bastion-host", () => {
  const app = new App()
  const stack1 = new Stack(app, "Stack1")
  const stack2 = new Stack(app, "Stack2")

  const vpc = new Vpc(stack1, "Vpc")
  const securityGroup = new SecurityGroup(stack1, "SecurityGroup", {
    vpc,
  })

  new BastionHost(stack2, "BastionHost", {
    securityGroup,
    vpc,
  })

  expect(stack2).toMatchCdkSnapshot()
})
