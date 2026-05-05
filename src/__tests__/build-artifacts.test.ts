import { App, Stack } from "aws-cdk-lib"
import { Match, Template } from "aws-cdk-lib/assertions"
import * as iam from "aws-cdk-lib/aws-iam"
import {
  BuildArtifacts,
  validateProps as validateBuildArtifactsProps,
} from "../build-artifacts"
import { validateProps as validateGithubActionsRoleProps } from "../build-artifacts/github-actions-role"

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
  expect(errors).toEqual(["Default branch * contains invalid characters"])
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
  expect(errors).toContain("Trusted owner * contains invalid characters")
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
  expect(errors).toContain(
    "Owner capralifecycel of repository my-repository not configured as a trusted owner",
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
  expect(errors).toContain(
    "At least 1 repository must be supplied, but 0 were given",
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
  expect(errors).toContain(
    "At least 1 trusted owner must be supplied, but 0 were given",
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
