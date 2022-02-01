import * as constructs from "constructs"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as iam from "aws-cdk-lib/aws-iam"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as cdk from "aws-cdk-lib"
import { getGriidCiRole } from "../griid"

interface Props {
  /**
   * The name to use for the S3 Bucket. Should include both account and region
   * so that it will not conflict with other accounts/regions.
   *
   * @default - no bucket will be created
   */
  bucketName?: string
  /**
   * The name to use for the ECR Repository.
   */
  ecrRepositoryName: string
  /**
   * Reference to the IAM Role that will be granted permission to
   * assume the CI role. This role must have permission to assume
   * the CI role.
   *
   * @default - use Liflig Jenkins role
   */
  externalRoleArn?: string
  /**
   * The name of the role that will be created that will be assumed
   * from the CI system.
   *
   * @default - no role will be created
   */
  ciRoleName?: string
  /**
   * The AWS Accounts that will be granted permission to read from
   * the artifact repos.
   */
  targetAccountIds: string[]
  /**
   * Flag if Griid is bootstrapped and the account this construct is
   * deployed to is the build account. Will attach policies and
   * reference existing artifacts and roles.
   *
   * @default false
   */
  griid?: boolean
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
export class BuildArtifacts extends constructs.Construct {
  readonly bucketName: string | undefined
  readonly ecrRepositoryArn: string
  readonly ecrRepositoryName: string

  constructor(scope: constructs.Construct, id: string, props: Props) {
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

    const externalRoleArn =
      props.externalRoleArn ??
      "arn:aws:iam::923402097046:role/buildtools-jenkins-RoleJenkinsSlave-JQGYHR5WE6C5"

    const ecrRepositoryName = props.ecrRepositoryName

    let bucket: s3.Bucket | undefined = undefined

    if (props.bucketName) {
      bucket = new s3.Bucket(this, "S3Bucket", {
        bucketName: props.bucketName,
        encryption: s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        versioned: true,
        lifecycleRules: [
          {
            noncurrentVersionExpiration: cdk.Duration.days(10),
          },
        ],
      })
    }

    const ciRole: iam.Role | undefined = props.ciRoleName
      ? new iam.Role(this, "CiRole", {
          roleName: props.ciRoleName,
          assumedBy: new iam.ArnPrincipal(externalRoleArn),
        })
      : undefined

    const griidCiRole: iam.IRole | undefined = props.griid
      ? getGriidCiRole(this)
      : undefined

    if (bucket && ciRole) {
      bucket.grantReadWrite(ciRole)
    }

    if (bucket && griidCiRole) {
      bucket.grantReadWrite(griidCiRole)
    }

    const ecrRepo = new ecr.Repository(this, "EcrRepository", {
      repositoryName: ecrRepositoryName,
    })

    if (ciRole) {
      ecrRepo.grantPullPush(ciRole)
    }

    if (griidCiRole) {
      ecrRepo.grantPullPush(griidCiRole)
    }

    // Allow a target to read from the repos. As any specific roles need
    // to exist before we can grant access, we delegate that responsibility
    // to the target account.
    for (const targetAccountId of props.targetAccountIds) {
      if (bucket) {
        bucket.grantRead(new iam.AccountPrincipal(targetAccountId))
      }
      ecrRepo.grantPull(new iam.AccountPrincipal(targetAccountId))
    }

    // Grant permissions to write pipeline variables.
    if (ciRole || griidCiRole) {
      const account = cdk.Stack.of(this).account
      const region = cdk.Stack.of(this).region
      const statement = new iam.PolicyStatement({
        actions: ["ssm:PutParameter"],
        resources: [
          `arn:aws:ssm:${region}:${account}:parameter/liflig-cdk/*/pipeline-variables/*`,
        ],
      })

      ciRole?.grantPrincipal.addToPrincipalPolicy(statement)
      griidCiRole?.grantPrincipal.addToPrincipalPolicy(statement)
    }

    new cdk.CfnOutput(this, "EcrRepoUri", {
      value: ecrRepo.repositoryUri,
    })

    if (bucket) {
      new cdk.CfnOutput(this, "BucketName", {
        value: bucket.bucketName,
      })
    }

    if (ciRole) {
      new cdk.CfnOutput(this, "CiRoleArn", {
        value: ciRole.roleArn,
      })
    }
  }
}
