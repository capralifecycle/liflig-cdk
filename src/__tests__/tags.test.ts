import { ABSENT } from "@aws-cdk/assert"
import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import * as acm from "aws-cdk-lib/aws-certificatemanager"
import * as r53 from "aws-cdk-lib/aws-route53"
import { Bucket } from "aws-cdk-lib/aws-s3"
import { tagResources } from ".."

test("should tag a taggable resource", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  new Bucket(stack, "Bucket")

  tagResources(app, () => ({
    TestTag: "abc",
  }))

  expect(stack).toHaveResourceLike("AWS::S3::Bucket", {
    Tags: [
      {
        Key: "TestTag",
        Value: "abc",
      },
    ],
  })
})

// See https://github.com/aws/aws-cdk/issues/14519#issuecomment-833103147
test("should not tag DnsValidatedCertificate", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  new acm.DnsValidatedCertificate(stack, "Cert", {
    domainName: "example.com",
    hostedZone: new r53.HostedZone(stack, "HostedZone", {
      zoneName: "example.com",
    }),
  })

  tagResources(app, () => ({
    TestTag: "abc",
  }))

  expect(stack).toHaveResourceLike("AWS::CloudFormation::CustomResource", {
    // No tags.
    Tags: ABSENT,
  })
})
