import * as fs from "node:fs"
import * as path from "node:path"

function removeVersion(data: any): any {
  const cp = {
    ...data,
  }

  delete cp.version
  return cp
}

function removeTrace(data: any): any {
  if (Array.isArray(data)) {
    return data.map(removeTrace)
  }

  if (data === Object(data)) {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>)
        .filter(([key]) => key !== "trace")
        .map(([key, value]) => [key, removeTrace(value)]),
    )
  }

  return data
}

function removeRuntimeLibraries(data: any): any {
  const cp = {
    ...data,
  }

  if (data.runtime) {
    cp.runtime = {
      ...data.runtime,
    }

    delete cp.runtime.libraries
  }

  return cp
}

const currentVersionRegex = /^(.+CurrentVersion[0-9A-F]{8})[0-9a-f]{32}$/

// Matches 64-char hex strings used as CDK asset content hashes.
const assetContentHashRegex = /[0-9a-f]{64}/g

// Matches the short 8-char hash suffix in CDK Pipelines asset identifiers,
// e.g. "snapshot-value:123456789012-eu-west-1-0e94f9de".
const pipelinesAssetIdSuffixRegex =
  /(snapshot-value:\d+-[a-z0-9-]+-)[0-9a-f]{8}/g

/**
 * Match a resource created by `lambda.Function.currentVersion`, which
 * will include the asset hash as part of the reousrce name and return
 * a snapshot-friendly version of it if found.
 */
function rewriteCurrentVersionIfFound(value: string): string | null {
  const match = currentVersionRegex.exec(value)
  return match ? `${match[1]}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` : null
}

function removeAssetDetailsFromTemplate(data: any): any {
  if (Array.isArray(data)) {
    return data.map(removeAssetDetailsFromTemplate)
  }

  if (data === Object(data)) {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>)
        .map(([key, value]) => {
          const newCurrentVersion = rewriteCurrentVersionIfFound(key)
          if (newCurrentVersion) {
            return [newCurrentVersion, removeAssetDetailsFromTemplate(value)]
          }
          if (key.includes("AssetParameter")) {
            return null
          }
          if (
            key === "Ref" &&
            typeof value === "string" &&
            value.includes("AssetParameters")
          ) {
            return [key, "snapshot-value"]
          }
          if (
            key === "aws:asset:path" &&
            typeof value === "string" &&
            /asset\.[0-9a-f]{64}/.test(value)
          ) {
            return [key, "asset.snapshot-value"]
          }
          return [key, removeAssetDetailsFromTemplate(value)]
        })
        .filter((it): it is [] => it != null),
    )
  }

  if (typeof data === "string") {
    const newCurrentVersion = rewriteCurrentVersionIfFound(data)
    if (newCurrentVersion) {
      return newCurrentVersion
    }

    return data
      .replace(assetContentHashRegex, "snapshot-value")
      .replace(pipelinesAssetIdSuffixRegex, "$1snapshot-value")
  }

  return data
}

function removeAssetDetailsFromManifest(data: any): any {
  if (Array.isArray(data)) {
    return data.map(removeAssetDetailsFromManifest)
  }

  if (data === Object(data)) {
    // aws:cdk:asset in metadata
    if (data.type === "aws:cdk:asset" && "data" in data) {
      return {
        ...data,
        data: "snapshot-value",
      }
    }

    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>)
        .map(([key, value]) => {
          if (key.includes("AssetParameters")) {
            return null
          }
          return [key, removeAssetDetailsFromManifest(value)]
        })
        .filter((it): it is [] => it != null),
    )
  }

  if (typeof data === "string") {
    const newCurrentVersion = rewriteCurrentVersionIfFound(data)
    if (newCurrentVersion) {
      return newCurrentVersion
    }

    return data
      .replace(assetContentHashRegex, "snapshot-value")
      .replace(pipelinesAssetIdSuffixRegex, "$1snapshot-value")
  }

  return data
}

/**
 * Remove the CDKMetadata resources that is part of the synthesized
 * template since CDK 1.63.0.
 */
function removeCdkMetadataResourceFromTemplate(data: any): any {
  const cp = {
    ...data,
    Resources: {
      ...data.Resources,
    },
  }

  delete cp.Resources.CDKMetadata
  return cp
}

export function prepareManifestForSnapshot(content: string): string {
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

export function prepareTemplateForSnapshot(content: string): string {
  const input = JSON.parse(content)
  const output = [
    removeCdkMetadataResourceFromTemplate,
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
  const destAbs = path.join(process.cwd(), dst)
  const srcAbs = path.join(process.cwd(), src)

  // Copy all files from src (cdk.out) to dest (__snapshots__)
  fs.cpSync(srcAbs, destAbs, { recursive: true })

  const expandGlob = (pattern: string, cwd: string): string[] => {
    return fs.globSync(pattern, { cwd }).map((p) => path.join(cwd, p))
  }

  const filesToDelete = [
    // Don't keep track of manifest version.
    "**/cdk.out",

    // The tree file doesn't give us much value as part of the snapshot.
    "**/tree.json",

    // Remove asset contents for now.
    "**/asset.*",

    // Remove asset configs so we don't have to update snapshots for asset changes.
    "**/*.assets.json",

    // Remove graphviz files generated when using CDK Pipelines
    "**/*.dot",
  ].flatMap((g) => expandGlob(g, destAbs))

  await Promise.all(
    filesToDelete.map((p) =>
      fs.promises.rm(p, {
        recursive: true,
        force: true,
      }),
    ),
  )

  const manifestFiles = [
    // Transform the manifest to be more snapshot friendly.
    "**/manifest.json",
  ].flatMap((g) => expandGlob(g, destAbs))

  for (const file of manifestFiles) {
    await prepareManifestFileForSnapshot(file)
  }

  const templateFiles = [
    // Transform all templates.
    "**/*.template.json",
  ].flatMap((g) => expandGlob(g, destAbs))

  for (const file of templateFiles) {
    await prepareTemplateFileForSnapshot(file)
  }
}
