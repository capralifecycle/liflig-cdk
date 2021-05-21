#!/usr/bin/env node
import * as fs from "fs"
import { getVariablesFromParameterStore } from "../cdk-pipelines/variables"

let namespace: string

// If no arguments are given, use some sensible defaults.
if (process.argv.length == 2) {
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  console.error(e.stack || e.message || e)
  process.exitCode = 1
})
