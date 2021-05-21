import { SSM } from "aws-sdk"
import * as fs from "fs"
import * as path from "path"
import * as process from "process"
import { isSnapshot } from ".."

let variables: Record<string, string | undefined> | undefined = undefined

/**
 * Get a value from "variables.json" in the current working directory.
 *
 * The name must exist or an error will be thrown.
 *
 * To be used with sourceType "cdk-source" in LifligCdkPipeline.
 */
export function getVariable(name: string): string {
  if (isSnapshot) {
    return "snapshot-value"
  }

  if (variables == null) {
    const variablesFile = path.join(process.cwd(), "variables.json")

    if (!fs.existsSync(variablesFile)) {
      throw new Error("variables.json not found")
    }

    variables = JSON.parse(fs.readFileSync(variablesFile, "utf-8")) as Record<
      string,
      string | undefined
    >
  }

  const value = variables[name]

  if (value == null) {
    throw new Error(`Variable ${name} not found`)
  }

  return value
}

/**
 * Read all variables from SSM Parameter Store under a given prefix.
 */
export async function getVariablesFromParameterStore(
  prefix: string,
): Promise<Record<string, string>> {
  const ssm = new SSM()

  const parameters: Record<string, string> = {}

  let nextToken: string | undefined = undefined
  do {
    const result: SSM.GetParametersByPathResult = await ssm
      .getParametersByPath({
        Path: prefix,
        NextToken: nextToken,
      })
      .promise()

    for (const parameter of result.Parameters!) {
      const name = parameter.Name!.slice(prefix.length)
      parameters[name] = parameter.Value!
    }

    nextToken = result.NextToken
  } while (nextToken != null)

  return parameters
}
