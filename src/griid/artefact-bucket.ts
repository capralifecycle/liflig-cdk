import * as s3 from "@aws-cdk/aws-s3"
import * as ssm from "@aws-cdk/aws-ssm"
import * as cdk from "@aws-cdk/core"
import { getGriidBuildKmsKey } from "./key"

/**
 * Retrieve a Bucket instance based on Griid conventions for
 * the provided build account.
 */
export function getGriidArtefactBucket(scope: cdk.Construct): s3.IBucket {
  const buildAccountId = ssm.StringParameter.valueForStringParameter(
    scope,
    // Convention from Griid.
    "/ccas/global/build",
  )

  return s3.Bucket.fromBucketAttributes(scope, "ArtefactBucket", {
    // Convention from Griid: Name of S3 bucket for build data.
    bucketName: `artefact.eu-west-1.${buildAccountId}`,
    encryptionKey: getGriidBuildKmsKey(scope),
  })
}
