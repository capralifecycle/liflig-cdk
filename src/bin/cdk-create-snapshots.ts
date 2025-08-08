#!/usr/bin/env node
import { createCloudAssemblySnapshot } from "../snapshots.js"

let src: string
let dst: string

// If no arguments are given, use some sensible defaults.
if (process.argv.length === 2) {
  src = "cdk.out"
  dst = "__snapshots__"
} else {
  // In Node, first parameter is the third element.
  src = process.argv[2]
  dst = process.argv[3]
}

createCloudAssemblySnapshot(src, dst).catch((e) => {
  console.error(e.stack || e.message || e)
  process.exitCode = 1
})
