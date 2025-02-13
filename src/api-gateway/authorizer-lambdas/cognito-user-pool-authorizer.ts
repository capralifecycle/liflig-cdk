/**
 * This lambda verifies bearer token in authorization header using Cognito.
 *
 * Expects the following environment variables:
 * - USER_POOL_ID
 * - REQUIRED_SCOPE (optional)
 *   - Set this to require that the bearer token payload contains the given scope
 * - CREDENTIALS_FOR_INTERNAL_AUTHORIZATION (optional)
 *   - Secret name from which to get basic auth credentials that should be forwarded to backend
 *     integration if authentication succeeds
 *   - Secret value should follow this format: `{"username":"<username>","password":"<password>"}`
 */

import type {
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerResult,
} from "aws-lambda"
import { SecretsManager } from "@aws-sdk/client-secrets-manager"
import { CognitoJwtVerifier } from "aws-jwt-verify"
import type { CognitoAccessTokenPayload } from "aws-jwt-verify/jwt-model"

type AuthorizerResult = APIGatewaySimpleAuthorizerResult & {
  /**
   * Returning a context object from our authorizer allows our API Gateway to access these variables
   * via `${context.authorizer.<property>}`.
   * https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging-variables.html
   */
  context?: {
    /**
     * If the token is verified, we return the auth client ID from the token's claims as a context
     * variable (named `authorizer.clientId`). You can then use this for parameter mapping on the
     * API Gateway (see `AlbIntegrationProps.mapParameters` on the `ApiGateway` construct), if for
     * example you want to forward this to the backend integration.
     */
    clientId: string
    /**
     * If `CREDENTIALS_FOR_INTERNAL_AUTHORIZATION` is provided, we want to forward basic auth
     * credentials to our backend, as an additional authentication layer. See the docstring on
     * `CognitoUserPoolAuthorizerProps.basicAuthForInternalAuthorization` in the `ApiGateway`
     * construct for more on this.
     */
    internalAuthorizationHeader?: string
  }
}

export const handler = async (
  event: APIGatewayRequestAuthorizerEventV2,
): Promise<AuthorizerResult> => {
  const authHeader = event.headers?.authorization
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { isAuthorized: false }
  }

  const result = await verifyAccessToken(authHeader.substring(7)) // substring(7) == after 'Bearer '
  switch (result) {
    case "INVALID":
      return { isAuthorized: false }
    case "EXPIRED":
      // We want to return 401 Unauthorized for expired tokens, so the client knows to refresh
      // their token when receiving this status code. API Gateway authorizer lambdas return
      // 403 Forbidden for {isAuthorized: false}, but there is a way to return 401: throwing an
      // error with this exact string. https://stackoverflow.com/a/71965890
      throw new Error("Unauthorized")
    default: {
      return {
        isAuthorized: true,
        context: {
          clientId: result.client_id,
          internalAuthorizationHeader: await getInternalAuthorizationHeader(),
        },
      }
    }
  }
}

/** Decodes and verifies the given token against Cognito. */
async function verifyAccessToken(
  token: string,
): Promise<CognitoAccessTokenPayload | "EXPIRED" | "INVALID"> {
  try {
    const tokenVerifier = getTokenVerifier()
    // Must await here instead of returning the promise directly, so that errors can be caught in
    // this function
    return await tokenVerifier.verify(token)
  } catch (e) {
    // If the JWT has expired, aws-jwt-verify throws this error:
    // https://github.com/awslabs/aws-jwt-verify/blob/8d8f714d7281913ecd660147f5c30311479601c1/src/jwt.ts#L197
    // We can't check instanceof on that error class, since it's not exported, so this is the next
    // best thing.
    if (e instanceof Error && e.message?.includes("Token expired")) {
      return "EXPIRED"
    } else {
      return "INVALID"
    }
  }
}

export type TokenVerifier = {
  verify: (accessToken: string) => Promise<CognitoAccessTokenPayload>
}

/**
 * We cache the verifier in this global variable, so that subsequent invocations of a hot lambda
 * will re-use this.
 */
let cachedTokenVerifier: TokenVerifier | undefined = undefined

function getTokenVerifier(): TokenVerifier {
  if (cachedTokenVerifier === undefined) {
    cachedTokenVerifier = dependencies.createTokenVerifier()
  }
  return cachedTokenVerifier
}

/** For overriding dependency creation in tests. */
export const dependencies = {
  createTokenVerifier: (): TokenVerifier => {
    const userPoolId = process.env["USER_POOL_ID"]
    if (!userPoolId) {
      console.error("USER_POOL_ID env variable is not defined")
      throw new Error()
    }

    return CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: "access",
      clientId: null,
      scope: process.env.REQUIRED_SCOPE || undefined, // `|| undefined` to discard empty string
    })
  },
  createSecretsManager: () => new SecretsManager(),
}

/** Cache this value, so that subsequent lambda invocations don't have to refetch. */
let cachedInternalAuthorizationHeader: string | undefined = undefined

async function getInternalAuthorizationHeader(): Promise<string | undefined> {
  if (cachedInternalAuthorizationHeader === undefined) {
    const secretName: string | undefined =
      process.env["CREDENTIALS_FOR_INTERNAL_AUTHORIZATION"]
    if (!secretName) {
      return undefined
    }

    cachedInternalAuthorizationHeader =
      await getSecretAsBasicAuthHeader(secretName)
  }

  return cachedInternalAuthorizationHeader
}

async function getSecretAsBasicAuthHeader(secretName: string): Promise<string> {
  const credentials = await getSecretValue(secretName)
  if (!secretHasExpectedFormat(credentials)) {
    console.error(
      `Basic auth credentials secret did not follow expected format (secret name: '${secretName}')`,
    )
    throw new Error()
  }

  return (
    "Basic " +
    Buffer.from(`${credentials.username}:${credentials.password}`).toString(
      "base64",
    )
  )
}

async function getSecretValue(secretName: string): Promise<unknown> {
  const client = dependencies.createSecretsManager()
  const secret = await client.getSecretValue({ SecretId: secretName })

  if (!secret.SecretString) {
    console.error(`Secret value not found for '${secretName}'`)
    throw new Error()
  }

  return JSON.parse(secret.SecretString)
}

function secretHasExpectedFormat(
  value: unknown,
): value is { username: string; password: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "username" in value &&
    typeof value.username === "string" &&
    "password" in value &&
    typeof value.password === "string"
  )
}
