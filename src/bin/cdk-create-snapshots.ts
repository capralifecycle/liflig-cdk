import { createCloudAssemblySnapshot } from "../snapshots"

// In Node, first parameter is the third element.
const src = process.argv[2]
const dst = process.argv[3]

// eslint-disable-next-line @typescript-eslint/no-floating-promises
;(async () => {
  await createCloudAssemblySnapshot(src, dst)
})()
