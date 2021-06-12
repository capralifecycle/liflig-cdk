import "@aws-cdk/assert/jest"
import * as cloudwatchActions from "@aws-cdk/aws-cloudwatch-actions"
import * as ec2 from "@aws-cdk/aws-ec2"
import * as sns from "@aws-cdk/aws-sns"
import { App, Stack } from "@aws-cdk/core"
import "jest-cdk-snapshot"
import { Cluster } from ".."

test("cluster", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack")
  const stack = new Stack(app, "Stack")

  const vpc = new ec2.Vpc(supportStack, "Vpc")

  const topic = new sns.Topic(supportStack, "Topic")
  const action = new cloudwatchActions.SnsAction(topic)

  new Cluster(stack, "Cluster", {
    vpc,
    alarmAction: action,
  })

  expect(stack).toMatchCdkSnapshot()
})
