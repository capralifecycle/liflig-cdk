import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Stack } from "aws-cdk-lib"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as sns from "aws-cdk-lib/aws-sns"
import { Cluster } from ".."

configureCdkSnapshots()

test("cluster", (t) => {
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

  t.assert.snapshot(cdkTemplate(stack))
})
