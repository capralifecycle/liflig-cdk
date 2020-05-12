import * as cpy from "cpy"
import * as del from "del"
import * as fs from "fs"
import * as path from "path"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function removeTrace(data: any): any {
  if (data instanceof Array) {
    return data.map(removeTrace)
  }

  if (data === Object(data)) {
    return Object.fromEntries(
      Object.entries(data)
        .filter(([key]) => key !== "trace")
        .map(([key, value]) => [key, removeTrace(value)]),
    )
  }

  return data
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function removeRuntimeLibraries(data: any): any {
  const cp = {
    ...data,
    runtime: {
      ...data.runtime,
    },
  }

  delete cp.runtime.libraries
  return cp
}

function prepareManifestForSnapshot(content: string): string {
  const input = JSON.parse(content)
  const output = [
    // Remove the runtime version information so it don't conflict with CI
    // or other users generating the snapshots.
    removeRuntimeLibraries,
    // Remove the trace from manifest for now.
    removeTrace,
  ].reduce((acc, fn) => fn(acc), input)

  return JSON.stringify(output, undefined, "  ")
}

/**
 * Transform the Cloud Assembly manifest file so that it can be persisted
 * as a snapshot without causing invalidations for every synthesize.
 */
async function prepareManifestFileForSnapshot(file: string): Promise<void> {
  const result = prepareManifestForSnapshot(
    await fs.promises.readFile(file, "utf8"),
  )

  await fs.promises.writeFile(file, result)
}

/**
 * Convert a Cloud Assembly to a snapshot.
 */
export async function createCloudAssemblySnapshot(
  src: string,
  dst: string,
): Promise<void> {
  await cpy(src, dst)

  // Transform the manifest to be more snapshot friendly.
  await prepareManifestFileForSnapshot(path.join(dst, "manifest.json"))

  // The tree file doesn't give us much value as part of the snapshot.
  await del(path.join(dst, "tree.json"))

  // Remove asset contents for now.
  await del(path.join(dst, "asset.*"))
}
