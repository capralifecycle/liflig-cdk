/**
 * This lambda verifies credentials:
 * - Against Cognito user pool if request uses access token in Bearer authorization header
 * - Against credentials saved in Secret Manager if request uses basic auth (and if secret exists)
 *
 * Expects the following environment variables:
 * - USER_POOL_ID
 * - BASIC_AUTH_CREDENTIALS_SECRET_NAME (optional)
 *   - Name of secret in AWS Secrets Manager that stores basic auth credentials. See
 *     `BasicAuthAuthorizerProps` on the `ApiGateway` construct for the supported formats.
 * - REQUIRED_SCOPE (optional)
 *   - Set this to require that the access token payload contains the given scope
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
   * https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-parameter-mapping.html
   */
  context?: {
    /**
     * If the request used an access token, and the token was verified, we return the auth client ID
     * from the token's claims in this context variable (named `authorizer.clientId`). We use this
     * to include the requesting client in the API Gateway access logs (see `defaultAccessLogFormat`
     * in our `ApiGateway` construct). You can also use this when mapping parameters to the backend
     * integration (see `AlbIntegrationProps.mapParameters` on the `ApiGateway` construct).
     */
    clientId?: string
    /**
     * If the request used Basic Auth, and the credentials were verified, we return the username
     * that was used in this context variable (named `authorizer.username`). We use this to include
     * the requesting user in the API Gateway access logs (see `defaultAccessLogFormat` in our
     * `ApiGateway` construct). You can also use this when mapping parameters to the backend
     * integration (see `AlbIntegrationProps.mapParameters` on the `ApiGateway` construct).
     */
    username?: string
    /**
     * See `CognitoUserPoolAuthorizerProps.basicAuthForInternalAuthorization` on the `ApiGateway`
     * construct (we provide the same context variable here as in the Cognito User Pool authorizer,
     * using the credentials from BASIC_AUTH_CREDENTIALS_SECRET_NAME).
     */
    internalAuthorizationHeader?: string
  }
}

export const handler = async (
  event: APIGatewayRequestAuthorizerEventV2,
): Promise<AuthorizerResult> => {
  const authHeader = event.headers?.authorization
  if (!authHeader) {
    return { isAuthorized: false }
  }

  const expectedBasicAuthCredentials = await getExpectedBasicAuthCredentials()

  if (authHeader.startsWith("Bearer ")) {
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
      default:
        return {
          isAuthorized: true,
          context: {
            clientId: result.client_id,
            internalAuthorizationHeader:
              expectedBasicAuthCredentials?.[0]?.basicAuthHeader,
          },
        }
    }
  } else if (
    authHeader.startsWith("Basic ") &&
    expectedBasicAuthCredentials !== undefined
  ) {
    for (const expected of expectedBasicAuthCredentials) {
      if (authHeader === expected.basicAuthHeader) {
        return {
          isAuthorized: true,
          context: {
            username: expected.username,
            internalAuthorizationHeader: expected.basicAuthHeader,
          },
        }
      }
    }
    return { isAuthorized: false }
  } else {
    return { isAuthorized: false }
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

type ExpectedBasicAuthCredentials = {
  basicAuthHeader: string
  username: string
}

/** Cache this value, so that subsequent lambda invocations don't have to refetch. */
let cachedBasicAuthCredentials: ExpectedBasicAuthCredentials[] | undefined =
  undefined

/**
 * Returns an array, to support credential secrets with multiple values (see
 * `BasicAuthAuthorizerProps` on the `ApiGateway` construct for more on this).
 */
async function getExpectedBasicAuthCredentials(): Promise<
  ExpectedBasicAuthCredentials[] | undefined
> {
  if (cachedBasicAuthCredentials === undefined) {
    const secretName: string | undefined =
      process.env["BASIC_AUTH_CREDENTIALS_SECRET_NAME"]
    if (!secretName) {
      return undefined
    }

    cachedBasicAuthCredentials = await getBasicAuthCredentialsSecret(secretName)
  }

  return cachedBasicAuthCredentials
}

async function getBasicAuthCredentialsSecret(
  secretName: string,
): Promise<ExpectedBasicAuthCredentials[]> {
  const secret = await getSecretValue(secretName)

  if (isUsernameAndPasswordObject(secret)) {
    return [encodeBasicAuthCredentials(secret)]
  }

  // See `BasicAuthAuthorizerProps` on the `ApiGateway` construct for an explanation of the formats
  // we parse here
  if (hasCredentialsKeyWithStringValue(secret)) {
    let credentialsArray: unknown
    try {
      credentialsArray = JSON.parse(secret.credentials)
    } catch (e) {
      console.error(
        `Failed to parse credentials array in secret '${secretName}' as JSON`,
        e,
      )
      throw new Error()
    }

    if (isArrayOfUsernameAndPasswordObjects(credentialsArray)) {
      return credentialsArray.map(encodeBasicAuthCredentials)
    }

    if (isStringArray(credentialsArray)) {
      return credentialsArray.map(parseEncodedBasicAuthCredentials)
    }
  }

  console.error(
    `Basic auth credentials secret did not follow any expected format (secret name: '${secretName}')`,
  )
  throw new Error()
}

async function getSecretValue(secretName: string): Promise<unknown> {
  const client = dependencies.createSecretsManager()
  const secret = await client.getSecretValue({ SecretId: secretName })

  if (!secret.SecretString) {
    console.error(`Secret value not found for '${secretName}'`)
    throw new Error()
  }

  try {
    return JSON.parse(secret.SecretString)
  } catch (e) {
    console.error(`Failed to parse secret '${secretName}' as JSON:`, e)
    throw new Error()
  }
}

function encodeBasicAuthCredentials(credentials: {
  username: string
  password: string
}): ExpectedBasicAuthCredentials {
  const basicAuthHeader =
    "Basic " +
    Buffer.from(`${credentials.username}:${credentials.password}`).toString(
      "base64",
    )

  return { basicAuthHeader, username: credentials.username }
}

function isUsernameAndPasswordObject(
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

function isArrayOfUsernameAndPasswordObjects(
  value: unknown,
): value is { username: string; password: string }[] {
  if (!Array.isArray(value)) {
    return false
  }

  for (const element of value) {
    if (!isUsernameAndPasswordObject(element)) {
      return false
    }
  }

  return true
}

function hasCredentialsKeyWithStringValue(
  value: unknown,
): value is { credentials: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "credentials" in value &&
    typeof value.credentials === "string"
  )
}

function isStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) {
    return false
  }

  for (const element of value) {
    if (typeof element !== "string") {
      return false
    }
  }

  return true
}

/**
 * We want to return the requesting username as a context variable in
 * {@link AuthorizerResult.context}, for API Gateway access logs and parameter mapping. So if the
 * basic auth credentials secret is stored as pre-encoded base64 strings, we need to parse them to
 * get the username.
 */
function parseEncodedBasicAuthCredentials(
  encodedCredentials: string,
): ExpectedBasicAuthCredentials {
  let decodedCredentials: string
  try {
    decodedCredentials = Buffer.from(encodedCredentials, "base64").toString()
  } catch (e) {
    console.error(
      "Basic auth credentials secret could not be decoded as base64:",
      e,
    )
    throw new Error()
  }

  const usernameAndPassword = decodedCredentials.split(":", 2)
  if (usernameAndPassword.length !== 2) {
    console.error(
      "Basic auth credentials secret could not be decoded as 'username:password'",
    )
    throw new Error()
  }

  return {
    basicAuthHeader: `Basic ${encodedCredentials}`,
    username: usernameAndPassword[0],
  }
}

export function clearCache() {
  cachedTokenVerifier = undefined
  cachedBasicAuthCredentials = undefined
}
