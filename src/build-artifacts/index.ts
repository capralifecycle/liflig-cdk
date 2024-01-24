import * as constructs from "constructs"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as iam from "aws-cdk-lib/aws-iam"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as cdk from "aws-cdk-lib"
import {
  GithubActionsRole,
  Props as GithubActionsRoleProps,
} from "./github-actions-role"

interface Props {
  /**
   * The name to use for the S3 Bucket.
   *
   * NOTE: Should include both account and region so that it will
   * not conflict with other accounts/regions.
   */
  bucketName: string
  /**
   * The name to use for the ECR Repository.
   */
  ecrRepositoryName: string
  /**
   * Create a role that can be assumed by Liflig Jenkins.
   *
   * @deprecated
   * @default - no role will be created
   */
  ciRoleName?: string
  /**
   * The lifecycle rules to apply to images stored in the ECR repository.
   *
   * @default - Expire images after 180 days
   */
  ecrRepositoryLifecycleRules?: ecr.LifecycleRule[]
  /**
   * ID of AWS accounts that will be granted permission to read from
   * the artifact repos.
   */
  targetAccountIds?: string[]
  /**
   * Configuration for creating IAM roles that can be assumed
   * by GitHub Actions in specific GitHub repositories.
   *
   * @default - no roles are created.
   */
  githubActions?: Omit<
    GithubActionsRoleProps,
    "trustedOwners" | "trustedBranch" | "oidcProvider" | "roleName"
  > & {
    /**
     * A list of trusted GitHub repository owners.
     *
     * @default ["capralifecycle"]
     */
    trustedOwners?: string[]
    /**
     * The name of the role to create.
     *
     * @default "github-actions-role"
     */
    roleName?: string
    /**
     * The name of the default branch in all repositories.
     *
     * @default "master"
     */
    defaultBranch?: string
    /**
     * Configuration for a limited role that can be used on non-default
     * branches with less IAM permissions than the main role.
     *
     * @default - a limited role is created.
     */
    limitedRoleConfiguration?: {
      /**
       * Whether to create the role or not.
       *
       * @default true
       */
      enabled?: boolean
      /**
       * The name of the role to create.
       *
       * @default "github-actions-limited-role"
       */
      roleName?: string
    }
  }
}

/**
 * Utility functions for generating IAM statements.
 */
const policyStatements = {
  allowPipelineVariables: (scope: constructs.Construct, prefix?: string) =>
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["ssm:PutParameter"],
      resources: [
        `arn:aws:ssm:${cdk.Stack.of(scope).region}:${cdk.Stack.of(scope).account}:parameter/liflig-cdk/*/pipeline-variables/${prefix ?? "*"}`,
      ],
    }),
  denyProdPipelines: (scope: constructs.Construct, bucket: s3.IBucket) =>
    new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      actions: ["s3:*"],
      resources: [
        bucket.arnForObjects("pipelines/*-prod/*"),
        bucket.arnForObjects("pipelines/*-prod-*/*"),
      ],
    }),
  denyProdPipelineVariables: (scope: constructs.Construct) =>
    new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      actions: ["ssm:PutParameter"],
      resources: [
        `arn:aws:ssm:${cdk.Stack.of(scope).region}:${
          cdk.Stack.of(scope).account
        }:parameter/liflig-cdk/*/pipeline-variables/prod*`,
      ],
    }),
}

/**
 * Utility function for validating the construct properties.
 */
export const validateProps = (props: Props) => {
  let valid = true
  if (
    props.githubActions?.defaultBranch &&
    !props.githubActions.defaultBranch.match(/^[a-zA-Z0-9-]+$/)
  ) {
    console.error(
      `Default branch ${props.githubActions.defaultBranch} contains invalid characters`,
    )
    valid = false
  }
  return valid
}

/**
 * Create various artifacts used as part of Continuous Integration (CI).
 *
 * This includes artifact repositories such as S3 bucket and ECR
 * repository, as well as IAM role(s) that grant the CI server write
 * access to these repositories.
 *
 * TODO: How can we cleanup stuff that goes into this S3 Bucket and
 *  ECR Repository? Can we ever reliably cleanup? We probably need
 *  some strategy for how we put stuff here to be able to do it.
 *
 * @experimental
 */
export class BuildArtifacts extends constructs.Construct {
  public readonly bucketName: string | undefined
  public readonly ecrRepositoryArn: string
  public readonly ecrRepositoryName: string
  public readonly role?: iam.Role
  public readonly limitedRole?: iam.Role

  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)

    if (!validateProps(props)) {
      throw new Error("Invalid props were supplied")
    }

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

    const ecrRepositoryName = props.ecrRepositoryName

    const bucket = new s3.Bucket(this, "S3Bucket", {
      bucketName: props.bucketName,
      encryption: s3.BucketEncryption.S3_MANAGED,
      eventBridgeEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: cdk.Duration.days(10),
        },
      ],
    })

    const ecrRepo = new ecr.Repository(this, "EcrRepository", {
      repositoryName: ecrRepositoryName,
      lifecycleRules: props.ecrRepositoryLifecycleRules || [
        {
          maxImageAge: cdk.Duration.days(180),
          tagStatus: ecr.TagStatus.ANY,
        },
      ],
    })

    // Allow a target to read from the repos. As any specific roles need
    // to exist before we can grant access, we delegate that responsibility
    // to the target account.
    for (const targetAccountId of props.targetAccountIds || []) {
      bucket.grantRead(new iam.AccountPrincipal(targetAccountId))
      ecrRepo.grantPull(new iam.AccountPrincipal(targetAccountId))
    }

    if (props.githubActions) {
      const trustedOwners = props.githubActions.trustedOwners ?? [
        "capralifecycle",
      ]
      // NOTE: There's an L2 construct that predates the official CloudFormation resource,
      // and it is therefore implemented as a custom resource.
      // We use the L1 CloudFormation resource instead because:
      // 1) it's simpler
      // 2) there's a chance the L2 construct will be deprecated in the future in favor
      // of the official CloudFormation resource.
      const cfnOidcProvider = new iam.CfnOIDCProvider(
        this,
        "OpenIdConnectProvider",
        {
          url: "https://token.actions.githubusercontent.com",
          clientIdList: ["sts.amazonaws.com"],
          // NOTE: The thumbprint isn't actually used, but the AWS API still requires us to supply it.
          // More details here: https://web.archive.org/web/20240122155758/https://github.com/aws-actions/configure-aws-credentials/issues/357#issuecomment-1626357333
          thumbprintList: ["1c58a3a8518e8759bf075b76b750d4f2df264fcd"],
        },
      )
      const oidcProvider =
        iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          "Provider",
          cfnOidcProvider.ref,
        )
      const createLimitedRole =
        props.githubActions.limitedRoleConfiguration?.enabled ?? true
      const role = new GithubActionsRole(this, "GithubActionsRole", {
        oidcProvider,
        trustedOwners,
        roleName: props.githubActions.roleName ?? "github-actions-role",
        trustedBranch: createLimitedRole
          ? props.githubActions.defaultBranch ?? "master"
          : // NOTE: If the limited role is disabled, only one role will be created
            // and that role then needs to be assumable from all branches.
            "*",
        repositories: props.githubActions.repositories,
      })
      this.role = role.role
      this.role.addToPolicy(policyStatements.allowPipelineVariables(this))
      bucket.grantPut(this.role)
      ecrRepo.grantPullPush(this.role)
      if (createLimitedRole) {
        const limitedRole = new GithubActionsRole(
          this,
          "GithubActionsLimitedRole",
          {
            oidcProvider,
            trustedOwners,
            roleName:
              props.githubActions.limitedRoleConfiguration?.roleName ??
              "github-actions-limited-role",
            // NOTE: The limited role can be assumed from all branches.
            trustedBranch: "*",
            repositories: props.githubActions.repositories,
          },
        )
        this.limitedRole = limitedRole.role
        this.limitedRole.addToPolicy(
          policyStatements.allowPipelineVariables(this, "dev*"),
        )
        this.limitedRole.addToPolicy(
          policyStatements.denyProdPipelines(scope, bucket),
        )
        bucket.grantPut(this.limitedRole)
        ecrRepo.grantPullPush(this.limitedRole)
      }
    }
    if (props.ciRoleName) {
      const legacyRoleForJenkins = new iam.Role(this, "CiRole", {
        roleName: props.ciRoleName,
        assumedBy: new iam.ArnPrincipal(
          "arn:aws:iam::923402097046:role/buildtools-jenkins-RoleJenkinsSlave-JQGYHR5WE6C5",
        ),
      })
      legacyRoleForJenkins.addToPolicy(
        policyStatements.allowPipelineVariables(this),
      )
      bucket.grantPut(legacyRoleForJenkins)
      ecrRepo.grantPullPush(legacyRoleForJenkins)
    }

    new cdk.CfnOutput(this, "EcrRepoUri", {
      value: ecrRepo.repositoryUri,
    })

    new cdk.CfnOutput(this, "BucketName", {
      value: bucket.bucketName,
    })

    if (this.role) {
      new cdk.CfnOutput(this, "RoleArn", {
        value: this.role.roleArn,
      })
    }
    if (this.limitedRole) {
      new cdk.CfnOutput(this, "LimitedRoleArn", {
        value: this.limitedRole.roleArn,
      })
    }
  }
}
