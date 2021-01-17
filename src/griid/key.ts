import * as kms from "@aws-cdk/aws-kms"
import * as ssm from "@aws-cdk/aws-ssm"
import * as cdk from "@aws-cdk/core"

/**
 * Retrieve a KMS Key instance based on Griid conventions used for
 * the build account.
 */
export function getGriidBuildKmsKey(scope: cdk.Construct): kms.IKey {
  const buildAccountId = ssm.StringParameter.valueForStringParameter(
    scope,
    // Convention from Griid.
    "/ccas/global/build",
  )

  return kms.Key.fromKeyArn(
    scope,
    "ArtefactKey",
    cdk.Arn.format(
      {
        service: "kms",
        resource: "key",
        account: buildAccountId,
        resourceName: ssm.StringParameter.valueForStringParameter(
          scope,
          // Convention from Griid.
          "/ccas/global/key",
        ),
      },
      cdk.Stack.of(scope),
    ),
  )
}
