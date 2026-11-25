import * as cdk from "aws-cdk-lib"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as iam from "aws-cdk-lib/aws-iam"
import type * as constructs from "constructs"

export interface ServiceRepositoryProps {
  /**
   * The name of the GitHub repository that builds the image.
   *
   * The ECR repository is named `services/<name>`. ECR only accepts
   * lowercase letters and digits, separated by a single `.`, `_` or `-`.
   *
   * @example "my-service"
   */
  name: string
  /**
   * The owner of the GitHub repository.
   *
   * @default "capralifecycle"
   */
  owner?: string
}

const SERVICE_REPOSITORY_PREFIX = "services/"
const MAX_REPOSITORY_NAME_LENGTH = 256
const NAME_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const OWNER_PATTERN = /^[a-zA-Z0-9-]+$/

const PULL_ACTIONS = [
  "ecr:BatchCheckLayerAvailability",
  "ecr:GetDownloadUrlForLayer",
  "ecr:BatchGetImage",
]
const PUSH_ACTIONS = [
  "ecr:CompleteLayerUpload",
  "ecr:UploadLayerPart",
  "ecr:InitiateLayerUpload",
  "ecr:PutImage",
]

export const serviceRepositoryName = (name: string): string =>
  `${SERVICE_REPOSITORY_PREFIX}${name}`

/**
 * The ARN that matches every service repository in the account of `scope`.
 */
export const serviceRepositoriesArn = (scope: constructs.Construct): string =>
  cdk.Arn.format(
    {
      service: "ecr",
      resource: "repository",
      resourceName: `${SERVICE_REPOSITORY_PREFIX}*`,
    },
    cdk.Stack.of(scope),
  )

export const validateServiceRepositoryName = (name: string): string[] => [
  ...(NAME_PATTERN.test(name)
    ? []
    : [
        `Service repository name ${name} must be lowercase letters and digits, separated by a single '.', '_' or '-'`,
      ]),
  ...(serviceRepositoryName(name).length <= MAX_REPOSITORY_NAME_LENGTH
    ? []
    : [
        `Service repository name ${name} must be at most ${MAX_REPOSITORY_NAME_LENGTH - SERVICE_REPOSITORY_PREFIX.length} characters`,
      ]),
]

/**
 * Returns a list of validation error messages. An empty list means the
 * repositories are valid.
 */
export const validateServiceRepositories = (
  repositories: ServiceRepositoryProps[],
): string[] => {
  const errors = repositories.flatMap((repository) => [
    ...validateServiceRepositoryName(repository.name),
    ...(repository.owner === undefined || OWNER_PATTERN.test(repository.owner)
      ? []
      : [
          `Owner ${repository.owner} of service repository ${repository.name} contains invalid characters`,
        ]),
  ])
  const names = repositories.map((repository) => repository.name)
  const duplicates = new Set(
    names.filter((name, index) => names.indexOf(name) !== index),
  )
  for (const name of duplicates) {
    errors.push(`Service repository ${name} is listed more than once`)
  }
  return errors
}

/**
 * The lifecycle rules of every service repository.
 *
 * ECR never expires an image that a higher-priority rule selected, but a
 * count rule still counts it. The 50 tagged images therefore include the
 * `nd-` images that rule 2 keeps. Children of an image index are untagged,
 * and ECR does not expire them while the index exists.
 */
export const serviceRepositoryLifecycleRules = (): ecr.LifecycleRule[] => [
  {
    rulePriority: 1,
    description: "Expire untagged images after 10 days",
    tagStatus: ecr.TagStatus.UNTAGGED,
    maxImageAge: cdk.Duration.days(10),
  },
  {
    rulePriority: 2,
    description:
      "Keep the 10 most recent images built from a non-default branch",
    tagStatus: ecr.TagStatus.TAGGED,
    tagPrefixList: ["nd-"],
    maxImageCount: 10,
  },
  {
    rulePriority: 3,
    description: "Keep the 50 most recent tagged images",
    tagStatus: ecr.TagStatus.TAGGED,
    tagPatternList: ["*"],
    maxImageCount: 50,
  },
]

/**
 * Grants pull and push on every service repository in the account.
 *
 * The authorization token is granted explicitly, since no repository
 * grant adds it when the stack has no shared repository.
 */
export const grantServiceRepositoriesPullPush = (
  scope: constructs.Construct,
  grantee: iam.IGrantable,
): void => {
  iam.Grant.addToPrincipal({
    grantee,
    actions: [...PULL_ACTIONS, ...PUSH_ACTIONS],
    resourceArns: [serviceRepositoriesArn(scope)],
  })
  iam.Grant.addToPrincipal({
    grantee,
    actions: ["ecr:GetAuthorizationToken"],
    resourceArns: ["*"],
  })
}
