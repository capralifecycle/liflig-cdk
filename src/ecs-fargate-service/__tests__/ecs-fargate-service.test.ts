import "@aws-cdk/assert/jest"
import { App, Stack } from "@aws-cdk/core"
import * as ec2 from "@aws-cdk/aws-ec2"
import * as ecs from "@aws-cdk/aws-ecs"
import * as sm from "@aws-cdk/aws-secretsmanager"
import * as ecr from "@aws-cdk/aws-ecr"
import * as route53 from "@aws-cdk/aws-route53"
import * as cm from "@aws-cdk/aws-certificatemanager"
import "jest-cdk-snapshot"
import { LoadBalancer } from "../../load-balancer"
import { EcsFargateService } from ".."
import { EcsServiceDns } from "../../ecs-service-dns"
import { Parameter } from "../../configure-parameters/configure-parameters"

test("creates fargate service with parameters and DNS", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack")
  const stack = new Stack(app, "Stack")

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

  const service = new EcsFargateService(stack, "Service", {
    serviceName: "example-service",
    vpc: vpc,
    cluster: ecsCluster,
    desiredCount: 2,
    parameters,
    ecsImage: ecs.ContainerImage.fromEcrRepository(
      ecrRepository,
      "exampleEcrTag",
    ),
  })

  new EcsServiceDns(stack, "Dns", {
    domainName: `example.com`,
    hostedZone: hostedZone,
    httpsListener: loadBalancer.httpsListener,
    listenerPriority: 10,
    loadBalancer: loadBalancer.loadBalancer,
    targetGroup: service.targetGroup,
  })

  expect(stack).toMatchCdkSnapshot()
})
