import "@aws-cdk/assert/jest"
import * as cm from "aws-cdk-lib/aws-certificatemanager"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as route53 from "aws-cdk-lib/aws-route53"
import * as sm from "aws-cdk-lib/aws-secretsmanager"
import { App, Stack } from "aws-cdk-lib"
import "jest-cdk-snapshot"
import { FargateService, ListenerRule } from ".."
import { Parameter } from "../../configure-parameters/configure-parameters"
import { LoadBalancer } from "../../load-balancer"

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
    domainName: `*.example.com`,
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
    enableCircuitBreaker: true,
  })

  new ListenerRule(stack, "Dns", {
    domainName: `example.com`,
    hostedZone: hostedZone,
    httpsListener: loadBalancer.httpsListener,
    listenerPriority: 10,
    loadBalancer: loadBalancer.loadBalancer,
    targetGroup: service.targetGroup!,
  })

  expect(stack).toMatchCdkSnapshot()
})
