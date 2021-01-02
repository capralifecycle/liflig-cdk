import * as iam from "@aws-cdk/aws-iam"
import * as cdk from "@aws-cdk/core"

export { getGriidArtefactBucket } from "./artefact-bucket"

export function getGriidCiRole(scope: cdk.Construct): iam.IRole {
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
