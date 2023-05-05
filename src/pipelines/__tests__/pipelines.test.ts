import * as assertions from "aws-cdk-lib/assertions"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as sfn from "aws-cdk-lib/aws-stepfunctions"
import { App, Stack } from "aws-cdk-lib"
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
  expect(assertions.Template.fromStack(stack).toJSON()).toMatchSnapshot()
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

  expect(assertions.Template.fromStack(stack).toJSON()).toMatchSnapshot()
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

  expect(assertions.Template.fromStack(stack).toJSON()).toMatchSnapshot()
})
