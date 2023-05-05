module.exports = {
  testMatch: ["**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
  },
  snapshotFormat: {
    printBasicPrototype: true,
    escapeString: true,
  },
}
