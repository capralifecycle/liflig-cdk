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

const DEFAULT_CREDENTIALS_SECRET = "default"
const CREDENTIALS_SECRET_WITH_ARRAY_FORMAT = "array"
const CREDENTIALS_SECRET_WITH_ENCODED_ARRAY_FORMAT = "encoded-array"
const DEFAULT_CREDENTIALS = {
  username: "test-user-1",
  password: "test-password-1",
}
const ALTERNATE_CREDENTIALS = {
  username: "test-user-2",
  password: "test-password-2",
}

const TEST_AUTH_CLIENT_ID = "test-client-id"
const VALID_ACCESS_TOKEN = "fVe5qmqtQOgKsj87O0uFHu8cQmEygpkW"
const EXPIRED_ACCESS_TOKEN = "YLflvBo2ryV9drG6IrRX7AfMZj6PLtjQ"

describe("API Gateway authorizer lambdas", () => {
  // We want to test various cases for all the different authorizer lambdas.
  // Some of the test cases overlap between the lambdas.
  // So we run table-driven tests, to cover all cases for all lambdas.
  type BaseTestCase = {
    authorizerName: string
    authorizer: {
      handler: (
        event: APIGatewayRequestAuthorizerEventV2,
      ) => Promise<APIGatewaySimpleAuthorizerResult & { context?: unknown }>
    }
    supportsAccessToken?: boolean
    supportsBasicAuth?: boolean
    supportsMultipleCredentials?: boolean
    credentialsEnvKey: string
    credentialsEnvValue: string
    expectedResultContext: {
      clientId?: boolean
      username?: boolean
      internalAuthorizationHeader?: boolean
    }
  }

  type TestCase = BaseTestCase & {
    name: string
    expectedResult: APIGatewaySimpleAuthorizerResult
  } & (
      | { accessToken: string }
      | { basicAuth: { username: string; password: string } }
    )

  const baseCognitoAuthorizerTestCase: BaseTestCase = {
    authorizerName: "cognito authorizer",
    authorizer: cognitoUserPoolAuthorizer,
    supportsAccessToken: true,
    credentialsEnvKey: "CREDENTIALS_FOR_INTERNAL_AUTHORIZATION",
    credentialsEnvValue: DEFAULT_CREDENTIALS_SECRET,
    expectedResultContext: {
      clientId: true,
      internalAuthorizationHeader: true,
    },
  }

  const baseBasicAuthAuthorizerTestCase: BaseTestCase = {
    authorizerName: "basic auth authorizer",
    authorizer: basicAuthAuthorizer,
    supportsBasicAuth: true,
    credentialsEnvKey: "CREDENTIALS_SECRET_NAME",
    credentialsEnvValue: DEFAULT_CREDENTIALS_SECRET,
    expectedResultContext: {
      username: true,
    },
  }

  const baseCognitoOrBasicAuthAuthorizerTestCase: BaseTestCase = {
    authorizerName: "cognito or basic auth authorizer",
    authorizer: cognitoUserPoolOrBasicAuthAuthorizer,
    supportsAccessToken: true,
    supportsBasicAuth: true,
    credentialsEnvKey: "BASIC_AUTH_CREDENTIALS_SECRET_NAME",
    credentialsEnvValue: DEFAULT_CREDENTIALS_SECRET,
    expectedResultContext: {
      clientId: true,
      username: true,
      internalAuthorizationHeader: true,
    },
  }

  const baseTestCases: BaseTestCase[] = [
    baseCognitoAuthorizerTestCase,
    baseBasicAuthAuthorizerTestCase,
    baseCognitoOrBasicAuthAuthorizerTestCase,
  ].flatMap((testCase) => {
    if (!testCase.supportsBasicAuth) {
      return [testCase]
    }

    // If authorizer supports basic auth, we want to test loading the credentials secret on the
    // alternate encoded array format as well
    return [
      testCase,
      {
        ...testCase,
        credentialsEnvValue: CREDENTIALS_SECRET_WITH_ARRAY_FORMAT,
        supportsMultipleCredentials: true,
      },
      {
        ...testCase,
        credentialsEnvValue: CREDENTIALS_SECRET_WITH_ENCODED_ARRAY_FORMAT,
        supportsMultipleCredentials: true,
      },
    ]
  })

  const testCases: TestCase[] = [
    // Cognito access token tests (for both cognito-user-pool-authorizer and cognito-user-pool-or-basic-auth-authorizer)
    ...baseTestCases
      .filter((testCase) => testCase.supportsAccessToken)
      .flatMap((testCase) => [
        {
          ...testCase,
          name: "valid access token",
          accessToken: VALID_ACCESS_TOKEN,
          expectedResult: { isAuthorized: true },
        },
        {
          ...testCase,
          name: "invalid access token",
          accessToken: "gibberish",
          expectedResult: { isAuthorized: false },
        },
      ]),

    // Basic auth tests (for both basic-auth-authorizer and cognito-user-pool-or-basic-auth-authorizer)
    ...baseTestCases
      .filter((testCase) => testCase.supportsBasicAuth)
      .flatMap((testCase) => [
        {
          ...testCase,
          name: "valid basic auth credentials",
          basicAuth: DEFAULT_CREDENTIALS,
          expectedResult: { isAuthorized: true },
        },
        {
          ...testCase,
          name: "invalid basic auth credentials",
          basicAuth: {
            username: "wrong-username",
            password: "wrong-password",
          },
          expectedResult: { isAuthorized: false },
        },
      ]),

    // If authorizer supports multiple credentials (using secret on array format), we want to test
    // that it can be invoked with alternate credentials
    ...baseTestCases
      .filter(
        (testCase) =>
          testCase.supportsBasicAuth && testCase.supportsMultipleCredentials,
      )
      .map((testCase) => ({
        ...testCase,
        name: "alternate credentials",
        basicAuth: ALTERNATE_CREDENTIALS,
        expectedResult: { isAuthorized: true },
      })),
  ]

  for (const testCase of testCases) {
    test(`${testCase.authorizerName}: ${testCase.name} (secret format: ${testCase.credentialsEnvValue})`, async () => {
      process.env = {
        ...process.env,
        [testCase.credentialsEnvKey]: testCase.credentialsEnvValue,
      }

      let authHeader: string
      if ("accessToken" in testCase) {
        authHeader = bearerTokenHeader(testCase.accessToken)
      } else {
        authHeader = basicAuthHeader(testCase.basicAuth)
      }

      const result = await testCase.authorizer.handler(
        createAuthorizerEvent(authHeader),
      )
      expect(result.isAuthorized).toBe(testCase.expectedResult.isAuthorized)

      if (result.isAuthorized) {
        const expectedResultContext: Record<string, string> = {}
        if (
          testCase.expectedResultContext.clientId &&
          "accessToken" in testCase
        ) {
          expectedResultContext.clientId = TEST_AUTH_CLIENT_ID
        }
        if (
          testCase.expectedResultContext.username &&
          "basicAuth" in testCase
        ) {
          expectedResultContext.username = testCase.basicAuth.username
        }
        if (testCase.expectedResultContext.internalAuthorizationHeader) {
          if ("basicAuth" in testCase) {
            expectedResultContext.internalAuthorizationHeader = basicAuthHeader(
              testCase.basicAuth,
            )
          } else {
            expectedResultContext.internalAuthorizationHeader =
              basicAuthHeader(DEFAULT_CREDENTIALS)
          }
        }
        expect(result.context).toEqual(expectedResultContext)
      }
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
          createAuthorizerEvent(bearerTokenHeader(EXPIRED_ACCESS_TOKEN)),
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

  // Clear cached global variables after each test
  afterEach(() => {
    basicAuthAuthorizer.clearCache()
    cognitoUserPoolAuthorizer.clearCache()
    cognitoUserPoolOrBasicAuthAuthorizer.clearCache()
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

function basicAuthHeader(credentials: { username: string; password: string }) {
  return (
    "Basic " +
    Buffer.from(`${credentials.username}:${credentials.password}`).toString(
      "base64",
    )
  )
}

function bearerTokenHeader(token: string) {
  return "Bearer " + token
}

class MockSecretsManager {
  // eslint-disable-next-line @typescript-eslint/require-await
  public async getSecretValue(args: {
    SecretId: string
  }): Promise<{ SecretString: string }> {
    switch (args.SecretId) {
      case DEFAULT_CREDENTIALS_SECRET:
        return {
          SecretString: `{"username":"test-user-1","password":"test-password-1"}`,
        }
      case CREDENTIALS_SECRET_WITH_ARRAY_FORMAT:
        return {
          SecretString: String.raw`{"credentials":"[{\"username\":\"test-user-1\",\"password\":\"test-password-1\"},{\"username\":\"test-user-2\",\"password\":\"test-password-2\"}]"}`,
        }
      case CREDENTIALS_SECRET_WITH_ENCODED_ARRAY_FORMAT:
        return {
          // base64-encoding of DEFAULT_CREDENTIALS and ALTERNATE_CREDENTIALS
          SecretString: String.raw`{"credentials":"[\"dGVzdC11c2VyLTE6dGVzdC1wYXNzd29yZC0x\",\"dGVzdC11c2VyLTI6dGVzdC1wYXNzd29yZC0y\"]"}`,
        }
      default:
        throw new Error(`Invalid secret name '${args.SecretId}'`)
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
