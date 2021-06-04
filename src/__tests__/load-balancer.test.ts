import "@aws-cdk/assert/jest"
import { App, Stack } from "@aws-cdk/core"
import * as ec2 from "@aws-cdk/aws-ec2"
import * as route53 from "@aws-cdk/aws-route53"
import * as cm from "@aws-cdk/aws-certificatemanager"
import "jest-cdk-snapshot"
import { LoadBalancer } from "../load-balancer"

test("create load balancer", () => {
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

  const hostedZone = new route53.HostedZone(stack, "HostedZone", {
    zoneName: "example.com",
  })

  const certificate = new cm.Certificate(stack, "Certificate", {
    domainName: `*.example.com`,
    subjectAlternativeNames: ["example.com"],
    validation: cm.CertificateValidation.fromDns(hostedZone),
  })

  new LoadBalancer(stack, "LoadBalancer", {
    certificates: [certificate],
    vpc: vpc,
  })

  expect(stack).toMatchCdkSnapshot()
})
