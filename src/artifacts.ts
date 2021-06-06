import * as ecr from "@aws-cdk/aws-ecr"
import * as s3 from "@aws-cdk/aws-s3"
import * as cdk from "@aws-cdk/core"

/**
 * Retrieve the ECR Repository based on arn and name, with support for
 * multiple invocations in the same scope.
 */
export function getEcrRepository(
  scope: cdk.Construct,
  arn: string,
  name: string,
): ecr.IRepository {
  const id = `ArtifactsEcrRepository${arn}`
  if (!scope.node.tryFindChild(id)) {
    ecr.Repository.fromRepositoryAttributes(scope, id, {
      repositoryArn: arn,
      repositoryName: name,
    })
  }
  return scope.node.findChild(id) as ecr.IRepository
}

/**
 * Retrieve the S3 Bucket based on name, with support for
 * multiple invocations in the same scope.
 */
export function getS3Bucket(scope: cdk.Construct, name: string): s3.IBucket {
  const id = `ArtifactsS3Bucket${name}`
  if (!scope.node.tryFindChild(id)) {
    s3.Bucket.fromBucketName(scope, id, name)
  }
  return scope.node.findChild(id) as s3.IBucket
}
