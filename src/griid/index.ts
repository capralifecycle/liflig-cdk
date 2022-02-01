import * as constructs from "constructs"
import * as iam from "aws-cdk-lib/aws-iam"
import * as cdk from "aws-cdk-lib"

export { getGriidArtefactBucket } from "./artefact-bucket"

export function getGriidCiRole(scope: constructs.Construct): iam.IRole {
  return iam.Role.fromRoleArn(
    scope,
    "GriidCiRole",
    cdk.Arn.format(
      {
        service: "iam",
        resource: "role",
        region: "",
        // Convention from Griid.
        resourceName: "CIExternalAccessRole",
      },
      cdk.Stack.of(scope),
    ),
  )
}
