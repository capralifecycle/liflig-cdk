import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  sanitizeManifest,
  sanitizeMetadata,
  sanitizeTemplate,
} from "../snapshots"

const hash64 = "a".repeat(64)
const otherHash64 = "b".repeat(64)

describe("sanitizeTemplate", () => {
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

    const result = JSON.parse(sanitizeTemplate(template))
    assert.strictEqual(
      result.Resources.MyResource.Properties.Code.S3Key,
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

    const result = JSON.parse(sanitizeTemplate(template))
    const resultBuildSpec =
      result.Resources.PublishAssets.Properties.Source.BuildSpec

    assert.ok(
      resultBuildSpec.includes(
        "snapshot-value:001112238813-eu-west-1-snapshot-value",
      ),
    )
    assert.doesNotMatch(resultBuildSpec, /[0-9a-f]{8}"/)
  })

  it("replaces multiple short hash suffixes in the same string", () => {
    const value = [
      `${hash64}:001112238813-eu-west-1-aabbccdd`,
      `${otherHash64}:001112238813-us-east-1-11223344`,
    ].join(" ")

    const template = JSON.stringify({
      Resources: { R: { Properties: { Value: value } } },
    })

    const result = JSON.parse(sanitizeTemplate(template))
    const resultValue = result.Resources.R.Properties.Value

    assert.strictEqual(
      resultValue,
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

    const result = JSON.parse(sanitizeTemplate(template))
    assert.strictEqual(result.Resources.R.Properties.SomeId, "aabbccdd")
    assert.strictEqual(
      result.Resources.R.Properties.TagValue,
      "prefix-aabbccdd",
    )
  })

  it("removes CDKMetadata resource", () => {
    const template = JSON.stringify({
      Resources: {
        CDKMetadata: { Type: "AWS::CDK::Metadata" },
        MyBucket: { Type: "AWS::S3::Bucket" },
      },
    })

    const result = JSON.parse(sanitizeTemplate(template))
    assert.strictEqual(result.Resources.CDKMetadata, undefined)
    assert.notStrictEqual(result.Resources.MyBucket, undefined)
  })
})

describe("sanitizeMetadata", () => {
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

    const result = JSON.parse(sanitizeMetadata(metadata))
    assert.strictEqual(result["/stack/Resource"][0].trace, undefined)
    assert.strictEqual(result["/stack/Resource"][0].data, "MyResource")
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

    const result = JSON.parse(sanitizeMetadata(metadata))
    assert.strictEqual(result["/stack/Resource"][0].type, "aws:cdk:asset")
    assert.strictEqual(result["/stack/Resource"][0].data, "snapshot-value")
    assert.strictEqual(result["/stack/Resource"][1].data, "MyResource")
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

    const result = JSON.parse(sanitizeMetadata(metadata))
    assert.strictEqual(
      result["/stack/Resource"][0].data,
      "Somethingsnapshot-valueElse",
    )
  })

  it("strips aws:cdk:creationStack entries", () => {
    const metadata = JSON.stringify({
      "/stack/Resource": [
        {
          type: "aws:cdk:logicalId",
          data: "MyResource",
        },
        {
          type: "aws:cdk:creationStack",
          data: [
            "<anonymous> (/Users/someone/dev/proj/app.ts:31:1)",
            "...node internals...",
          ],
        },
      ],
    })

    const result = JSON.parse(sanitizeMetadata(metadata))
    assert.strictEqual(result["/stack/Resource"].length, 1)
    assert.strictEqual(result["/stack/Resource"][0].type, "aws:cdk:logicalId")
  })

  it("drops construct paths whose only metadata was a creation stack", () => {
    const metadata = JSON.stringify({
      "/stack/CreationStackOnly": [
        {
          type: "aws:cdk:creationStack",
          data: ["<anonymous> (/Users/someone/dev/proj/app.ts:1:1)"],
        },
      ],
      "/stack/Real": [
        {
          type: "aws:cdk:logicalId",
          data: "Real",
        },
      ],
    })

    const result = JSON.parse(sanitizeMetadata(metadata))
    assert.strictEqual(result["/stack/CreationStackOnly"], undefined)
    assert.notStrictEqual(result["/stack/Real"], undefined)
  })
})

describe("sanitizeManifest", () => {
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

    const result = JSON.parse(sanitizeManifest(manifest))
    assert.strictEqual(result.version, undefined)
    assert.strictEqual(
      result.artifacts.stack.properties.stackTemplateAssetObjectUrl,
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

    const result = JSON.parse(sanitizeManifest(manifest))
    assert.strictEqual(
      result.artifacts.stack.properties.value,
      "snapshot-value:123456789012-eu-west-1-snapshot-value",
    )
  })
})
