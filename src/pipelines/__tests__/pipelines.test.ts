import * as ec2 from "@aws-cdk/aws-ec2"
import * as sfn from "@aws-cdk/aws-stepfunctions"
import { App, Stack } from "@aws-cdk/core"
import "jest-cdk-snapshot"
import { LifligCdkDeployerDeps, Pipeline } from "../"

test("LifligCdkDeployerDeps", () => {
  const app = new App()
  const stack = new Stack(app, "Stack", {
    env: {
      region: "eu-west-1",
    },
  })

  new LifligCdkDeployerDeps(stack, "LifligCdkDeployerDeps", {
    trustedAccountIds: ["112233445566"],
  })

  expect(stack).toMatchCdkSnapshot()
})

test("Pipeline", () => {
  const app = new App()

  const supportStack = new Stack(app, "SupportStack", {
    env: {
      region: "eu-west-1",
    },
  })

  const vpc = new ec2.Vpc(supportStack, "Vpc")

  const stack = new Stack(app, "Stack", {
    env: {
      region: "eu-west-1",
    },
  })

  new Pipeline(stack, "Pipeline", {
    environments: [
      {
        accountId: "112233445566",
        name: "dev",
      },
    ],
    pipelineName: "dev-something",
    vpc,
  })

  expect(stack).toMatchCdkSnapshot()
})

test("Pipeline with after deploy task", () => {
  const app = new App()

  const supportStack = new Stack(app, "SupportStack", {
    env: {
      region: "eu-west-1",
    },
  })

  const vpc = new ec2.Vpc(supportStack, "Vpc")

  const stack = new Stack(app, "Stack", {
    env: {
      region: "eu-west-1",
    },
  })

  new Pipeline(stack, "Pipeline", {
    environments: [
      {
        accountId: "112233445566",
        name: "dev",
        afterSuccessfulDeploy: sfn.Chain.start(
          new sfn.Pass(stack, "AfterDeploy"),
        ),
      },
    ],
    pipelineName: "dev-something",
    vpc,
  })

  expect(stack).toMatchCdkSnapshot()
})
