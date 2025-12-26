import { SlackMention } from "../slack-notification"

describe("SlackMention.formatMention", () => {
  describe("valid cases", () => {
    const validCases = [
      // Special mentions
      { mention: "@here", expected: "<!here>" },
      { mention: "@channel", expected: "<!channel>" },
      { mention: "@everyone", expected: "<!everyone>" },
      // User mentions (U prefix)
      { mention: "U1234567890", expected: "<@U1234567890>" },
      { mention: "U0", expected: "<@U0>" },
      { mention: "UABC123XYZ", expected: "<@UABC123XYZ>" },
      // Workspace User mentions (W prefix)
      { mention: "WABCDEFGHIJ", expected: "<@WABCDEFGHIJ>" },
      { mention: "W123", expected: "<@W123>" },
      // User group mentions
      { mention: "S1234567890", expected: "<!subteam^S1234567890>" },
      { mention: "SABCDEFGHIJ", expected: "<!subteam^SABCDEFGHIJ>" },
      { mention: "S0", expected: "<!subteam^S0>" },
    ]
    test.each(validCases)("formats $mention to $expected", ({
      mention,
      expected,
    }) => {
      expect(SlackMention.formatMention(mention)).toBe(expected)
    })
  })

  describe("invalid cases", () => {
    const invalidCases = [
      { mention: "U", desc: "user ID missing alphanumeric suffix" },
      { mention: "W", desc: "workspace user ID missing alphanumeric suffix" },
      { mention: "S", desc: "user group ID missing alphanumeric suffix" },
      { mention: "@invalid", desc: "unknown special mention" },
      { mention: "INVALID", desc: "unknown prefix" },
      { mention: "invalid", desc: "unknown prefix" },
      { mention: "random", desc: "unknown prefix" },
      { mention: "u1234567890", desc: "lowercase user prefix" },
      { mention: "w1234567890", desc: "lowercase workspace prefix" },
      { mention: "s1234567890", desc: "lowercase group prefix" },
      { mention: "1234567890", desc: "no prefix" },
      { mention: "A1234567890", desc: "unknown prefix" },
      { mention: "V1234567890", desc: "unknown prefix" },
    ]
    test.each(invalidCases)("throws on $desc: $mention", ({ mention }) => {
      expect(() => SlackMention.formatMention(mention)).toThrow()
    })
  })
})
