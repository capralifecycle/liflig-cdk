import "@aws-cdk/assert/jest"
import { App, Stack } from "@aws-cdk/core"
import * as ec2 from "@aws-cdk/aws-ec2"
import * as ecs from "@aws-cdk/aws-ecs"
import * as sm from "@aws-cdk/aws-secretsmanager"
import * as ecr from "@aws-cdk/aws-ecr"
import * as cm from "@aws-cdk/aws-certificatemanager"
import "jest-cdk-snapshot"
import { HostedZoneWithParam } from "../hosted-zone-with-param"
import { LoadBalancer } from "../load-balancer"
import { EcsFargateService } from "../ecs-fargate-service"
import { EcsServiceDns } from "../ecs-service-dns"
import { Parameter } from "../configure-parameters/configure-parameters"

test("creates fargate service with parameters and DNS", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")

  const vpc = new ec2.Vpc(stack, "Vpc", {
    subnetConfiguration: [
      {
        cidrMask: 19,
        name: "Public",
        subnetType: ec2.SubnetType.PUBLIC,
      },
    ],
  })

  const hostedZoneWithParam = new HostedZoneWithParam(stack, "HostedZone", {
    zoneName: "example.com",
  })

  const hostedZone = hostedZoneWithParam.getHostedZone(stack, "HostedZone")

  const certificate = new cm.Certificate(stack, "Certificate", {
    domainName: `*.example.com`,
    subjectAlternativeNames: ["example.com"],
    validation: cm.CertificateValidation.fromDns(hostedZone),
  })

  const loadBalancer = new LoadBalancer(stack, "LoadBalancer", {
    certificates: [certificate],
    vpc: vpc,
  })

  const ecsCluster = new ecs.Cluster(stack, "Cluster", {
    vpc,
  })

  const ecrRepository = new ecr.Repository(stack, "Repository", {
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
      key: "ExampleSecretReferenceParameter",
      secretName: "SecretReferenceParameter",
    },
  ]

  const service = new EcsFargateService(stack, "Service", {
    serviceName: "example-service",
    vpc: vpc,
    cluster: ecsCluster,
    desiredCount: 2,
    parameters,
    ecrRepository: ecrRepository,
    ecrTag: "exampleEcrTag",
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
