import {
  prepareManifestForSnapshot,
  prepareMetadataForSnapshot,
  prepareTemplateForSnapshot,
} from "../snapshots"

const hash64 = "a".repeat(64)
const otherHash64 = "b".repeat(64)

describe("prepareTemplateForSnapshot", () => {
  it("replaces 64-char asset content hashes", () => {
    const template = JSON.stringify({
      Resources: {
        MyResource: {
          Properties: {
            Code: {
              S3Key: `${hash64}.zip`,
            },
          },
        },
      },
    })

    const result = JSON.parse(prepareTemplateForSnapshot(template))
    expect(result.Resources.MyResource.Properties.Code.S3Key).toBe(
      "snapshot-value.zip",
    )
  })

  it("replaces CDK Pipelines short asset hash suffix", () => {
    const buildSpec = [
      "cdk-assets",
      "--path",
      "assembly/stack.assets.json",
      "--verbose",
      "publish",
      `"${hash64}:001112238813-eu-west-1-0e94f9de"`,
    ].join(" ")

    const template = JSON.stringify({
      Resources: {
        PublishAssets: {
          Properties: {
            Source: { BuildSpec: buildSpec },
          },
        },
      },
    })

    const result = JSON.parse(prepareTemplateForSnapshot(template))
    const resultBuildSpec =
      result.Resources.PublishAssets.Properties.Source.BuildSpec

    expect(resultBuildSpec).toContain(
      "snapshot-value:001112238813-eu-west-1-snapshot-value",
    )
    expect(resultBuildSpec).not.toMatch(/[0-9a-f]{8}"/)
  })

  it("replaces multiple short hash suffixes in the same string", () => {
    const value = [
      `${hash64}:001112238813-eu-west-1-aabbccdd`,
      `${otherHash64}:001112238813-us-east-1-11223344`,
    ].join(" ")

    const template = JSON.stringify({
      Resources: { R: { Properties: { Value: value } } },
    })

    const result = JSON.parse(prepareTemplateForSnapshot(template))
    const resultValue = result.Resources.R.Properties.Value

    expect(resultValue).toBe(
      "snapshot-value:001112238813-eu-west-1-snapshot-value snapshot-value:001112238813-us-east-1-snapshot-value",
    )
  })

  it("does not replace 8-char hex strings that are not pipeline asset suffixes", () => {
    const template = JSON.stringify({
      Resources: {
        R: {
          Properties: {
            SomeId: "aabbccdd",
            TagValue: "prefix-aabbccdd",
          },
        },
      },
    })

    const result = JSON.parse(prepareTemplateForSnapshot(template))
    expect(result.Resources.R.Properties.SomeId).toBe("aabbccdd")
    expect(result.Resources.R.Properties.TagValue).toBe("prefix-aabbccdd")
  })

  it("removes CDKMetadata resource", () => {
    const template = JSON.stringify({
      Resources: {
        CDKMetadata: { Type: "AWS::CDK::Metadata" },
        MyBucket: { Type: "AWS::S3::Bucket" },
      },
    })

    const result = JSON.parse(prepareTemplateForSnapshot(template))
    expect(result.Resources.CDKMetadata).toBeUndefined()
    expect(result.Resources.MyBucket).toBeDefined()
  })
})

describe("prepareMetadataForSnapshot", () => {
  it("removes trace entries", () => {
    const metadata = JSON.stringify({
      "/stack/Resource": [
        {
          type: "aws:cdk:logicalId",
          data: "MyResource",
          trace: ["at Object.<anonymous> (file.ts:1:1)"],
        },
      ],
    })

    const result = JSON.parse(prepareMetadataForSnapshot(metadata))
    expect(result["/stack/Resource"][0].trace).toBeUndefined()
    expect(result["/stack/Resource"][0].data).toBe("MyResource")
  })

  it("strips aws:cdk:asset entries", () => {
    const metadata = JSON.stringify({
      "/stack/Resource": [
        {
          type: "aws:cdk:asset",
          data: { path: "asset.abc123", packaging: "zip" },
        },
        {
          type: "aws:cdk:logicalId",
          data: "MyResource",
        },
      ],
    })

    const result = JSON.parse(prepareMetadataForSnapshot(metadata))
    expect(result["/stack/Resource"][0].type).toBe("aws:cdk:asset")
    expect(result["/stack/Resource"][0].data).toBe("snapshot-value")
    expect(result["/stack/Resource"][1].data).toBe("MyResource")
  })

  it("replaces 64-char asset hashes in strings", () => {
    const metadata = JSON.stringify({
      "/stack/Resource": [
        {
          type: "aws:cdk:logicalId",
          data: `Something${hash64}Else`,
        },
      ],
    })

    const result = JSON.parse(prepareMetadataForSnapshot(metadata))
    expect(result["/stack/Resource"][0].data).toBe(
      "Somethingsnapshot-valueElse",
    )
  })
})

describe("prepareManifestForSnapshot", () => {
  it("replaces CDK Pipelines short asset hash suffix in manifest strings", () => {
    const manifest = JSON.stringify({
      version: "30.0.0",
      artifacts: {
        stack: {
          properties: {
            templateFile: "stack.template.json",
            stackTemplateAssetObjectUrl: `s3://cdk-assets/${hash64}.json`,
          },
        },
      },
    })

    const result = JSON.parse(prepareManifestForSnapshot(manifest))
    expect(result.version).toBeUndefined()
    expect(result.artifacts.stack.properties.stackTemplateAssetObjectUrl).toBe(
      "s3://cdk-assets/snapshot-value.json",
    )
  })

  it("replaces short hash suffix in manifest string values", () => {
    const manifest = JSON.stringify({
      version: "30.0.0",
      artifacts: {
        stack: {
          properties: {
            value: `${hash64}:123456789012-eu-west-1-deadbeef`,
          },
        },
      },
    })

    const result = JSON.parse(prepareManifestForSnapshot(manifest))
    expect(result.artifacts.stack.properties.value).toBe(
      "snapshot-value:123456789012-eu-west-1-snapshot-value",
    )
  })
})
