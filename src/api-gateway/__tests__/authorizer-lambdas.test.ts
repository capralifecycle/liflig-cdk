import "@aws-cdk/assert/jest"
import * as basicAuthAuthorizer from "../authorizer-lambdas/basic-auth-authorizer"
import * as cognitoUserPoolAuthorizer from "../authorizer-lambdas/cognito-user-pool-authorizer"
import * as cognitoUserPoolOrBasicAuthAuthorizer from "../authorizer-lambdas/cognito-user-pool-or-basic-auth-authorizer"
import {
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerResult,
} from "aws-lambda"
import { SecretsManager } from "@aws-sdk/client-secrets-manager"
import { expect, jest } from "@jest/globals"

const TEST_BASIC_AUTH_USERNAME = "test-user"
const TEST_BASIC_AUTH_PASSWORD = "test-password"
const TEST_CREDENTIALS_SECRET_NAME = "test-secret-name"

const TEST_AUTH_CLIENT_ID = "test-client-id"
const VALID_ACCESS_TOKEN = "fVe5qmqtQOgKsj87O0uFHu8cQmEygpkW"
const EXPIRED_ACCESS_TOKEN = "YLflvBo2ryV9drG6IrRX7AfMZj6PLtjQ"

describe("API Gateway authorizer lambdas", () => {
  // We want to test various cases for all the different authorizer lambdas.
  // Some of the test cases overlap between the lambdas.
  // So we run table-driven tests, to cover all cases for all lambdas.
  type TestCase = {
    name: string
    authorizerName: string
    authorizer: {
      handler: (
        event: APIGatewayRequestAuthorizerEventV2,
      ) => Promise<APIGatewaySimpleAuthorizerResult>
    }
    env?: Record<string, string>
    authHeader: string
    expectedResult: APIGatewaySimpleAuthorizerResult
  }

  const baseBasicAuthAuthorizerTestCase = {
    authorizerName: "basic auth authorizer",
    authorizer: basicAuthAuthorizer,
    env: { ["CREDENTIALS_SECRET_NAME"]: TEST_CREDENTIALS_SECRET_NAME },
  }

  const baseCognitoAuthorizerTestCase = {
    authorizerName: "cognito authorizer",
    authorizer: cognitoUserPoolAuthorizer,
  }

  const baseCognitoOrBasicAuthAuthorizerTestCase = {
    authorizerName: "cognito or basic auth authorizer",
    authorizer: cognitoUserPoolOrBasicAuthAuthorizer,
    env: {
      ["BASIC_AUTH_CREDENTIALS_SECRET_NAME"]: TEST_CREDENTIALS_SECRET_NAME,
    },
  }

  const testCases: TestCase[] = [
    // Basic auth tests (for both basic-auth-authorizer and cognito-user-pool-or-basic-auth-authorizer)
    ...[
      baseBasicAuthAuthorizerTestCase,
      baseCognitoOrBasicAuthAuthorizerTestCase,
    ].flatMap((baseTestCase) => [
      {
        ...baseTestCase,
        name: "valid credentials",
        authHeader: basicAuthHeader(
          TEST_BASIC_AUTH_USERNAME,
          TEST_BASIC_AUTH_PASSWORD,
        ),
        expectedResult: { isAuthorized: true },
      },
      {
        ...baseTestCase,
        name: "invalid credentials",
        authHeader: basicAuthHeader("wrong-username", "wrong-password"),
        expectedResult: { isAuthorized: false },
      },
    ]),

    // Cognito access token tests (for both cognito-user-pool-authorizer and cognito-user-pool-or-basic-auth-authorizer)
    ...[
      baseCognitoAuthorizerTestCase,
      baseCognitoOrBasicAuthAuthorizerTestCase,
    ].flatMap((baseTestCase) => [
      {
        ...baseTestCase,
        name: "valid token",
        authHeader: accessTokenHeader(VALID_ACCESS_TOKEN),
        expectedResult: { isAuthorized: true },
      },
      {
        ...baseTestCase,
        name: "invalid token",
        authHeader: "gibberish",
        expectedResult: { isAuthorized: false },
      },
    ]),
  ]

  for (const testCase of testCases) {
    test(`${testCase.authorizerName}: ${testCase.name}`, async () => {
      if (testCase.env !== undefined) {
        process.env = { ...process.env, ...testCase.env }
      }

      const result = await testCase.authorizer.handler(
        createAuthorizerEvent(testCase.authHeader),
      )
      expect(result.isAuthorized).toBe(testCase.expectedResult.isAuthorized)
    })
  }

  // Expired token requires us to check for a thrown error, so we test this separately from the other
  // test cases
  for (const testCase of [
    baseCognitoAuthorizerTestCase,
    baseCognitoOrBasicAuthAuthorizerTestCase,
  ]) {
    test(`${testCase.authorizerName}: expired token`, async () => {
      let error: unknown
      try {
        await testCase.authorizer.handler(
          createAuthorizerEvent(accessTokenHeader(EXPIRED_ACCESS_TOKEN)),
        )
      } catch (e: unknown) {
        error = e
      }

      expect(error).toBeDefined()
      expect(error).toBeInstanceOf(Error)
      // See comment in cognito-user-pool-authorizer
      expect((error as Error).message).toBe("Unauthorized")
    })
  }

  beforeAll(() => {
    const mockSecretsManager = () =>
      new MockSecretsManager() as unknown as SecretsManager

    const mockTokenVerifier = () =>
      new MockTokenVerifier() as unknown as cognitoUserPoolAuthorizer.TokenVerifier

    basicAuthAuthorizer.dependencies.createSecretsManager = mockSecretsManager
    cognitoUserPoolAuthorizer.dependencies.createSecretsManager =
      mockSecretsManager
    cognitoUserPoolAuthorizer.dependencies.createTokenVerifier =
      mockTokenVerifier
    cognitoUserPoolOrBasicAuthAuthorizer.dependencies.createSecretsManager =
      mockSecretsManager
    cognitoUserPoolOrBasicAuthAuthorizer.dependencies.createTokenVerifier =
      mockTokenVerifier
  })

  // Reset process.env between tests: https://stackoverflow.com/a/48042799
  const OLD_ENV = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...OLD_ENV } // Make a copy
  })

  afterAll(() => {
    process.env = OLD_ENV // Restore old environment
  })
})

function createAuthorizerEvent(
  authorizationHeader: string,
): APIGatewayRequestAuthorizerEventV2 {
  return {
    headers: {
      authorization: authorizationHeader,
    },
  } as unknown as APIGatewayRequestAuthorizerEventV2 // We only use the above fields
}

function basicAuthHeader(username: string, password: string) {
  return "Basic " + Buffer.from(`${username}:${password}`).toString("base64")
}

function accessTokenHeader(token: string) {
  return "Bearer " + token
}

class MockSecretsManager {
  // eslint-disable-next-line @typescript-eslint/require-await
  public async getSecretValue(args: {
    SecretId: string
  }): Promise<{ SecretString: string }> {
    if (args.SecretId !== TEST_CREDENTIALS_SECRET_NAME) {
      throw new Error(`Invalid secret name '${args.SecretId}'`)
    }

    return {
      SecretString: `{"username":"${TEST_BASIC_AUTH_USERNAME}","password":"${TEST_BASIC_AUTH_PASSWORD}"}`,
    }
  }
}

class MockTokenVerifier {
  // eslint-disable-next-line @typescript-eslint/require-await
  public async verify(token: string): Promise<{ client_id: string }> {
    switch (token) {
      case VALID_ACCESS_TOKEN:
        return { client_id: TEST_AUTH_CLIENT_ID }
      case EXPIRED_ACCESS_TOKEN:
        // Message matching https://github.com/awslabs/aws-jwt-verify/blob/8d8f714d7281913ecd660147f5c30311479601c1/src/jwt.ts#L197
        throw new Error("Token expired at 2025-02-13T09:13:30Z")
      default:
        throw new Error("Invalid token")
    }
  }
}
