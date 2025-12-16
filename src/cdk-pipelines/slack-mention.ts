/**
 * Slack mention formatter with validation per Slack API format:
 * https://docs.slack.dev/messaging/formatting-message-text/
 *
 * Supported mention types:
 * - Special mentions: @here, @channel, @everyone
 * - User IDs: U or W prefix + alphanumeric (e.g., U024BE7LH, W024BE7LH)
 * - User group IDs: S prefix + alphanumeric (e.g., SAZ94GDB8)
 *
 * Usage:
 *   SlackMention.format(['@here', 'U024BE7LH', 'SAZ94GDB8'])
 */
export class SlackMention {
  private static readonly SPECIAL_MENTIONS = [
    "@here",
    "@channel",
    "@everyone",
  ] as const
  private static readonly USER_PATTERN = /^[UW][A-Z0-9]+$/
  private static readonly USER_GROUP_PATTERN = /^S[A-Z0-9]+$/

  /**
   * Format an array of mentions into a single Slack-formatted string.
   * @param mentions Array of mention strings
   */
  static format(mentions: string[]): string {
    return mentions.map((m) => SlackMention.formatMention(m)).join(" ")
  }

  /**
   * Format a mention string for Slack API message format.
   * Validates format and converts to proper Slack markup:
   *   '@here' -> '<!here>'
   *   'U1234567890' -> '<@U1234567890>'
   *   'S1234567890' -> '<!subteam^S1234567890>'
   *
   * @param mention Mention string (e.g., '@here', 'U1234567890', 'S1234567890')
   * @throws if mention format is invalid
   */
  static formatMention(mention: string): string {
    if (mention.startsWith("@")) {
      return SlackMention.formatSpecialMention(mention)
    }
    if (mention.startsWith("U") || mention.startsWith("W")) {
      return SlackMention.formatUser(mention)
    }
    if (mention.startsWith("S")) {
      return SlackMention.formatUserGroup(mention)
    }
    throw new Error(`Unknown Slack mention format: ${mention}`)
  }

  private static formatSpecialMention(mention: string): string {
    if (
      !SlackMention.SPECIAL_MENTIONS.includes(
        mention as "@here" | "@channel" | "@everyone",
      )
    ) {
      throw new Error(`Invalid special mention: ${mention}`)
    }
    return `<!${mention.substring(1)}>`
  }

  private static formatUser(mention: string): string {
    if (!SlackMention.USER_PATTERN.test(mention)) {
      throw new Error(`Invalid user ID: ${mention}`)
    }
    return `<@${mention}>`
  }

  private static formatUserGroup(mention: string): string {
    if (!SlackMention.USER_GROUP_PATTERN.test(mention)) {
      throw new Error(`Invalid user group ID: ${mention}`)
    }
    return `<!subteam^${mention}>`
  }
}
