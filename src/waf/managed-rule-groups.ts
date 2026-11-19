/**
 * AWS's managed rule groups. Neither aws-cdk-lib nor the AWS SDK types these
 * names, so they are listed here. The full list is at
 * https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-list.html
 * or from `aws wafv2 list-available-managed-rule-groups --scope REGIONAL`.
 */
export const AWS_MANAGED_RULE_GROUPS = [
  // Baseline
  "AWSManagedRulesCommonRuleSet",
  "AWSManagedRulesAdminProtectionRuleSet",
  "AWSManagedRulesKnownBadInputsRuleSet",
  // Use-case specific
  "AWSManagedRulesSQLiRuleSet",
  "AWSManagedRulesLinuxRuleSet",
  "AWSManagedRulesUnixRuleSet",
  "AWSManagedRulesWindowsRuleSet",
  "AWSManagedRulesPHPRuleSet",
  "AWSManagedRulesWordPressRuleSet",
  // IP reputation
  "AWSManagedRulesAmazonIpReputationList",
  "AWSManagedRulesAnonymousIpList",
  // Paid: Bot Control, account takeover and account creation fraud, DDoS
  "AWSManagedRulesBotControlRuleSet",
  "AWSManagedRulesATPRuleSet",
  "AWSManagedRulesACFPRuleSet",
  "AWSManagedRulesAntiDDoSRuleSet",
] as const

export type AwsManagedRuleGroup = (typeof AWS_MANAGED_RULE_GROUPS)[number]
