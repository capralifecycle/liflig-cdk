import "@aws-cdk/assert/jest"
import { App, Duration, Stack } from "aws-cdk-lib"
import "jest-cdk-snapshot"
import { Webapp } from "../"
import { generateContentSecurityPolicyHeader } from "../security-headers"
test("create webapp with default parameters", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  new Webapp(stack, "Webapp", {})
  expect(stack).toMatchCdkSnapshot()
})

test("create webapp with domain and security headers", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  new Webapp(stack, "Webapp", {
    domainNames: ["example.com"],
  })
  expect(stack).toMatchCdkSnapshot()
})

test("create webapp with domain and custom response header policy with CSP", () => {
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
  expect(stack).toMatchCdkSnapshot()
})

test("create webapp with domain and custom response header policy with report-only CSP", () => {
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
  expect(stack).toMatchCdkSnapshot()
})
