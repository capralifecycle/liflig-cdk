import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import * as cm from "aws-cdk-lib/aws-certificatemanager"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as sns from "aws-cdk-lib/aws-sns"
import "jest-cdk-snapshot"
import type { Parameter } from "../../configure-parameters"
import { LoadBalancer } from "../../load-balancer"
import { FargateService } from ".."

test("creates fargate service with alarms enabled", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack", {
    env: { region: "eu-west-1" },
  })
  const stack = new Stack(app, "Stack", { env: { region: "eu-west-1" } })

  const vpc = new ec2.Vpc(supportStack, "Vpc")

  const hostedZone = new ec2.CfnVPC(supportStack, "FakeHostedZone") // placeholder (not used)

  const certificate = new cm.Certificate(supportStack, "Certificate", {
    domainName: "*.example.com",
    validation: cm.CertificateValidation.fromDns(
      /* reuse a hosted zone-like construct */ hostedZone as unknown as any,
    ),
  })

  // Create a real LoadBalancer like other tests expect
  const lb = new LoadBalancer(supportStack, "LoadBalancer", {
    certificates: [certificate],
    vpc,
  })

  const ecsCluster = new ecs.Cluster(supportStack, "Cluster", { vpc })

  const ecrRepository = new ecr.Repository(supportStack, "Repository", {
    repositoryName: "example-repository",
  })

  const topic = new sns.Topic(supportStack, "Topic")
  const action = new cloudwatchActions.SnsAction(topic)

  const parameters: Parameter[] = []

  const service = new FargateService(stack, "Service", {
    serviceName: "example-service",
    vpc: vpc,
    cluster: ecsCluster,
    desiredCount: 1,
    parameters,
    ecsImage: ecs.ContainerImage.fromEcrRepository(ecrRepository, "latest"),
    // Enable alarms: must include alarmAction, warningAction and loadBalancerFullName
    alarms: {
      alarmAction: action,
      warningAction: action,
      loadBalancerFullName: "app/my-load-balancer/50dc6c495c0c9188",
    },
  })

  expect(stack).toMatchCdkSnapshot()
})
