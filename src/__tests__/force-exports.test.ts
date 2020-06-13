import { Vpc } from "@aws-cdk/aws-ec2"
import { App, Stack } from "@aws-cdk/core"
import "jest-cdk-snapshot"
import { ForceExports } from "../force-exports"

test("force-exports", () => {
  const app = new App()
  const stack1 = new Stack(app, "Stack1")

  const vpc = new Vpc(stack1, "Vpc")

  const forceExports = new ForceExports(stack1)
  forceExports.register(vpc.vpcId)
  for (const subnet of vpc.privateSubnets.concat(vpc.publicSubnets)) {
    forceExports.register(subnet.subnetId)
  }

  expect(forceExports).toMatchCdkSnapshot()
  expect(forceExports.node.id).toBe("EXPORTS-Stack1")
})
