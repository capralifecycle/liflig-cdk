/**
 * This lambda verifies authorization header against static basic auth credentials saved in Secret
 * Manager.
 *
 * Expects the following environment variables:
 * - CREDENTIALS_SECRET_NAME
 *   - Secret value should follow this format: `{"username":"<username>","password":"<password>"}`
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

  const expectedAuthHeader = await getExpectedAuthHeader()

  return { isAuthorized: authHeader === expectedAuthHeader }
}

/** Cache this value, so that subsequent lambda invocations don't have to refetch. */
let cachedAuthHeader: string | undefined = undefined

async function getExpectedAuthHeader(): Promise<string> {
  if (cachedAuthHeader === undefined) {
    const secretName: string | undefined =
      process.env["CREDENTIALS_SECRET_NAME"]
    if (!secretName) {
      console.error("CREDENTIALS_SECRET_NAME env variable is not defined")
      throw new Error()
    }

    cachedAuthHeader = await getSecretAsBasicAuthHeader(secretName)
  }

  return cachedAuthHeader
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
