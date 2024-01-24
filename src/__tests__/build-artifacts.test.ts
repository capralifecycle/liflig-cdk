import { Template, Match } from "aws-cdk-lib/assertions"
import * as iam from "aws-cdk-lib/aws-iam"
import { App, Stack } from "aws-cdk-lib"
import {
  BuildArtifacts,
  validateProps as validateBuildArtifactsProps,
} from "../build-artifacts"
import { validateProps as validateGithubActionsRoleProps } from "../build-artifacts/github-actions-role"

test("should fail validation on invalid default branch", () => {
  const valid = validateBuildArtifactsProps({
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
  expect(valid).toBe(false)
})

test("should fail validation on invalid trusted owner", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  const valid = validateGithubActionsRoleProps({
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
  expect(valid).toBe(false)
})

test("should fail validation on missing trusted owner", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  const valid = validateGithubActionsRoleProps({
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
  expect(valid).toBe(false)
})

test("should fail validation on empty list of repositories", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  const valid = validateGithubActionsRoleProps({
    repositories: [],
    oidcProvider: iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      stack,
      "Provider",
      "arn:aws:iam::12345789012:oidc-provider/token.actions.githubusercontent.com",
    ),
    trustedOwners: ["capralifecycle"],
  })
  expect(valid).toBe(false)
})

test("should fail validation on empty list of trusted owners", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  const valid = validateGithubActionsRoleProps({
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
  expect(valid).toBe(false)
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
                "repo:capralifecycle/my-repository:ref:refs/heads/*",
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
  expect(() => {
    new BuildArtifacts(stack, "BuildArtifacts", {
      ecrRepositoryName: "some-ecr-repo-name",
      bucketName: "bucket-name",
      githubActions: {
        repositories: [],
      },
    })
  }).toThrow()
})
