import { arrayWith, objectLike } from "@aws-cdk/assert"
import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import "jest-cdk-snapshot"
import { BuildArtifacts } from "../build-artifacts"

test("add policy to Griid role", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  new BuildArtifacts(stack, "BuildArtifacts", {
    griid: true,
    ecrRepositoryName: "some-ecr-repo-name",
    targetAccountIds: ["112233445566"],
  })

  expect(stack).toHaveResourceLike("AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: arrayWith(
        objectLike({
          Action: "ssm:PutParameter",
        }),
      ),
    },
    Roles: ["CIExternalAccessRole"],
  })
})
