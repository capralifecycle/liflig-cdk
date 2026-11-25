import * as cdk from "aws-cdk-lib"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as iam from "aws-cdk-lib/aws-iam"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as constructs from "constructs"
import {
  GithubActionsRole,
  type Props as GithubActionsRoleProps,
} from "./github-actions-role"
import {
  grantServiceRepositoriesPullPush,
  type ServiceRepositoryProps,
  serviceRepositoryLifecycleRules,
  serviceRepositoryName,
  validateServiceRepositories,
  validateServiceRepositoryName,
} from "./service-repositories"

interface Props {
  /**
   * The name to use for the S3 Bucket.
   *
   * NOTE: Should include both account and region so that it will
   * not conflict with other accounts/regions.
   */
  bucketName: string
  /**
   * The name of a shared ECR repository for all services.
   *
   * Legacy, to be removed in the next major version. Use
   * {@link serviceRepositories} instead. Removing this deletes the shared
   * repository from the stack, while AWS keeps the repository itself.
   *
   * @default - no shared repository is created
   */
  ecrRepositoryName?: string
  /**
   * Create a role that can be assumed by Liflig Jenkins.
   *
   * @deprecated
   * @default - no role will be created
   */
  ciRoleName?: string
  /**
   * The lifecycle rules to apply to images stored in the shared ECR repository.
   *
   * Legacy, to be removed in the next major version. Service repositories
   * have fixed lifecycle rules.
   *
   * @default - Expire untagged images after 10 days and any image older than 180 days
   */
  ecrRepositoryLifecycleRules?: ecr.LifecycleRule[]
  /**
   * One ECR repository per service, named `services/<name>`.
   *
   * Each repository has immutable tags and is kept by AWS when it is
   * removed from this list or the stack is deleted. Adding it back
   * afterwards fails until the existing repository is imported or deleted.
   *
   * Lifecycle rules, in priority order:
   * - Untagged images expire after 10 days.
   * - The 10 most recent images with a tag starting with `nd-` are kept.
   * - The 50 most recent tagged images are kept, `nd-` images included.
   *
   * The CI roles may push to and pull from every service repository, and
   * {@link targetAccountIds} may pull from them.
   * Use {@link BuildArtifacts.importServiceRepository} to reference one
   * from another stack.
   *
   * @default - no service repositories are created
   */
  serviceRepositories?: ServiceRepositoryProps[]
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
 *
 * Returns a list of validation error messages. An empty list means the props are valid.
 */
export const validateProps = (props: Props): string[] => {
  const errors: string[] = validateServiceRepositories(
    props.serviceRepositories ?? [],
  )
  if (
    props.githubActions?.defaultBranch &&
    !props.githubActions.defaultBranch.match(/^[a-zA-Z0-9-]+$/)
  ) {
    errors.push(
      `Default branch ${props.githubActions.defaultBranch} contains invalid characters`,
    )
  }
  return errors
}

/**
 * Create various artifacts used as part of Continuous Integration (CI).
 *
 * This includes an S3 bucket, ECR repositories, and IAM role(s) that
 * grant the CI server write access to them.
 *
 * Noncurrent S3 object versions expire after 10 days. ECR images expire
 * through the lifecycle rules of each repository.
 *
 * @experimental
 */
export class BuildArtifacts extends constructs.Construct {
  public readonly bucketName: string | undefined
  private readonly sharedEcrRepositoryName?: string
  public readonly role?: iam.Role
  public readonly limitedRole?: iam.Role

  /**
   * The name of the shared ECR repository.
   *
   * Legacy, to be removed in the next major version.
   *
   * @throws if {@link Props.ecrRepositoryName} is not set
   */
  public get ecrRepositoryName(): string {
    if (this.sharedEcrRepositoryName === undefined) {
      throw new Error(
        "BuildArtifacts has no shared ECR repository, since ecrRepositoryName is not set",
      )
    }
    return this.sharedEcrRepositoryName
  }

  /**
   * The ARN of the shared ECR repository.
   *
   * Legacy, to be removed in the next major version.
   *
   * @throws if {@link Props.ecrRepositoryName} is not set
   */
  public get ecrRepositoryArn(): string {
    return cdk.Arn.format(
      {
        service: "ecr",
        resource: "repository",
        resourceName: this.ecrRepositoryName,
      },
      cdk.Stack.of(this),
    )
  }

  /**
   * Reference a repository created through {@link Props.serviceRepositories}
   * from a stack in any account, such as the one that runs the service.
   *
   * `ecr.Repository.fromRepositoryName` cannot be used for this, as it
   * resolves the repository to the account of the importing stack.
   */
  public static importServiceRepository(
    scope: constructs.Construct,
    id: string,
    props: {
      /**
       * The ID of the account that holds the build artifacts.
       */
      account: string
      /**
       * The name of the service repository, without the `services/` prefix.
       */
      name: string
      /**
       * @default - the region of the stack that `scope` belongs to
       */
      region?: string
    },
  ): ecr.IRepository {
    const errors = validateServiceRepositoryName(props.name)
    if (errors.length > 0) {
      throw new Error(`Invalid props were supplied: ${errors.join("; ")}`)
    }
    const repositoryName = serviceRepositoryName(props.name)
    return ecr.Repository.fromRepositoryAttributes(scope, id, {
      repositoryName,
      repositoryArn: cdk.Arn.format(
        {
          service: "ecr",
          resource: "repository",
          resourceName: repositoryName,
          account: props.account,
          region: props.region,
        },
        cdk.Stack.of(scope),
      ),
    })
  }

  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)

    const errors = validateProps(props)
    if (errors.length > 0) {
      throw new Error(`Invalid props were supplied: ${errors.join("; ")}`)
    }

    this.bucketName = props.bucketName
    this.sharedEcrRepositoryName = props.ecrRepositoryName
    const serviceRepositories = props.serviceRepositories ?? []

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

    const ecrRepo =
      props.ecrRepositoryName === undefined
        ? undefined
        : new ecr.Repository(this, "EcrRepository", {
            repositoryName: props.ecrRepositoryName,
            lifecycleRules: props.ecrRepositoryLifecycleRules || [
              {
                maxImageAge: cdk.Duration.days(10),
                tagStatus: ecr.TagStatus.UNTAGGED,
              },
              {
                maxImageAge: cdk.Duration.days(180),
                tagStatus: ecr.TagStatus.ANY,
              },
            ],
          })

    const serviceRepositoriesScope = new constructs.Construct(
      this,
      "ServiceRepositories",
    )
    // Construct IDs come from the name, so reordering the list never
    // replaces a repository.
    const serviceEcrRepos = serviceRepositories.map(
      (service) =>
        new ecr.Repository(serviceRepositoriesScope, service.name, {
          repositoryName: serviceRepositoryName(service.name),
          imageTagMutability: ecr.TagMutability.IMMUTABLE,
          removalPolicy: cdk.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
          lifecycleRules: serviceRepositoryLifecycleRules(),
        }),
    )

    // Allow a target to read from the repos. As any specific roles need
    // to exist before we can grant access, we delegate that responsibility
    // to the target account.
    for (const targetAccountId of props.targetAccountIds || []) {
      bucket.grantRead(new iam.AccountPrincipal(targetAccountId))
      ecrRepo?.grantPull(new iam.AccountPrincipal(targetAccountId))
      for (const serviceEcrRepo of serviceEcrRepos) {
        serviceEcrRepo.grantPull(new iam.AccountPrincipal(targetAccountId))
      }
    }
    const grantCiEcrAccess = (role: iam.IRole) => {
      ecrRepo?.grantPullPush(role)
      if (serviceEcrRepos.length > 0) {
        grantServiceRepositoriesPullPush(this, role)
      }
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
          ? (props.githubActions.defaultBranch ?? "master")
          : // NOTE: If the limited role is disabled, only one role will be created
            // and that role then needs to be assumable from all branches.
            "*",
        repositories: props.githubActions.repositories,
      })
      this.role = role.role
      this.role.addToPolicy(policyStatements.allowPipelineVariables(this))
      bucket.grantPut(this.role)
      grantCiEcrAccess(this.role)
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
        grantCiEcrAccess(this.limitedRole)
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
      grantCiEcrAccess(legacyRoleForJenkins)
    }

    if (ecrRepo) {
      new cdk.CfnOutput(this, "EcrRepoUri", {
        value: ecrRepo.repositoryUri,
      })
    }

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
