import { App, Stack } from "@aws-cdk/core"
import "jest-cdk-snapshot"
import { getGriidArtefactBucket } from "../"

test("getGriidArtefactBucket", () => {
  const app = new App()
  const stack = new Stack(app, "Stack", {
    env: {
      region: "eu-west-1",
    },
  })

  getGriidArtefactBucket(stack)
  expect(stack).toMatchCdkSnapshot()
})
