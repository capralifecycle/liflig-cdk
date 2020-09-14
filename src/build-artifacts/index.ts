import * as ecr from "@aws-cdk/aws-ecr"
import * as iam from "@aws-cdk/aws-iam"
import * as s3 from "@aws-cdk/aws-s3"
import * as cdk from "@aws-cdk/core"

interface Props {
  /**
   * The name to use for the S3 Bucket. Should include both account and region
   * so that it will not conflict with other accounts/regions.
   */
  bucketName: string
  /**
   * The name to use for the ECR Repository.
   */
  ecrRepositoryName: string
  /**
   * Reference to the IAM Role that will be granted permission to
   * assume the CI role. This role must have permission to assume
   * the CI role.
   */
  externalRoleArn: string
  /**
   * The name of the role that will be created that will be assumed
   * from the CI system.
   */
  ciRoleName: string
  /**
   * The AWS Accounts that will be granted permission to read from
   * the artifact repos.
   */
  targetAccountIds: string[]
}

/**
 * Build artifacts.
 *
 * This holds a S3 Bucket, a ECR Repository and roles to be used
 * from CI system for uploading.
 *
 * TODO: How can we cleanup stuff that goes into this S3 Bucket and
 *  ECR Repository? Can we ever reliably cleanup? We probably need
 *  some strategy for how we put stuff here to be able to do it.
 *
 * @experimental
 */
export class BuildArtifacts extends cdk.Construct {
  readonly bucketName: string
  readonly ecrRepositoryArn: string
  readonly ecrRepositoryName: string

  constructor(scope: cdk.Construct, id: string, props: Props) {
    super(scope, id)

    this.bucketName = props.bucketName
    this.ecrRepositoryName = props.ecrRepositoryName
    this.ecrRepositoryArn = cdk.Arn.format(
      {
        service: "ecr",
        resource: "repository",
        resourceName: this.ecrRepositoryName,
      },
      cdk.Stack.of(this),
    )

    const bucket = new s3.Bucket(this, "S3Bucket", {
      bucketName: this.bucketName,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    })

    const ciRole = new iam.Role(this, "CiRole", {
      roleName: props.ciRoleName,
      assumedBy: new iam.ArnPrincipal(props.externalRoleArn),
    })

    bucket.grantReadWrite(ciRole)

    const ecrRepo = new ecr.Repository(this, "EcrRepository", {
      repositoryName: this.ecrRepositoryName,
    })
    ecrRepo.grantPullPush(ciRole)

    // Allow a target to read from the repos. As any specific roles need
    // to exist before we can grant access, we delegate that responsibility
    // to the target account.
    for (const targetAccountId of props.targetAccountIds) {
      bucket.grantRead(new iam.AccountPrincipal(targetAccountId))
      ecrRepo.grantPull(new iam.AccountPrincipal(targetAccountId))
    }

    new cdk.CfnOutput(this, "EcrRepoUri", {
      value: ecrRepo.repositoryUri,
    })
    new cdk.CfnOutput(this, "BucketName", {
      value: this.bucketName,
    })
    new cdk.CfnOutput(this, "CiRoleArn", {
      value: ciRole.roleArn,
    })
  }
}
