import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import { App, Duration, Stack } from "aws-cdk-lib"
import { SecurityPolicyProtocol } from "aws-cdk-lib/aws-cloudfront"
import { Webapp } from "../"
import { generateContentSecurityPolicyHeader } from "../security-headers"

configureCdkSnapshots()

test("create webapp with default parameters", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  new Webapp(stack, "Webapp", {})
  t.assert.snapshot(cdkTemplate(stack))
})

test("create webapp with domain and security headers", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  new Webapp(stack, "Webapp", {
    domainNames: ["example.com"],
  })
  t.assert.snapshot(cdkTemplate(stack))
})

test("create webapp with domain and custom response header policy with CSP", (t) => {
  const app = new App()
  const responseHeadersPolicy = generateContentSecurityPolicyHeader({
    connectSrc: "'self'",
  })
  const stack = new Stack(app, "Stack")
  new Webapp(stack, "Webapp", {
    domainNames: ["example.com"],
    securityHeaders: {
      behaviorOverrides: {
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(180),
          override: true,
        },
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: responseHeadersPolicy,
        },
      },
    },
  })
  t.assert.snapshot(cdkTemplate(stack))
})

test("create webapp with domain and custom response header policy with report-only CSP", (t) => {
  const app = new App()
  const responseHeadersPolicy = generateContentSecurityPolicyHeader({
    connectSrc: "'self'",
  })
  const stack = new Stack(app, "Stack")
  new Webapp(stack, "Webapp", {
    domainNames: ["example.com"],
    securityHeaders: {
      behaviorOverrides: {
        xssProtection: {
          override: true,
          protection: false,
          modeBlock: false,
        },
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: responseHeadersPolicy,
          reportOnly: true,
        },
      },
    },
  })
  t.assert.snapshot(cdkTemplate(stack))
})

test("create webapp with domain and override TLS configuration", (t) => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  new Webapp(stack, "Webapp", {
    overrideDistributionProps: {
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
    },
  })
  t.assert.snapshot(cdkTemplate(stack))
})
