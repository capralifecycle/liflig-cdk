module.exports = {
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  snapshotFormat: {
    printBasicPrototype: true,
    escapeString: true,
  },
  // NOTE: Workaround for https://github.com/jestjs/jest/issues/11956
  workerIdleMemoryLimit: "2GB",
}
