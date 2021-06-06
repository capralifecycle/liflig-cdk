import { App, Stack } from "@aws-cdk/core"
import { getEcrRepository } from ".."
import { getS3Bucket } from "../artifacts"

test("can retrieve ecr repository multiple times", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  const arn = "arn:aws:ecr:eu-west-1:123456789012:repository/example"
  const name = "example"

  const ecrRepo1 = getEcrRepository(stack, arn, name)
  const ecrRepo2 = getEcrRepository(stack, arn, name)

  expect(ecrRepo1.node.id).toBe(ecrRepo2.node.id)
})

test("can retrieve s3 bucket multiple times", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  const name = "example"

  const bucket1 = getS3Bucket(stack, name)
  const bucket2 = getS3Bucket(stack, name)

  expect(bucket1.node.id).toBe(bucket2.node.id)
})
