import { overlaps, parseBackupWindow, parseMaintenanceWindow } from "../windows"

describe("parseMaintenanceWindow", () => {
  const validCases: Array<{ input: string; description: string }> = [
    { input: "sun:03:00-sun:04:00", description: "same-day 1h window" },
    { input: "mon:00:00-mon:00:30", description: "minimum 30-min window" },
    {
      input: "fri:23:30-sat:00:30",
      description: "spans midnight (forward-ordered)",
    },
    {
      input: "sun:23:00-mon:02:00",
      description: "week-boundary wraparound (deferred)",
    },
    { input: "mon:00:00-sun:23:30", description: "spans most of the week" },
    {
      input: "Thu:03:00-Thu:04:00",
      description: "capitalized day (AWS accepts this)",
    },
    { input: "SUN:03:00-sun:04:00", description: "mixed case across ends" },
  ]

  test.each(validCases)("accepts $description ($input)", ({ input }) => {
    expect(() => parseMaintenanceWindow(input)).not.toThrow()
  })

  const invalidCases: Array<{
    input: string
    description: string
    messageMatches: RegExp
  }> = [
    {
      input: "sun 03:00-sun 04:00",
      description: "space instead of colon",
      messageMatches: /Expected format/,
    },
    {
      input: "sum:03:00-sun:04:00",
      description: "unknown day abbreviation",
      messageMatches: /Expected format/,
    },
    {
      input: "sun:3:00-sun:04:00",
      description: "single-digit hour",
      messageMatches: /Expected format/,
    },
    {
      input: "sun:03:00-sun:04:00:00",
      description: "extra component",
      messageMatches: /Expected format/,
    },
    {
      input: "",
      description: "empty string",
      messageMatches: /Expected format/,
    },
    {
      input: "sun:25:00-sun:26:00",
      description: "hour out of range",
      messageMatches: /hour must be 0-23/,
    },
    {
      input: "sun:03:60-sun:04:00",
      description: "minute out of range",
      messageMatches: /minute must be 0-59/,
    },
    {
      input: "sun:03:00-sun:03:00",
      description: "zero-length window",
      messageMatches: /start and end are equal/,
    },
    {
      input: "sun:03:00-sun:03:15",
      description: "under 30-min minimum (forward)",
      messageMatches: /minimum is 30/,
    },
  ]

  test.each(invalidCases)("rejects $description ($input)", ({
    input,
    messageMatches,
  }) => {
    expect(() => parseMaintenanceWindow(input)).toThrow(messageMatches)
  })
})

describe("parseBackupWindow", () => {
  const validCases: Array<{ input: string; description: string }> = [
    { input: "01:00-02:00", description: "same-day 1h window" },
    { input: "00:00-00:30", description: "minimum 30-min window" },
    { input: "23:00-01:00", description: "cross-midnight (not rejected)" },
    { input: "23:59-00:00", description: "end before start (deferred to AWS)" },
  ]

  test.each(validCases)("accepts $description ($input)", ({ input }) => {
    expect(() => parseBackupWindow(input)).not.toThrow()
  })

  const invalidCases: Array<{
    input: string
    description: string
    messageMatches: RegExp
  }> = [
    {
      input: "1:00-2:00",
      description: "single-digit hour",
      messageMatches: /Expected format/,
    },
    {
      input: "01:00 - 02:00",
      description: "spaces",
      messageMatches: /Expected format/,
    },
    {
      input: "sun:01:00-sun:02:00",
      description: "maintenance-style input",
      messageMatches: /Expected format/,
    },
    {
      input: "",
      description: "empty string",
      messageMatches: /Expected format/,
    },
    {
      input: "24:00-25:00",
      description: "hour out of range",
      messageMatches: /hour must be 0-23/,
    },
    {
      input: "01:60-02:00",
      description: "minute out of range",
      messageMatches: /minute must be 0-59/,
    },
    {
      input: "02:00-02:00",
      description: "zero-length window",
      messageMatches: /start and end are equal/,
    },
    {
      input: "01:00-01:15",
      description: "under 30-min minimum (forward)",
      messageMatches: /minimum is 30/,
    },
  ]

  test.each(invalidCases)("rejects $description ($input)", ({
    input,
    messageMatches,
  }) => {
    expect(() => parseBackupWindow(input)).toThrow(messageMatches)
  })
})

describe("overlaps", () => {
  const cases: Array<{
    description: string
    maintenance: string
    backup: string
    expected: boolean
  }> = [
    {
      description: "backup contained in maintenance same day",
      maintenance: "sun:02:00-sun:06:00",
      backup: "03:00-04:00",
      expected: true,
    },
    {
      description: "backup partially overlaps maintenance start",
      maintenance: "sun:03:00-sun:04:00",
      backup: "02:30-03:30",
      expected: true,
    },
    {
      description: "backup partially overlaps maintenance end",
      maintenance: "sun:03:00-sun:04:00",
      backup: "03:45-04:30",
      expected: true,
    },
    {
      description: "backup disjoint on same day",
      maintenance: "sun:03:00-sun:04:00",
      backup: "05:00-06:00",
      expected: false,
    },
    {
      description: "backup touches maintenance start (half-open, no overlap)",
      maintenance: "sun:03:00-sun:04:00",
      backup: "02:00-03:00",
      expected: false,
    },
    {
      description: "backup touches maintenance end (half-open, no overlap)",
      maintenance: "sun:03:00-sun:04:00",
      backup: "04:00-05:00",
      expected: false,
    },
    {
      description: "backup overlaps on a different day (daily recurrence)",
      maintenance: "wed:03:30-wed:04:00",
      backup: "03:45-04:15",
      expected: true,
    },
    {
      description: "backup disjoint across all days",
      maintenance: "wed:10:00-wed:11:00",
      backup: "03:00-04:00",
      expected: false,
    },
    {
      description: "maintenance spans midnight, backup overlaps on end day",
      maintenance: "fri:23:30-sat:00:30",
      backup: "00:00-00:45",
      expected: true,
    },
    {
      description: "maintenance spans midnight, backup disjoint on both days",
      maintenance: "fri:23:30-sat:00:30",
      backup: "03:00-04:00",
      expected: false,
    },
    {
      description: "maintenance wraparound treated as non-overlap (deferred)",
      maintenance: "sat:23:30-sat:00:30",
      backup: "23:30-00:30",
      expected: false,
    },
    {
      description: "backup wraparound treated as non-overlap (deferred)",
      maintenance: "sun:00:00-sun:01:00",
      backup: "23:00-00:30",
      expected: false,
    },
  ]

  test.each(cases)("$description", ({ maintenance, backup, expected }) => {
    const mw = parseMaintenanceWindow(maintenance)
    const bw = parseBackupWindow(backup)
    expect(overlaps(mw, bw)).toBe(expected)
  })
})
