import type * as wafv2 from "aws-cdk-lib/aws-wafv2"

/**
 * AWS Managed Rules for AWS WAF
 * @see https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-list.html
 */
export enum AwsManagedRules {
  // Baseline rule groups
  CORE_RULE_SET = "AWSManagedRulesCommonRuleSet",
  ADMIN_PROTECTION = "AWSManagedRulesAdminProtectionRuleSet",
  KNOWN_BAD_INPUTS = "AWSManagedRulesKnownBadInputsRuleSet",

  // Use-case specific rule groups
  SQL_DATABASE = "AWSManagedRulesSQLiRuleSet",
  LINUX_OS = "AWSManagedRulesLinuxRuleSet",
  POSIX_OS = "AWSManagedRulesUnixRuleSet",
  WINDOWS_OS = "AWSManagedRulesWindowsRuleSet",
  PHP_APPLICATION = "AWSManagedRulesPHPRuleSet",
  WORDPRESS_APPLICATION = "AWSManagedRulesWordPressRuleSet",

  // IP reputation rule groups
  AMAZON_IP_REPUTATION = "AWSManagedRulesAmazonIpReputationList",
  ANONYMOUS_IP = "AWSManagedRulesAnonymousIPList",

  // Bot Control
  BOT_CONTROL = "AWSManagedRulesBotControlRuleSet",

  // DDoS prevention
  DDOS_PREVENTION = "AWSManagedRulesDDoSRuleSet",

  // Fraud Control
  ACCOUNT_TAKEOVER_PREVENTION = "AWSManagedRulesATPRuleSet",
  ACCOUNT_CREATION_FRAUD_PREVENTION = "AWSManagedRulesACFPRuleSet",
}

export interface ManagedRuleGroup {
  /**
   * Name of the managed rule group
   */
  name: AwsManagedRules | string

  /**
   * Vendor of the managed rule group
   * @default "AWS"
   */
  vendor?: string

  /**
   * Priority of the rule group in the Web ACL
   */
  priority: number

  /**
   * Override action for the rule group
   * @default "NONE"
   */
  overrideAction?: "NONE" | "COUNT"

  /**
   * Rules to exclude from the rule group
   */
  excludedRules?: string[]

  /**
   * Scope down statement to narrow the requests that the rule group inspects
   */
  scopeDownStatement?: wafv2.CfnWebACL.StatementProperty

  /**
   * Visibility configuration for CloudWatch metrics
   */
  visibilityConfig?: {
    sampledRequestsEnabled: boolean
    cloudWatchMetricsEnabled: boolean
    metricName: string
  }

  /**
   * Version of the managed rule group
   * @default Latest version
   */
  version?: string
}

/**
 * Builder class for creating managed rule group configurations
 */
export class ManagedRuleGroupBuilder {
  /**
   * Create the Core Rule Set managed rule group
   * Provides protection against OWASP Top 10 and common vulnerabilities
   */
  static coreRuleSet(
    priority: number,
    options?: Partial<ManagedRuleGroup>,
  ): ManagedRuleGroup {
    return {
      name: AwsManagedRules.CORE_RULE_SET,
      vendor: "AWS",
      priority,
      overrideAction: "NONE",
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: "CoreRuleSet",
      },
      ...options,
    }
  }

  /**
   * Create the Known Bad Inputs managed rule group
   * Blocks request patterns known to be invalid or associated with exploitation
   */
  static knownBadInputs(
    priority: number,
    options?: Partial<ManagedRuleGroup>,
  ): ManagedRuleGroup {
    return {
      name: AwsManagedRules.KNOWN_BAD_INPUTS,
      vendor: "AWS",
      priority,
      overrideAction: "NONE",
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: "KnownBadInputs",
      },
      ...options,
    }
  }

  /**
   * Create the SQL Database managed rule group
   * Provides protection against SQL injection attacks
   */
  static sqlDatabase(
    priority: number,
    options?: Partial<ManagedRuleGroup>,
  ): ManagedRuleGroup {
    return {
      name: AwsManagedRules.SQL_DATABASE,
      vendor: "AWS",
      priority,
      overrideAction: "NONE",
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: "SQLDatabase",
      },
      ...options,
    }
  }

  /**
   * Create the Admin Protection managed rule group
   * Blocks external access to exposed admin pages
   */
  static adminProtection(
    priority: number,
    options?: Partial<ManagedRuleGroup>,
  ): ManagedRuleGroup {
    return {
      name: AwsManagedRules.ADMIN_PROTECTION,
      vendor: "AWS",
      priority,
      overrideAction: "NONE",
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: "AdminProtection",
      },
      ...options,
    }
  }

  /**
   * Create the Bot Control managed rule group
   * Manages bot traffic to your application
   */
  static botControl(
    priority: number,
    options?: Partial<ManagedRuleGroup>,
  ): ManagedRuleGroup {
    return {
      name: AwsManagedRules.BOT_CONTROL,
      vendor: "AWS",
      priority,
      overrideAction: "NONE",
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: "BotControl",
      },
      ...options,
    }
  }

  /**
   * Create the Amazon IP Reputation List managed rule group
   * Blocks requests from IP addresses with poor reputation
   */
  static amazonIpReputation(
    priority: number,
    options?: Partial<ManagedRuleGroup>,
  ): ManagedRuleGroup {
    return {
      name: AwsManagedRules.AMAZON_IP_REPUTATION,
      vendor: "AWS",
      priority,
      overrideAction: "NONE",
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: "AmazonIpReputation",
      },
      ...options,
    }
  }

  /**
   * Create the Anonymous IP List managed rule group
   * Blocks requests from services that hide viewer identity
   */
  static anonymousIp(
    priority: number,
    options?: Partial<ManagedRuleGroup>,
  ): ManagedRuleGroup {
    return {
      name: AwsManagedRules.ANONYMOUS_IP,
      vendor: "AWS",
      priority,
      overrideAction: "NONE",
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: "AnonymousIp",
      },
      ...options,
    }
  }

  /**
   * Create a custom managed rule group configuration
   */
  static custom(
    name: string,
    priority: number,
    vendor = "AWS",
    options?: Partial<ManagedRuleGroup>,
  ): ManagedRuleGroup {
    return {
      name,
      vendor,
      priority,
      overrideAction: "NONE",
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: name.replace(/[^a-zA-Z0-9]/g, ""),
      },
      ...options,
    }
  }
}
