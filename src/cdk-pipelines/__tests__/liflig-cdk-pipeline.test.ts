import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { App, Stack } from "aws-cdk-lib"
import { Bucket } from "aws-cdk-lib/aws-s3"
import { LifligCdkPipeline } from "../liflig-cdk-pipeline"

function createPipeline(
  synthNodeVersion: string,
  sourceType: "cdk-source" | "cloud-assembly" = "cdk-source",
): LifligCdkPipeline {
  const app = new App()
  const stack = new Stack(app, "PipelineStack")
  return new LifligCdkPipeline(stack, "Pipeline", {
    artifactsBucket: new Bucket(stack, "ArtifactsBucket"),
    pipelineName: "test-pipeline",
    sourceType,
    synthNodeVersion,
  })
}

describe("LifligCdkPipeline synthNodeVersion", () => {
  for (const version of ["24", "24.x", "24.22", "24.22.1", "26"]) {
    test(`accepts ${version}`, () => {
      assert.doesNotThrow(() => createPipeline(version))
    })
  }

  for (const version of ["22", "22.x", "18.20.4", "latest", "24abc", ""]) {
    test(`rejects ${JSON.stringify(version)}`, () => {
      assert.throws(() => createPipeline(version), /synthNodeVersion/)
    })
  }

  test("ignores synthNodeVersion for cloud-assembly", () => {
    assert.doesNotThrow(() => createPipeline("22", "cloud-assembly"))
  })
})
