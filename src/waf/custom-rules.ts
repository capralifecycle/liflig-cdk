import * as wafv2 from "aws-cdk-lib/aws-wafv2"
import * as constructs from "constructs"

export interface CustomRule {
  /**
   * Name of the rule
   */
  name: string

  /**
   * Priority of the rule in the Web ACL
   */
  priority: number

  /**
   * Action to take when the rule matches
   */
  action: RuleAction

  /**
   * Statement that defines the rule
   */
  statement: wafv2.CfnWebACL.StatementProperty

  /**
   * Visibility configuration for CloudWatch metrics
   */
  visibilityConfig?: VisibilityConfig

  /**
   * Labels to add to requests that match the rule
   */
  ruleLabels?: string[]

  /**
   * CAPTCHA configuration
   */
  captchaConfig?: wafv2.CfnWebACL.CaptchaConfigProperty

  /**
   * Challenge configuration
   */
  challengeConfig?: wafv2.CfnWebACL.ChallengeConfigProperty
}

export type RuleAction = "ALLOW" | "BLOCK" | "COUNT" | "CAPTCHA" | "CHALLENGE"

export interface VisibilityConfig {
  sampledRequestsEnabled: boolean
  cloudWatchMetricsEnabled: boolean
  metricName: string
}

/**
 * Builder class for creating custom WAF rules
 */
export class RuleBuilder {
  /**
   * Create a rule to block specific paths
   */
  static blockPath(path: string, priority: number): CustomRule {
    const safeName = `BlockPath-${path.replace(/[^a-zA-Z0-9]/g, "-")}`
    return {
      name: safeName,
      priority,
      action: "BLOCK",
      statement: {
        byteMatchStatement: {
          searchString: path,
          fieldToMatch: {
            uriPath: {},
          },
          textTransformations: [
            {
              priority: 0,
              type: "NONE",
            },
          ],
          positionalConstraint: "STARTS_WITH",
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: safeName,
      },
    }
  }

  /**
   * Create a rule to allow specific paths
   */
  static allowPath(path: string, priority: number): CustomRule {
    const safeName = `AllowPath-${path.replace(/[^a-zA-Z0-9]/g, "-")}`
    return {
      name: safeName,
      priority,
      action: "ALLOW",
      statement: {
        byteMatchStatement: {
          searchString: path,
          fieldToMatch: {
            uriPath: {},
          },
          textTransformations: [
            {
              priority: 0,
              type: "NONE",
            },
          ],
          positionalConstraint: "STARTS_WITH",
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: safeName,
      },
    }
  }

  /**
   * Create a rate-based rule to limit requests
   */
  static rateLimit(
    limit: number,
    priority: number,
    options?: {
      aggregateKeyType?: "IP" | "FORWARDED_IP" | "CUSTOM_KEYS"
      scopeDownStatement?: wafv2.CfnWebACL.StatementProperty
      customKeys?: wafv2.CfnWebACL.RateBasedStatementCustomKeyProperty[]
      action?: RuleAction
    },
  ): CustomRule {
    return {
      name: `RateLimit-${limit}`,
      priority,
      action: options?.action || "BLOCK",
      statement: {
        rateBasedStatement: {
          limit,
          aggregateKeyType: options?.aggregateKeyType || "IP",
          scopeDownStatement: options?.scopeDownStatement,
          customKeys: options?.customKeys,
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `RateLimit-${limit}`,
      },
    }
  }

  /**
   * Create a geo-blocking rule
   */
  static geoBlock(
    countryCodes: string[],
    priority: number,
    action: RuleAction = "BLOCK",
  ): CustomRule {
    return {
      name: `GeoRestriction-${countryCodes.join("-")}`,
      priority,
      action,
      statement: {
        geoMatchStatement: {
          countryCodes,
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: "GeoRestriction",
      },
    }
  }

  /**
   * Create an IP allowlist rule
   */
  static ipAllowlist(ipSetArn: string, priority: number): CustomRule {
    return {
      name: "IPAllowlist",
      priority,
      action: "ALLOW",
      statement: {
        ipSetReferenceStatement: {
          arn: ipSetArn,
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: "IPAllowlist",
      },
    }
  }

  /**
   * Create an IP blocklist rule
   */
  static ipBlocklist(ipSetArn: string, priority: number): CustomRule {
    return {
      name: "IPBlocklist",
      priority,
      action: "BLOCK",
      statement: {
        ipSetReferenceStatement: {
          arn: ipSetArn,
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: "IPBlocklist",
      },
    }
  }

  /**
   * Create a rule based on regex pattern matching
   */
  static regexMatch(
    regexPatternSetArn: string,
    fieldToMatch: wafv2.CfnWebACL.FieldToMatchProperty,
    priority: number,
    action: RuleAction = "BLOCK",
  ): CustomRule {
    return {
      name: "RegexMatch",
      priority,
      action,
      statement: {
        regexPatternSetReferenceStatement: {
          arn: regexPatternSetArn,
          fieldToMatch,
          textTransformations: [
            {
              priority: 0,
              type: "NONE",
            },
          ],
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: "RegexMatch",
      },
    }
  }

  /**
   * Create a rule that requires CAPTCHA validation
   */
  static captcha(
    statement: wafv2.CfnWebACL.StatementProperty,
    priority: number,
    name: string,
  ): CustomRule {
    return {
      name: `CAPTCHA-${name}`,
      priority,
      action: "CAPTCHA",
      statement,
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `CAPTCHA-${name}`,
      },
    }
  }

  /**
   * Create a rule based on request size
   */
  static sizeConstraint(
    size: number,
    comparisonOperator: "EQ" | "NE" | "LE" | "LT" | "GE" | "GT",
    fieldToMatch: wafv2.CfnWebACL.FieldToMatchProperty,
    priority: number,
    action: RuleAction = "BLOCK",
  ): CustomRule {
    return {
      name: `SizeConstraint-${comparisonOperator}-${size}`,
      priority,
      action,
      statement: {
        sizeConstraintStatement: {
          fieldToMatch,
          comparisonOperator,
          size,
          textTransformations: [
            {
              priority: 0,
              type: "NONE",
            },
          ],
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `SizeConstraint-${comparisonOperator}-${size}`,
      },
    }
  }

  /**
   * Create a rule with multiple conditions (AND logic)
   */
  static andRule(
    statements: wafv2.CfnWebACL.StatementProperty[],
    priority: number,
    action: RuleAction,
    name: string,
  ): CustomRule {
    return {
      name,
      priority,
      action,
      statement: {
        andStatement: {
          statements,
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: name,
      },
    }
  }

  /**
   * Create a rule with multiple conditions (OR logic)
   */
  static orRule(
    statements: wafv2.CfnWebACL.StatementProperty[],
    priority: number,
    action: RuleAction,
    name: string,
  ): CustomRule {
    return {
      name,
      priority,
      action,
      statement: {
        orStatement: {
          statements,
        },
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: name,
      },
    }
  }

  /**
   * Create a custom rule from a raw statement
   */
  static custom(
    statement: wafv2.CfnWebACL.StatementProperty,
    priority: number,
    action: RuleAction,
    name: string,
    visibilityConfig?: VisibilityConfig,
  ): CustomRule {
    return {
      name,
      priority,
      action,
      statement,
      visibilityConfig: visibilityConfig || {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: name,
      },
    }
  }
}

/**
 * Construct for creating WAF IP Sets
 */
export class WafIpSet extends constructs.Construct {
  public readonly ipSet: wafv2.CfnIPSet
  public readonly arn: string

  constructor(
    scope: constructs.Construct,
    id: string,
    props: {
      /**
       * IP addresses or CIDR blocks
       */
      addresses: string[]
      /**
       * IP version
       * @default IPV4
       */
      ipVersion?: "IPV4" | "IPV6"
      /**
       * Scope of the IP set
       * @default REGIONAL
       */
      scope?: "REGIONAL" | "CLOUDFRONT"
      /**
       * Description of the IP set
       */
      description?: string
    },
  ) {
    super(scope, id)

    this.ipSet = new wafv2.CfnIPSet(this, "IPSet", {
      addresses: props.addresses,
      ipAddressVersion: props.ipVersion || "IPV4",
      scope: props.scope || "REGIONAL",
      description: props.description,
    })

    this.arn = this.ipSet.attrArn
  }
}

/**
 * Construct for creating WAF Regex Pattern Sets
 */
export class WafRegexPatternSet extends constructs.Construct {
  public readonly regexPatternSet: wafv2.CfnRegexPatternSet
  public readonly arn: string

  constructor(
    scope: constructs.Construct,
    id: string,
    props: {
      /**
       * Regular expression patterns
       */
      patterns: string[]
      /**
       * Scope of the regex pattern set
       * @default REGIONAL
       */
      scope?: "REGIONAL" | "CLOUDFRONT"
      /**
       * Description of the regex pattern set
       */
      description?: string
    },
  ) {
    super(scope, id)

    this.regexPatternSet = new wafv2.CfnRegexPatternSet(
      this,
      "RegexPatternSet",
      {
        regularExpressionList: props.patterns,
        scope: props.scope || "REGIONAL",
        description: props.description,
      },
    )

    this.arn = this.regexPatternSet.attrArn
  }
}
