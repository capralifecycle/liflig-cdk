import * as logs from "aws-cdk-lib/aws-logs"

/**
 * Common filter pattern used for JSON log-based error detection.
 */
export const jsonErrorFilterPattern = () =>
  logs.FilterPattern.any(
    logs.FilterPattern.stringValue("$.level", "=", "ERROR"),
    logs.FilterPattern.stringValue("$.level", "=", "FATAL"),
    logs.FilterPattern.stringValue(
      "$.requestInfo.status.code",
      "=",
      "INTERNAL_SERVER_ERROR",
    ),
  )
