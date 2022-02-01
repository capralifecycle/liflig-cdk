import { Distribution } from "aws-cdk-lib/aws-cloudfront"
import { Bucket } from "aws-cdk-lib/aws-s3"
import { App, Stack } from "aws-cdk-lib"
import "jest-cdk-snapshot"
import { WebappDeployViaRole } from "../webapp-deploy-via-role"

test("webapp-deploy-via-role", () => {
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

  expect(stack1).toMatchCdkSnapshot()
})
