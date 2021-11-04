import "@aws-cdk/assert/jest"
import { App, Stack } from "@aws-cdk/core"
import "jest-cdk-snapshot"
import { Webapp } from ".."

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
    enableSecurityHeaders: true,
  })
  expect(stack).toMatchCdkSnapshot()
})

test("create webapp with invalid custom security headers", () => {
  const app = new App()
  const stack = new Stack(app, "Stack")
  expect(() => {
    new Webapp(stack, "Webapp", {
      enableSecurityHeaders: true,
      securityHeadersOverrides: {
        contentSecurityPolicy: {
          fontSrc: "\x22",
        },
      },
    })
  }).toThrow()
  expect(() => {
    new Webapp(stack, "Webapp", {
      enableSecurityHeaders: true,
      securityHeadersOverrides: {
        contentSecurityPolicy: {
          fontSrc: ";",
        },
      },
    })
  }).toThrow()
  expect(() => {
    new Webapp(stack, "Webapp", {
      enableSecurityHeaders: true,
      securityHeadersOverrides: {
        contentSecurityPolicy: {
          fontSrc: "\\x22",
        },
      },
    })
  }).toThrow()
})
