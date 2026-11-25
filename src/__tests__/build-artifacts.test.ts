import assert from "node:assert/strict"
import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, CfnParameter, Stack } from "aws-cdk-lib"
import { Match, Template } from "aws-cdk-lib/assertions"
import * as iam from "aws-cdk-lib/aws-iam"
import {
  BuildArtifacts,
  validateProps as validateBuildArtifactsProps,
} from "../build-artifacts"
import { validateProps as validateGithubActionsRoleProps } from "../build-artifacts/github-actions-role"

configureCdkSnapshots()

test("build-artifacts with a shared repository", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack", {
    env: { account: "111111111111", region: "eu-west-1" },
  })
  new BuildArtifacts(stack, "BuildArtifacts", {
    bucketName: "my-bucket",
    ecrRepositoryName: "my-ecr-repo",
    targetAccountIds: ["222222222222", "333333333333"],
    ciRoleName: "my-ci-role",
    githubActions: {
      repositories: [{ name: "my-repository", owner: "capralifecycle" }],
    },
  })
  t.assert.snapshot(cdkTemplate(stack))
})

test("should fail validation on invalid default branch", () => {
  const errors = validateBuildArtifactsProps({
    bucketName: "my-bucket",
    ecrRepositoryName: "my-ecr-repo",
    githubActions: {
      defaultBranch: "*",
      repositories: [
        {
          name: "my-repository",
          owner: "capralifecycle",
        },
      ],
    },
  })
  assert.deepStrictEqual(errors, [
    "Default branch * contains invalid characters",
  ])
})

test("should fail validation on invalid trusted owner", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  const errors = validateGithubActionsRoleProps({
    oidcProvider: iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      stack,
      "Provider",
      "arn:aws:iam::12345789012:oidc-provider/token.actions.githubusercontent.com",
    ),
    trustedOwners: ["*"],
    repositories: [
      {
        owner: "*",
        name: "my-repository",
      },
    ],
  })
  assert.ok(errors.includes("Trusted owner * contains invalid characters"))
})

test("should fail validation on missing trusted owner", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  const errors = validateGithubActionsRoleProps({
    oidcProvider: iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      stack,
      "Provider",
      "arn:aws:iam::12345789012:oidc-provider/token.actions.githubusercontent.com",
    ),
    trustedOwners: ["capralifecycle"],
    repositories: [
      {
        owner: "capralifecycel",
        name: "my-repository",
      },
    ],
  })
  assert.ok(
    errors.includes(
      "Owner capralifecycel of repository my-repository not configured as a trusted owner",
    ),
  )
})

test("should fail validation on empty list of repositories", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  const errors = validateGithubActionsRoleProps({
    repositories: [],
    oidcProvider: iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      stack,
      "Provider",
      "arn:aws:iam::12345789012:oidc-provider/token.actions.githubusercontent.com",
    ),
    trustedOwners: ["capralifecycle"],
  })
  assert.ok(
    errors.includes("At least 1 repository must be supplied, but 0 were given"),
  )
})

test("should fail validation on empty list of trusted owners", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  const errors = validateGithubActionsRoleProps({
    repositories: [
      {
        name: "my-repository",
        owner: "capralifecycle",
      },
    ],
    oidcProvider: iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      stack,
      "Provider",
      "arn:aws:iam::12345789012:oidc-provider/token.actions.githubusercontent.com",
    ),
    trustedOwners: [],
  })
  assert.ok(
    errors.includes(
      "At least 1 trusted owner must be supplied, but 0 were given",
    ),
  )
})

test("should support creation of only 1 role", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  new BuildArtifacts(stack, "BuildArtifacts", {
    ecrRepositoryName: "some-ecr-repo-name",
    bucketName: "bucket-name",
    githubActions: {
      limitedRoleConfiguration: {
        enabled: false,
      },
      repositories: [
        {
          name: "my-repository",
          owner: "capralifecycle",
        },
      ],
    },
  })
  const template = Template.fromStack(stack)
  template.resourcePropertiesCountIs(
    "AWS::IAM::Role",
    {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: "sts:AssumeRoleWithWebIdentity",
          },
        ],
      },
    },
    1,
  )
  template.hasResourceProperties("AWS::IAM::Role", {
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: {
            StringLike: {
              "token.actions.githubusercontent.com:sub": [
                "repo:capralifecycle@*/my-repository@*:ref:refs/heads/*",
              ],
            },
          },
        },
      ],
    },
  })
})

test("should trust the immutable subject claim format", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  new BuildArtifacts(stack, "BuildArtifacts", {
    ecrRepositoryName: "some-ecr-repo-name",
    bucketName: "bucket-name",
    githubActions: {
      defaultBranch: "master",
      repositories: [{ name: "my-repository", owner: "capralifecycle" }],
    },
  })
  const template = Template.fromStack(stack)
  template.hasResourceProperties("AWS::IAM::Role", {
    RoleName: "github-actions-role",
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: {
            StringLike: {
              "token.actions.githubusercontent.com:sub": [
                "repo:capralifecycle@*/my-repository@*:ref:refs/heads/master",
              ],
            },
          },
        },
      ],
    },
  })
  template.hasResourceProperties("AWS::IAM::Role", {
    RoleName: "github-actions-limited-role",
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: {
            StringLike: {
              "token.actions.githubusercontent.com:sub": [
                "repo:capralifecycle@*/my-repository@*:ref:refs/heads/*",
              ],
            },
          },
        },
      ],
    },
  })
})

test("should fail validation on a malformed repository ID", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  const errors = validateGithubActionsRoleProps({
    oidcProvider: iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      stack,
      "Provider",
      "arn:aws:iam::12345789012:oidc-provider/token.actions.githubusercontent.com",
    ),
    trustedOwners: ["capralifecycle"],
    repositories: [
      {
        owner: "capralifecycle",
        name: "my-repository",
        repositoryId: -1,
      },
    ],
  })
  assert.deepStrictEqual(errors, [
    "repositoryId -1 of repository my-repository must be a positive integer",
  ])
})

test("should match the immutable subject claim exactly when the IDs are pinned", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  new BuildArtifacts(stack, "BuildArtifacts", {
    ecrRepositoryName: "some-ecr-repo-name",
    bucketName: "bucket-name",
    githubActions: {
      defaultBranch: "master",
      repositories: [
        {
          name: "my-repository",
          owner: "capralifecycle",
          ownerId: 13219542,
          repositoryId: 845069697,
        },
      ],
    },
  })
  const template = Template.fromStack(stack)
  template.hasResourceProperties("AWS::IAM::Role", {
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: {
            StringEquals: {
              "token.actions.githubusercontent.com:sub": [
                "repo:capralifecycle@13219542/my-repository@845069697:ref:refs/heads/master",
              ],
            },
          },
        },
      ],
    },
  })
})

test("should support creation of role for Liflig Jenkins", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  new BuildArtifacts(stack, "BuildArtifacts", {
    ecrRepositoryName: "some-ecr-repo-name",
    bucketName: "bucket-name",
    ciRoleName: "my-role",
  })
  const template = Template.fromStack(stack)
  template.hasResourceProperties("AWS::IAM::Role", {
    RoleName: "my-role",
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Principal: {
            AWS: Match.stringLikeRegexp("arn:aws:iam::923402097046:.*"),
          },
          Action: "sts:AssumeRole",
        },
      ],
    },
  })
})

test("should throw on empty list of repositories", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  assert.throws(() => {
    new BuildArtifacts(stack, "BuildArtifacts", {
      ecrRepositoryName: "some-ecr-repo-name",
      bucketName: "bucket-name",
      githubActions: {
        repositories: [],
      },
    })
  })
})

test("should trust only the immutable subject claim format by default", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  new BuildArtifacts(stack, "BuildArtifacts", {
    ecrRepositoryName: "some-ecr-repo-name",
    bucketName: "bucket-name",
    githubActions: {
      defaultBranch: "master",
      repositories: [{ name: "my-repository", owner: "capralifecycle" }],
    },
  })
  const template = Template.fromStack(stack)
  template.hasResourceProperties("AWS::IAM::Role", {
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: {
            StringLike: {
              "token.actions.githubusercontent.com:sub": [
                "repo:capralifecycle@*/my-repository@*:ref:refs/heads/master",
              ],
            },
          },
        },
      ],
    },
  })
})

test("should never split subjects across two condition operators", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  new BuildArtifacts(stack, "BuildArtifacts", {
    ecrRepositoryName: "some-ecr-repo-name",
    bucketName: "bucket-name",
    githubActions: {
      defaultBranch: "master",
      repositories: [{ name: "my-repository", owner: "capralifecycle" }],
    },
  })
  const roles = Template.fromStack(stack).findResources("AWS::IAM::Role")
  const trustConditions = Object.values(roles)
    .map(
      (role) => role.Properties.AssumeRolePolicyDocument.Statement[0].Condition,
    )
    .filter((condition) => condition !== undefined)

  assert.notStrictEqual(trustConditions.length, 0)
  for (const condition of trustConditions) {
    assert.strictEqual(Object.keys(condition).length, 1)
  }
})

const serviceRepositoriesStack = (
  props: Partial<ConstructorParameters<typeof BuildArtifacts>[2]> = {},
) => {
  const app = new App()
  const stack = new Stack(app, "Stack", {
    env: { account: "111111111111", region: "eu-west-1" },
  })
  new BuildArtifacts(stack, "BuildArtifacts", {
    bucketName: "my-bucket",
    targetAccountIds: ["222222222222"],
    githubActions: {
      repositories: [{ name: "*", owner: "capralifecycle" }],
    },
    serviceRepositories: [{ name: "my-service" }, { name: "other-service" }],
    ...props,
  })
  return stack
}

const repositoryLogicalIds = (stack: Stack) =>
  Object.fromEntries(
    Object.entries(
      Template.fromStack(stack).findResources("AWS::ECR::Repository"),
    ).map(([logicalId, resource]) => [
      resource.Properties.RepositoryName,
      logicalId,
    ]),
  )

test("build-artifacts with service repositories", (t) => {
  t.assert.snapshot(cdkTemplate(serviceRepositoriesStack()))
})

test("should create only service repositories when no shared repository is named", () => {
  assert.deepStrictEqual(
    Object.keys(repositoryLogicalIds(serviceRepositoriesStack())).sort(),
    ["services/my-service", "services/other-service"],
  )
})

test("should create service repositories with immutable tags that are retained on removal", () => {
  const template = Template.fromStack(serviceRepositoriesStack())
  template.hasResource("AWS::ECR::Repository", {
    Properties: {
      RepositoryName: "services/my-service",
      ImageTagMutability: "IMMUTABLE",
    },
    DeletionPolicy: "RetainExceptOnCreate",
    UpdateReplacePolicy: "Retain",
  })
})

test("should expire untagged images and keep the most recent nd- and tagged images", () => {
  const repositories = Template.fromStack(
    serviceRepositoriesStack(),
  ).findResources("AWS::ECR::Repository")
  const repository = Object.values(repositories).find(
    (r) => r.Properties.RepositoryName === "services/my-service",
  )
  const policy = JSON.parse(
    repository?.Properties.LifecyclePolicy.LifecyclePolicyText,
  )
  assert.deepStrictEqual(
    policy.rules.map(
      (rule: { rulePriority: number; selection: Record<string, unknown> }) => ({
        priority: rule.rulePriority,
        ...rule.selection,
      }),
    ),
    [
      {
        priority: 1,
        tagStatus: "untagged",
        countType: "sinceImagePushed",
        countNumber: 10,
        countUnit: "days",
      },
      {
        priority: 2,
        tagStatus: "tagged",
        tagPrefixList: ["nd-"],
        countType: "imageCountMoreThan",
        countNumber: 10,
      },
      {
        priority: 3,
        tagStatus: "tagged",
        tagPatternList: ["*"],
        countType: "imageCountMoreThan",
        countNumber: 50,
      },
    ],
  )
})

test("should keep logical IDs when service repositories are reordered", () => {
  const before = repositoryLogicalIds(
    serviceRepositoriesStack({
      serviceRepositories: [{ name: "my-service" }, { name: "other-service" }],
    }),
  )
  const after = repositoryLogicalIds(
    serviceRepositoriesStack({
      serviceRepositories: [
        { name: "new-service" },
        { name: "other-service" },
        { name: "my-service" },
      ],
    }),
  )
  assert.strictEqual(
    after["services/my-service"],
    before["services/my-service"],
  )
  assert.strictEqual(
    after["services/other-service"],
    before["services/other-service"],
  )
})

test("should let both GitHub Actions roles pull, push and log in without a shared repository", () => {
  const template = Template.fromStack(serviceRepositoriesStack())
  for (const roleName of [
    "github-actions-role",
    "github-actions-limited-role",
  ]) {
    const [roleLogicalId] = Object.keys(
      template.findResources("AWS::IAM::Role", {
        Properties: { RoleName: roleName },
      }),
    )
    template.hasResourceProperties("AWS::IAM::Policy", {
      Roles: [{ Ref: roleLogicalId }],
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["ecr:BatchGetImage", "ecr:PutImage"]),
            Resource: Match.objectLike({
              "Fn::Join": [
                "",
                Match.arrayWith([
                  ":ecr:eu-west-1:111111111111:repository/services/*",
                ]),
              ],
            }),
          }),
          Match.objectLike({
            Action: "ecr:GetAuthorizationToken",
            Resource: "*",
          }),
        ]),
      },
    })
  }
})

test("should let each target account pull from each service repository", () => {
  const template = Template.fromStack(serviceRepositoriesStack())
  for (const repositoryName of [
    "services/my-service",
    "services/other-service",
  ]) {
    template.hasResourceProperties("AWS::ECR::Repository", {
      RepositoryName: repositoryName,
      RepositoryPolicyText: {
        Statement: [
          Match.objectLike({
            Action: [
              "ecr:BatchCheckLayerAvailability",
              "ecr:GetDownloadUrlForLayer",
              "ecr:BatchGetImage",
            ],
            Principal: {
              AWS: {
                "Fn::Join": ["", Match.arrayWith([":iam::222222222222:root"])],
              },
            },
          }),
        ],
      },
    })
  }
})

test("should fail validation on service repository names that ECR rejects", () => {
  const errors = validateBuildArtifactsProps({
    bucketName: "my-bucket",
    serviceRepositories: [
      { name: "My-Service" },
      { name: "my--service" },
      { name: "my-service" },
    ],
  })
  assert.deepStrictEqual(errors, [
    "Service repository name My-Service must be lowercase letters and digits, separated by a single '.', '_' or '-'",
    "Service repository name my--service must be lowercase letters and digits, separated by a single '.', '_' or '-'",
  ])
})

test("should fail validation on a service repository owner with invalid characters", () => {
  const errors = validateBuildArtifactsProps({
    bucketName: "my-bucket",
    serviceRepositories: [{ name: "my-service", owner: "*" }],
  })
  assert.deepStrictEqual(errors, [
    "Owner * of service repository my-service contains invalid characters",
  ])
})

test("should fail validation on a service repository listed twice", () => {
  const errors = validateBuildArtifactsProps({
    bucketName: "my-bucket",
    serviceRepositories: [
      { name: "my-service" },
      { name: "my-service" },
      { name: "my-service" },
    ],
  })
  assert.deepStrictEqual(errors, [
    "Service repository my-service is listed more than once",
  ])
})

test("should import a service repository from the build account", () => {
  const app = new App()
  const stack = new Stack(app, "Stack", {
    env: { account: "222222222222", region: "eu-west-1" },
  })
  const repository = BuildArtifacts.importServiceRepository(stack, "Repo", {
    account: "111111111111",
    name: "my-service",
  })
  assert.deepStrictEqual(stack.resolve(repository.repositoryArn), {
    "Fn::Join": [
      "",
      [
        "arn:",
        { Ref: "AWS::Partition" },
        ":ecr:eu-west-1:111111111111:repository/services/my-service",
      ],
    ],
  })
  assert.strictEqual(repository.repositoryName, "services/my-service")
  assert.match(
    stack.resolve(repository.repositoryUri)["Fn::Join"][1].join(""),
    /^111111111111\.dkr\.ecr\.eu-west-1\..*\/services\/my-service$/,
  )
})

test("should throw when importing a service repository with an invalid name", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  assert.throws(
    () =>
      BuildArtifacts.importServiceRepository(stack, "Repo", {
        account: "111111111111",
        name: "services/my-service",
      }),
    /Service repository name services\/my-service must be lowercase/,
  )
})

test("should expose the shared repository name and ARN as strings when a shared repository is named", () => {
  const app = new App()
  const stack = new Stack(app, "Stack", {
    env: { account: "111111111111", region: "eu-west-1" },
  })
  const buildArtifacts = new BuildArtifacts(stack, "BuildArtifacts", {
    bucketName: "my-bucket",
    ecrRepositoryName: "my-ecr-repo",
  })
  const name: string = buildArtifacts.ecrRepositoryName
  const arn: string = buildArtifacts.ecrRepositoryArn
  assert.strictEqual(name, "my-ecr-repo")
  assert.match(
    JSON.stringify(stack.resolve(arn)),
    /:ecr:eu-west-1:111111111111:repository\/my-ecr-repo/,
  )
})

test("should throw when reading the shared repository of build artifacts without one", () => {
  const buildArtifacts = new BuildArtifacts(
    serviceRepositoriesStack(),
    "Other",
    { bucketName: "other-bucket" },
  )
  assert.throws(
    () => buildArtifacts.ecrRepositoryArn,
    /no shared ECR repository/,
  )
  assert.throws(
    () => buildArtifacts.ecrRepositoryName,
    /no shared ECR repository/,
  )
})

test("should let the Jenkins role pull and push service repositories without a shared repository", () => {
  const template = Template.fromStack(
    serviceRepositoriesStack({ ciRoleName: "my-ci-role" }),
  )
  const [roleLogicalId] = Object.keys(
    template.findResources("AWS::IAM::Role", {
      Properties: { RoleName: "my-ci-role" },
    }),
  )
  template.hasResourceProperties("AWS::IAM::Policy", {
    Roles: [{ Ref: roleLogicalId }],
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: Match.arrayWith(["ecr:BatchGetImage", "ecr:PutImage"]),
        }),
        Match.objectLike({ Action: "ecr:GetAuthorizationToken" }),
      ]),
    },
  })
})

test("should fail validation on a service repository name longer than ECR allows", () => {
  const name = "a".repeat(248)
  assert.deepStrictEqual(
    validateBuildArtifactsProps({
      bucketName: "my-bucket",
      serviceRepositories: [{ name: "a".repeat(247) }, { name }],
    }),
    [`Service repository name ${name} must be at most 247 characters`],
  )
})

test("build-artifacts with service repositories scanned by Aikido", (t) => {
  t.assert.snapshot(
    cdkTemplate(
      serviceRepositoriesStack({ aikido: { externalId: "my-external-id" } }),
    ),
  )
})

test("should let Aikido assume the scanner role with the external ID", () => {
  const template = Template.fromStack(
    serviceRepositoriesStack({ aikido: { externalId: "my-external-id" } }),
  )
  template.hasResourceProperties("AWS::IAM::Role", {
    RoleName: "AikidoSecurityEcrScanningRole",
    AssumeRolePolicyDocument: {
      Statement: [
        {
          Action: "sts:AssumeRole",
          Effect: "Allow",
          Principal: {
            AWS: "arn:aws:iam::881830977366:role/service-role/lambda-container-image-scanner-role-pb0qotst",
          },
          Condition: {
            StringEquals: { "sts:ExternalId": "my-external-id" },
          },
        },
      ],
    },
  })
})

test("should trust the given Aikido principal", () => {
  const template = Template.fromStack(
    serviceRepositoriesStack({
      aikido: {
        externalId: "my-external-id",
        principalArn: "arn:aws:iam::444444444444:role/my-scanner",
      },
    }),
  )
  template.hasResourceProperties("AWS::IAM::Role", {
    RoleName: "AikidoSecurityEcrScanningRole",
    AssumeRolePolicyDocument: {
      Statement: [
        Match.objectLike({
          Principal: { AWS: "arn:aws:iam::444444444444:role/my-scanner" },
        }),
      ],
    },
  })
})

test("should let Aikido read images only from service repositories", () => {
  const template = Template.fromStack(
    serviceRepositoriesStack({ aikido: { externalId: "my-external-id" } }),
  )
  const [roleLogicalId] = Object.keys(
    template.findResources("AWS::IAM::Role", {
      Properties: { RoleName: "AikidoSecurityEcrScanningRole" },
    }),
  )
  template.hasResourceProperties("AWS::IAM::Policy", {
    Roles: [{ Ref: roleLogicalId }],
    PolicyDocument: {
      Statement: [
        {
          Action: [
            "ecr:BatchCheckLayerAvailability",
            "ecr:BatchGetImage",
            "ecr:DescribeImages",
            "ecr:GetDownloadUrlForLayer",
            "ecr:ListImages",
            "ecr:ListTagsForResource",
          ],
          Effect: "Allow",
          Resource: {
            "Fn::Join": [
              "",
              [
                "arn:",
                { Ref: "AWS::Partition" },
                ":ecr:eu-west-1:111111111111:repository/services/*",
              ],
            ],
          },
        },
        {
          Action: [
            "ecr:DescribeRegistry",
            "ecr:DescribeRepositories",
            "ecr:GetAuthorizationToken",
          ],
          Effect: "Allow",
          Resource: "*",
        },
      ],
    },
  })
})

test("should link each service repository to its GitHub repository when Aikido is enabled", () => {
  const template = Template.fromStack(
    serviceRepositoriesStack({
      aikido: { externalId: "my-external-id" },
      serviceRepositories: [
        { name: "my-service" },
        { name: "other-service", owner: "other-owner" },
      ],
    }),
  )
  template.hasResourceProperties("AWS::ECR::Repository", {
    RepositoryName: "services/my-service",
    Tags: [
      {
        Key: "aik:repository",
        Value: "https://github.com/capralifecycle/my-service",
      },
    ],
  })
  template.hasResourceProperties("AWS::ECR::Repository", {
    RepositoryName: "services/other-service",
    Tags: [
      {
        Key: "aik:repository",
        Value: "https://github.com/other-owner/other-service",
      },
    ],
  })
})

test("should neither create the scanner role nor tag repositories without Aikido", () => {
  const template = Template.fromStack(serviceRepositoriesStack())
  template.resourcePropertiesCountIs(
    "AWS::IAM::Role",
    { RoleName: "AikidoSecurityEcrScanningRole" },
    0,
  )
  template.resourcePropertiesCountIs(
    "AWS::ECR::Repository",
    { Tags: Match.anyValue() },
    0,
  )
})

test("should fail validation on an Aikido external ID that IAM rejects", () => {
  const errors = validateBuildArtifactsProps({
    bucketName: "my-bucket",
    serviceRepositories: [{ name: "my-service" }],
    aikido: { externalId: "a" },
  })
  assert.deepStrictEqual(errors, [
    "Aikido external ID must be 2 to 1224 characters of letters, digits and +=,.@:/-_",
  ])
})

test("should accept an Aikido external ID resolved at deploy time", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  const externalId = new CfnParameter(stack, "ExternalId").valueAsString
  new BuildArtifacts(stack, "BuildArtifacts", {
    bucketName: "my-bucket",
    serviceRepositories: [{ name: "my-service" }],
    aikido: { externalId },
  })
  Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
    RoleName: "AikidoSecurityEcrScanningRole",
    AssumeRolePolicyDocument: {
      Statement: [
        Match.objectLike({
          Condition: {
            StringEquals: { "sts:ExternalId": { Ref: "ExternalId" } },
          },
        }),
      ],
    },
  })
})

test("should fail validation on Aikido without service repositories", () => {
  const errors = validateBuildArtifactsProps({
    bucketName: "my-bucket",
    ecrRepositoryName: "my-ecr-repo",
    aikido: { externalId: "my-external-id" },
  })
  assert.deepStrictEqual(errors, [
    "Aikido can only scan service repositories, but none were given",
  ])
})
