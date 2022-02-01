import * as constructs from "constructs"
import * as cdk from "aws-cdk-lib"
import { BuildArtifacts } from "../src"

export class BuildArtifactsStack extends cdk.Stack {
  constructor(scope: constructs.Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props)

    new BuildArtifacts(this, "BuildArtifacts", {
      bucketName: "some-bucket-name",
      ciRoleName: "some-ci-role-name",
      ecrRepositoryName: "some-ecr-repo-name",
      externalRoleArn: "role-arn",
      targetAccountIds: ["112233445566"],
    })
  }
}
