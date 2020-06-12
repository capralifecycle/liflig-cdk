#!/usr/bin/env node
import { jenkinsfileCheckReferencedStacks } from "../jenkinsfile-check-referenced-stacks"

if (process.argv.length != 4) {
  console.error(
    `Syntax: ${process.argv[0]} ${process.argv[1]} <jenkinsfile> <manual-stacks-file>`,
  )
  process.exit(1)
}

// In Node, first parameter is the third element.
const jenkinsfile = process.argv[2]
const manualStacksFile = process.argv[3]

jenkinsfileCheckReferencedStacks(jenkinsfile, manualStacksFile).catch((e) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  console.error(e.stack || e.message || e)
  process.exitCode = 1
})
