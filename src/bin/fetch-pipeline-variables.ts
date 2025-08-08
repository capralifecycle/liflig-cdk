#!/usr/bin/env node
import * as fs from "node:fs"
import {
  GetParametersByPathCommand,
  type GetParametersByPathResult,
  SSMClient,
} from "@aws-sdk/client-ssm"

/**
 * Read all variables from SSM Parameter Store under a given prefix.
 */
export async function getVariablesFromParameterStore(
  prefix: string,
): Promise<Record<string, string>> {
  const ssm = new SSMClient({})

  const parameters: Record<string, string> = {}

  let nextToken: string | undefined

  do {
    const result: GetParametersByPathResult = await ssm.send(
      new GetParametersByPathCommand({
        Path: prefix,
        NextToken: nextToken,
      }),
    )

    for (const parameter of result.Parameters!) {
      const name = parameter.Name!.slice(prefix.length)
      parameters[name] = parameter.Value!
    }

    nextToken = result.NextToken
  } while (nextToken != null)

  return parameters
}
let namespace: string

// If no arguments are given, use some sensible defaults.
if (process.argv.length === 2) {
  namespace = "default"
} else {
  // In Node, first parameter is the third element.
  namespace = process.argv[2]
}

async function main(namespace: string) {
  const variables = {
    // Special variable that can be used when reading variables
    // to ensure it is not stale. In the pipeline, variables
    // will never be stale, but locally it can be.
    variablesTimestamp: new Date().toISOString(),
    ...(await getVariablesFromParameterStore(
      `/liflig-cdk/${namespace}/pipeline-variables/`,
    )),
  }

  const result = JSON.stringify(variables, undefined, "  ")

  fs.writeFileSync("variables.json", result)
  console.log("Retrieved and saved to variables.json:")
  console.log(result.replace(/^/gm, "  "))
}

main(namespace).catch((e) => {
  console.error(e.stack || e.message || e)
  process.exitCode = 1
})
