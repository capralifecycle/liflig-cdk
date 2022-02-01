import { App, Stack } from "aws-cdk-lib"
import "jest-cdk-snapshot"
import { getGriidArtefactBucket, getGriidCiRole } from "../"

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

test("getGriidCiRole", () => {
  const app = new App()
  const stack = new Stack(app, "Stack", {
    env: {
      region: "eu-west-1",
    },
  })

  const role = getGriidCiRole(stack)
  expect(role.roleName).toBe("CIExternalAccessRole")
})
