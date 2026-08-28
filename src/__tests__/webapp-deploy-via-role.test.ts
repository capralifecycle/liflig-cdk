import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Stack } from "aws-cdk-lib"
import { Distribution } from "aws-cdk-lib/aws-cloudfront"
import { Bucket } from "aws-cdk-lib/aws-s3"
import { WebappDeployViaRole } from "../webapp-deploy-via-role"

configureCdkSnapshots()

test("webapp-deploy-via-role", (t) => {
  const app = new App()
  const stack1 = new Stack(app, "Stack1")

  const buildsBucket = Bucket.fromBucketName(
    stack1,
    "BuildsBucket",
    "bucket-name",
  )

  const webBucket = new Bucket(stack1, "WebBucket")

  const distribution = Distribution.fromDistributionAttributes(
    stack1,
    "Distribution",
    {
      distributionId: "EKJ2IPY1KTEAR1",
      domainName: "example.com",
    },
  )

  new WebappDeployViaRole(stack1, "WebappDeploy", {
    externalRoleArn: "arn:aws:iam::112233445566:role/some-role",
    roleName: "my-role",
    webappDeploy: {
      buildsBucket,
      webBucket,
      distribution,
    },
  })

  t.assert.snapshot(cdkTemplate(stack1))
})
