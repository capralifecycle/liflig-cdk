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

export const handler = async (
  event: APIGatewayRequestAuthorizerEventV2,
): Promise<APIGatewaySimpleAuthorizerResult> => {
  const authHeader = event.headers?.authorization
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return { isAuthorized: false }
  }

  const expectedAuthHeaders = await getExpectedBasicAuthHeaders()

  for (const expectedHeader of expectedAuthHeaders) {
    if (authHeader === expectedHeader) {
      return { isAuthorized: true }
    }
  }

  return { isAuthorized: false }
}

/** Cache this value, so that subsequent lambda invocations don't have to refetch. */
let cachedBasicAuthHeaders: string[] | undefined = undefined

/**
 * Returns an array of allowed basic auth headers, to support credential secrets with multiple
 * values (see `BasicAuthAuthorizerProps` on the `ApiGateway` construct for more on this).
 */
async function getExpectedBasicAuthHeaders(): Promise<string[]> {
  if (cachedBasicAuthHeaders === undefined) {
    const secretName: string | undefined =
      process.env["CREDENTIALS_SECRET_NAME"]
    if (!secretName) {
      console.error("CREDENTIALS_SECRET_NAME env variable is not defined")
      throw new Error()
    }

    cachedBasicAuthHeaders = await getSecretAsBasicAuthHeaders(secretName)
  }

  return cachedBasicAuthHeaders
}

async function getSecretAsBasicAuthHeaders(
  secretName: string,
): Promise<string[]> {
  const secret = await getSecretValue(secretName)

  if (isSingleUsernameAndPassword(secret)) {
    const header =
      "Basic " +
      Buffer.from(`${secret.username}:${secret.password}`).toString("base64")
    return [header]
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
      return credentialsArray.map(
        (encodedCredential) => `Basic ${encodedCredential}`,
      )
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
    console.error(`Failed to parse secret '${secretName}' as JSON`, e)
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

export function clearCache() {
  cachedBasicAuthHeaders = undefined
}
