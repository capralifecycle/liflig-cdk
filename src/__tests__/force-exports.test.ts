import { Vpc } from "@aws-cdk/aws-ec2"
import { Bucket } from "@aws-cdk/aws-s3"
import { App, Stack, Stage } from "@aws-cdk/core"
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

test("force-exports with stages", () => {
  const app = new App()

  const stack1 = new Stack(app, "Stack1")
  const stage1 = new Stage(stack1, "Stage")

  const stack2 = new Stack(stage1, "Stack2")

  const bucket = new Bucket(stack2, "Bucket")

  const forceExports = new ForceExports(stack2)
  forceExports.register(bucket.bucketName)

  expect(forceExports.node.id).toBe("EXPORTS-Stack2")
})
