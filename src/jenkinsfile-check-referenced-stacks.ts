import * as assert from "assert"
import * as execa from "execa"
import * as fs from "fs"

async function getAllStacks() {
  const cdkPath = "./node_modules/.bin/cdk"
  if (!fs.existsSync(cdkPath)) {
    throw new Error(`Did not find expected ${cdkPath}`)
  }

  return (await execa(cdkPath, ["ls"])).stdout.split("\n")
}

async function findStacksInJenkinsfile(
  path: string,
  allStacks: string[],
): Promise<string[]> {
  const data = await fs.promises.readFile(path, "utf-8")
  return allStacks.filter((stackName) => data.includes(stackName))
}

async function getManualStacks(path: string): Promise<string[]> {
  return (await fs.promises.readFile(path, "utf-8"))
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"))
}

function verifyStacks({
  allStacks,
  automatedStacks,
  listedAsManualStacks,
}: {
  allStacks: string[]
  automatedStacks: string[]
  listedAsManualStacks: string[]
}): void {
  const stacksNotAutomated = allStacks.filter(
    (it) => !automatedStacks.includes(it),
  )

  assert.deepStrictEqual(listedAsManualStacks, stacksNotAutomated)
}

/**
 * Do a best effort check that we have referenced all stacks in
 * either Jenkinsfile or as lines in a specified text file to be
 * excluded from Jenkinsfile.
 *
 * The check in Jenkinsfile might give false positives, e.g. if we
 * comment out lines in Jenkinsfile, but the mechanism covers the
 * normal use case where only the stacks automated are found.
 *
 * The intention is to help us reference all the stacks in Jenkinsfile
 * for automation or explicitly mark the stack as not automated, so
 * that we do not add stacks that fall out of the automation without
 * paying notice.
 */
export async function jenkinsfileCheckReferencedStacks(
  jenkinsfilePath: string,
  manualStacksFilePath: string,
): Promise<void> {
  const allStacks = await getAllStacks()

  verifyStacks({
    allStacks,
    automatedStacks: await findStacksInJenkinsfile(jenkinsfilePath, allStacks),
    listedAsManualStacks: await getManualStacks(manualStacksFilePath),
  })
}
