import * as cdk from "@aws-cdk/core"
import { CdkDeploy } from "../src"

export class CdkDeployStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props)

    new CdkDeploy(this, "CdkDeploy", {
      callerRoleArn: "role-arn",
      roleName: "some-role-name",
      artifactsBucketName: "artifacts",
      startDeployFunctionName: "start-deploy",
      statusFunctionName: "status",
      cdkToolkitStackName: "cdk",
      cdkContext: {},
    })
  }
}
