/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import * as cpy from "cpy"
import * as del from "del"
import * as fs from "fs"
import * as path from "path"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function removeVersion(data: any): any {
  const cp = {
    ...data,
  }

  delete cp.version
  return cp
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function removeAssetDetailsFromTemplate(data: any): any {
  if (data instanceof Array) {
    return data.map(removeAssetDetailsFromTemplate)
  }

  if (data === Object(data)) {
    return Object.fromEntries(
      Object.entries(data)
        .map(([key, value]) => {
          if (key.includes("AssetParameter")) {
            return null
          } else if (
            key === "Ref" &&
            typeof value === "string" &&
            value.includes("AssetParameters")
          ) {
            return [key, "snapshot-value"]
          } else if (
            key === "aws:asset:path" &&
            typeof value === "string" &&
            value.startsWith("asset.")
          ) {
            return [key, "asset.snapshot-value"]
          } else {
            return [key, removeAssetDetailsFromTemplate(value)]
          }
        })
        .filter((it): it is [] => it != null),
    )
  }

  return data
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function removeAssetDetailsFromManifest(data: any): any {
  if (data instanceof Array) {
    return data.map(removeAssetDetailsFromManifest)
  }

  if (data === Object(data)) {
    // aws:cdk:asset in metadata
    if (data["type"] === "aws:cdk:asset" && "data" in data) {
      return {
        ...data,
        data: "snapshot-value",
      }
    }

    return Object.fromEntries(
      Object.entries(data)
        .map(([key, value]) => {
          if (key.includes("AssetParameters")) {
            return null
          } else {
            return [key, removeAssetDetailsFromManifest(value)]
          }
        })
        .filter((it): it is [] => it != null),
    )
  }

  return data
}

function prepareManifestForSnapshot(content: string): string {
  const input = JSON.parse(content)
  const output = [
    removeVersion,
    // Remove the runtime version information so it don't conflict with CI
    // or other users generating the snapshots.
    removeRuntimeLibraries,
    // Remove the trace from manifest for now.
    removeTrace,
    // Avoid details (hashes) from assets.
    removeAssetDetailsFromManifest,
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

function prepareTemplateForSnapshot(content: string): string {
  const input = JSON.parse(content)
  const output = [
    // Avoid details (hashes) from assets.
    removeAssetDetailsFromTemplate,
  ].reduce((acc, fn) => fn(acc), input)

  return JSON.stringify(output, undefined, "  ")
}

/**
 * Transform a Cloud Assembly template file so that it can be persisted
 * as a snapshot without causing invalidations for minor changes.
 */
async function prepareTemplateFileForSnapshot(file: string): Promise<void> {
  const result = prepareTemplateForSnapshot(
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
  await cpy(".", path.join(process.cwd(), dst), {
    parents: true,
    cwd: path.join(process.cwd(), src),
  })

  // Transform the manifest to be more snapshot friendly.
  await prepareManifestFileForSnapshot(path.join(dst, "manifest.json"))

  // Don't keep track of manifest version.
  await del(path.join(dst, "cdk.out"))

  // The tree file doesn't give us much value as part of the snapshot.
  await del(path.join(dst, "tree.json"))

  // Remove asset contents for now.
  await del(path.join(dst, "asset.*"))

  // Transform all templates.
  for (const file of fs.readdirSync(dst, "utf-8")) {
    if (file.endsWith("template.json")) {
      await prepareTemplateFileForSnapshot(path.join(dst, file))
    }
  }
}
