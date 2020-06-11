#!/usr/bin/env node
import { createCloudAssemblySnapshot } from "../snapshots"

// In Node, first parameter is the third element.
const src = process.argv[2]
const dst = process.argv[3]

createCloudAssemblySnapshot(src, dst).catch((e) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  console.error(e.stack || e.message || e)
  process.exitCode = 1
})
