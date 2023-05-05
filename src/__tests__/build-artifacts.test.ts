import * as assertions from "aws-cdk-lib/assertions"
import { App, Stack } from "aws-cdk-lib"
import { BuildArtifacts } from "../build-artifacts"

test("add policy to Griid role", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  new BuildArtifacts(stack, "BuildArtifacts", {
    griid: true,
    ecrRepositoryName: "some-ecr-repo-name",
    targetAccountIds: ["112233445566"],
  })

  assertions.Template.fromStack(stack).hasResourceProperties(
    "AWS::IAM::Policy",
    {
      Roles: assertions.Match.arrayWith(["CIExternalAccessRole"]),
      PolicyDocument: assertions.Match.objectLike({
        Statement: assertions.Match.arrayWith([
          assertions.Match.objectLike({
            Action: "ssm:PutParameter",
          }),
        ]),
      }),
    },
  )
})
