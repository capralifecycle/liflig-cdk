import { jenkinsfileCheckReferencedStacks } from "../jenkinsfile-check-referenced-stacks"

describe("jenkinsfileCheckReferencedStacks", () => {
  it("should not fail", async () => {
    await jenkinsfileCheckReferencedStacks(
      "Jenkinsfile",
      "examples/manual-stacks.txt",
    )
  }, 30000)
})
