import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Stack } from "aws-cdk-lib"
import * as cm from "aws-cdk-lib/aws-certificatemanager"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import { SslPolicy } from "aws-cdk-lib/aws-elasticloadbalancingv2"
import * as route53 from "aws-cdk-lib/aws-route53"
import { LoadBalancer } from ".."

configureCdkSnapshots()

test("create load balancer", (t) => {
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

  new LoadBalancer(stack, "LoadBalancer", {
    certificates: [certificate],
    vpc: vpc,
  })

  t.assert.snapshot(cdkTemplate(stack))
})

test("create load balancer and override TLS configuration", (t) => {
  const app = new App()

  const supportStack = new Stack(app, "SuuportStack", {
    env: {
      region: "eu-north-1",
    },
  })

  const stack = new Stack(app, "Stack", {
    env: {
      region: "eu-north-1",
    },
  })

  const vpc = new ec2.Vpc(supportStack, "Vpc")

  const hostedZone = new route53.HostedZone(supportStack, "HostedZone", {
    zoneName: "2.example.com",
  })

  const certificate = new cm.Certificate(supportStack, "Certificate", {
    domainName: "*.2.example.com",
    subjectAlternativeNames: ["2.example.com"],
    validation: cm.CertificateValidation.fromDns(hostedZone),
  })

  new LoadBalancer(stack, "LoadBalancer", {
    certificates: [certificate],
    vpc: vpc,
    overrideHttpsListenerProps: {
      sslPolicy: SslPolicy.RECOMMENDED_TLS,
    },
  })

  t.assert.snapshot(cdkTemplate(stack))
})
