import * as constructs from "constructs"
import * as cdk from "aws-cdk-lib"
import { BuildArtifacts } from "../src"

export class BuildArtifactsStack extends cdk.Stack {
  constructor(scope: constructs.Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props)

    new BuildArtifacts(this, "BuildArtifacts", {
      bucketName: "some-bucket-name",
      targetAccountIds: ["112233445566"],
      ecrRepositoryName: "some-ecr-repo-name",
      githubActions: {
        repositories: [
          {
            name: "my-repository",
            owner: "capralifecycle",
          },
        ],
      },
    })
  }
}
