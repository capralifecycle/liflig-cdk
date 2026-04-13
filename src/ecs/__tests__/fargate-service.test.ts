import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import * as cm from "aws-cdk-lib/aws-certificatemanager"
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as route53 from "aws-cdk-lib/aws-route53"
import * as sm from "aws-cdk-lib/aws-secretsmanager"
import * as sns from "aws-cdk-lib/aws-sns"
import "jest-cdk-snapshot"
import type { Parameter } from "../../configure-parameters"
import { LoadBalancer } from "../../load-balancer"
import { FargateService, ListenerRule } from ".."

test("creates fargate service with parameters and listener rule", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack", {
    env: {
      region: "eu-west-1",
    },
  })
  const stack = new Stack(app, "Stack", {
    env: {
      region: "eu-west-1",
    },
  })

  const vpc = new ec2.Vpc(supportStack, "Vpc")

  const hostedZone = new route53.HostedZone(supportStack, "HostedZone", {
    zoneName: "example.com",
  })

  const certificate = new cm.Certificate(supportStack, "Certificate", {
    domainName: "*.example.com",
    subjectAlternativeNames: ["example.com"],
    validation: cm.CertificateValidation.fromDns(hostedZone),
  })

  const loadBalancer = new LoadBalancer(supportStack, "LoadBalancer", {
    certificates: [certificate],
    vpc: vpc,
  })

  const ecsCluster = new ecs.Cluster(supportStack, "Cluster", {
    vpc,
  })

  const ecrRepository = new ecr.Repository(supportStack, "Repository", {
    repositoryName: "example-repository",
  })

  const parameters: Parameter[] = [
    {
      key: "ExamplePlainTextParameter",
      value: "ExamplePlainTextParameter",
    },
    {
      key: "ExampleSecretParameter",
      secret: sm.Secret.fromSecretNameV2(
        stack,
        "ExampleSecretParameter",
        "ExampleSecretParameter",
      ),
    },
    {
      key: "ExampleSecretByNameParameter",
      secretName: "ExampleSecretByNameParameter",
    },
  ]

  const service = new FargateService(stack, "Service", {
    serviceName: "example-service",
    vpc: vpc,
    cluster: ecsCluster,
    desiredCount: 2,
    parameters,
    ecsImage: ecs.ContainerImage.fromEcrRepository(
      ecrRepository,
      "exampleEcrTag",
    ),
    alarms: { enabled: false },
    enableCircuitBreaker: true,
  })

  new ListenerRule(stack, "Dns", {
    domainName: "example.com",
    hostedZone: hostedZone,
    httpsListener: loadBalancer.httpsListener,
    listenerPriority: 10,
    loadBalancer: loadBalancer.loadBalancer,
    targetGroup: service.targetGroup!,
  })

  expect(stack).toMatchCdkSnapshot()
})

// Happy-path test: when alarm and warning actions are provided, alarms are created
test("creates alarms when alarm and warning actions provided (happy path)", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack2", {
    env: { region: "eu-west-1" },
  })
  const stack = new Stack(app, "Stack2", {
    env: { region: "eu-west-1" },
  })

  const vpc = new ec2.Vpc(supportStack, "Vpc2")
  const ecsCluster = new ecs.Cluster(supportStack, "Cluster2", { vpc })
  const ecrRepository = new ecr.Repository(supportStack, "Repository2", {
    repositoryName: "example-repository-2",
  })

  const alarmTopic = new sns.Topic(stack, "AlarmTopic")
  const warningTopic = new sns.Topic(stack, "WarningTopic")

  const parameters: Parameter[] = [
    { key: "ExamplePlainTextParameter", value: "ExamplePlainTextParameter" },
  ]

  new FargateService(stack, "ServiceWithAlarms", {
    serviceName: "example-service-alarms",
    vpc,
    cluster: ecsCluster,
    desiredCount: 1,
    parameters,
    ecsImage: ecs.ContainerImage.fromEcrRepository(ecrRepository, "latest"),
    alarms: {
      alarmAction: new cwActions.SnsAction(alarmTopic),
      warningAction: new cwActions.SnsAction(warningTopic),
      loadBalancerFullName: "load-balancer-placeholder",
    },
  })

  // Expect at least one CloudWatch Alarm and SNS topic in the template
  expect(stack).toHaveResource("AWS::CloudWatch::Alarm")
  expect(stack).toHaveResource("AWS::SNS::Topic")
  expect(stack).toMatchCdkSnapshot()
})
