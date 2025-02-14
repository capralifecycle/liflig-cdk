/**
 * This lambda verifies authorization header against static basic auth credentials saved in Secret
 * Manager.
 *
 * Expects the following environment variables:
 * - CREDENTIALS_SECRET_NAME
 *   - Secret value should follow this format: `{"username":"<username>","password":"<password>"}`.
 *     A different format with an array of pre-encoded credentials is also supported - see docs for
 *     the `BasicAuthAuthorizerProps` on the `ApiGateway` construct.
 */

import type {
  APIGatewayRequestAuthorizerEventV2,
  APIGatewaySimpleAuthorizerResult,
} from "aws-lambda"
import { SecretsManager } from "@aws-sdk/client-secrets-manager"

type AuthorizerResult = APIGatewaySimpleAuthorizerResult & {
  /**
   * Returning a context object from our authorizer allows our API Gateway to access these variables
   * via `${context.authorizer.<property>}`.
   * https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-parameter-mapping.html
   */
  context?: {
    /**
     * If the request's credentials are verified, we return the username that was used in this
     * context variable (named `authorizer.username`). We use this to include the requesting user in
     * the API Gateway access logs (see `defaultAccessLogFormat` in our `ApiGateway` construct). You
     * can also use this when mapping parameters to the backend integration (see
     * `AlbIntegrationProps.mapParameters` on the `ApiGateway` construct).
     */
    username: string
  }
}

export const handler = async (
  event: APIGatewayRequestAuthorizerEventV2,
): Promise<AuthorizerResult> => {
  const authHeader = event.headers?.authorization
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return { isAuthorized: false }
  }

  const expectedCredentials = await getExpectedBasicAuthCredentials()

  for (const expected of expectedCredentials) {
    if (authHeader === expected.basicAuthHeader) {
      return {
        isAuthorized: true,
        context: {
          username: expected.username,
        },
      }
    }
  }

  return { isAuthorized: false }
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
  ExpectedBasicAuthCredentials[]
> {
  if (cachedBasicAuthCredentials === undefined) {
    const secretName: string | undefined =
      process.env["CREDENTIALS_SECRET_NAME"]
    if (!secretName) {
      console.error("CREDENTIALS_SECRET_NAME env variable is not defined")
      throw new Error()
    }

    cachedBasicAuthCredentials = await getBasicAuthCredentialsSecret(secretName)
  }

  return cachedBasicAuthCredentials
}

async function getBasicAuthCredentialsSecret(
  secretName: string,
): Promise<ExpectedBasicAuthCredentials[]> {
  const secret = await getSecretValue(secretName)

  if (isSingleUsernameAndPassword(secret)) {
    const header =
      "Basic " +
      Buffer.from(`${secret.username}:${secret.password}`).toString("base64")
    return [{ basicAuthHeader: header, username: secret.username }]
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

    if (isStringArray(credentialsArray)) {
      return credentialsArray.map(parseEncodedBasicAuthCredentials)
    }
  }

  console.error(
    `Basic auth credentials secret did not follow any expected format (secret name: '${secretName}')`,
  )
  throw new Error()
}

/** For overriding dependency creation in tests. */
export const dependencies = {
  createSecretsManager: () => new SecretsManager(),
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

function isSingleUsernameAndPassword(
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
  cachedBasicAuthCredentials = undefined
}
