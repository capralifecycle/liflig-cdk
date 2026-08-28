import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Stack } from "aws-cdk-lib"
import { Bucket } from "aws-cdk-lib/aws-s3"
import { SsmParameterBackedResource } from "../ssm-parameter-backed-resource"

configureCdkSnapshots()

test("ssm-parameter-backed-resource in same region", (t) => {
  const app = new App()
  const stack1 = new Stack(app, "Stack1", {
    env: {
      region: "eu-west-1",
    },
  })

  const bucket = new Bucket(stack1, "Bucket")
  const s = new SsmParameterBackedResource(stack1, "BucketParam", {
    nonce: "123",
    parameterName: "/my-param",
    referenceToResource: Bucket.fromBucketName,
    resource: bucket,
    resourceToReference: (resource) => resource.bucketName,
    regions: ["eu-central-1", "us-east-1"],
  })

  const stack2 = new Stack(app, "Stack2", {
    env: {
      region: "eu-west-1",
    },
  })

  s.get(stack2, "Bucket")

  t.assert.snapshot(cdkTemplate(stack1))
  t.assert.snapshot(cdkTemplate(stack2))
})

test("ssm-parameter-backed-resource in different region", (t) => {
  const app = new App()
  const stack1 = new Stack(app, "Stack1", {
    env: {
      region: "eu-west-1",
    },
  })

  const bucket = new Bucket(stack1, "Bucket")
  const s = new SsmParameterBackedResource(stack1, "BucketParam", {
    nonce: "123",
    parameterName: "/my-param",
    referenceToResource: Bucket.fromBucketName,
    resource: bucket,
    resourceToReference: (resource) => resource.bucketName,
    regions: ["eu-central-1"],
  })

  const stack2 = new Stack(app, "Stack2", {
    env: {
      region: "eu-central-1",
    },
  })

  s.get(stack2, "Bucket")

  t.assert.snapshot(cdkTemplate(stack1))
  t.assert.snapshot(cdkTemplate(stack2))
})
