// Test fixture: a hand-written web ACL construct that WebAcl must stay compatible with.
import * as cdk from "aws-cdk-lib"
import { LogGroup, type RetentionDays } from "aws-cdk-lib/aws-logs"
import * as wafv2 from "aws-cdk-lib/aws-wafv2"
import * as constructs from "constructs"

/** A WAF rule as an app declares it: the web ACL sets priority and metrics. */
export type WafRule = Omit<
  wafv2.CfnWebACL.RuleProperty,
  "priority" | "visibilityConfig"
>

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

/** A rule that runs one of AWS's managed rule groups, named after the group. */
export function awsManagedRuleGroup(
  name: AwsManagedRuleGroup,
  props: {
    /** For example, to only count a rule that blocks legitimate requests. */
    ruleActionOverrides?: wafv2.CfnWebACL.RuleActionOverrideProperty[]
  } = {},
): WafRule {
  return {
    name,
    overrideAction: { none: {} },
    statement: {
      managedRuleGroupStatement: {
        vendorName: "AWS",
        name,
        ruleActionOverrides: props.ruleActionOverrides,
      },
    },
  }
}

/**
 * The WAF rules of one app on the shared ALB. The web ACL only applies them to
 * requests for the app's host names, so they cannot affect other apps.
 */
export interface WafRuleSet {
  /** Prefixes the rule and metric names, so they are unique in the web ACL. */
  name: string
  hostNames: string[]
  rules: WafRule[]
}

interface Props {
  loadBalancerArn: string
  ruleSets: WafRuleSet[]
  logRetention: RetentionDays
}

/**
 * The WAF of the shared ALB: its web ACL, the ACL's association with the ALB
 * and WAF logging. An ALB takes only one web ACL, so the apps
 * behind it declare their rules as a {@link WafRuleSet} that is passed in
 * here, rather than creating web ACLs of their own. Requests that no rule
 * blocks are allowed.
 */
export class LegacyWebAcl extends constructs.Construct {
  readonly webAcl: wafv2.CfnWebACL

  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)

    const stackName = cdk.Stack.of(this).stackName
    const visibilityConfig = (metricName: string) => ({
      cloudWatchMetricsEnabled: true,
      sampledRequestsEnabled: true,
      metricName: `${stackName}-${metricName}`,
    })

    const rules = props.ruleSets
      .flatMap((ruleSet) => {
        const matchesHostNamesStatement = getMatchesHostNamesStatement(
          ruleSet.hostNames,
        )
        return ruleSet.rules.map((rule) => ({
          ...rule,
          name: `${ruleSet.name}-${rule.name}`,
          statement: scopeDown(rule.statement, matchesHostNamesStatement),
        }))
      })
      .map(
        (rule, priority): wafv2.CfnWebACL.RuleProperty => ({
          ...rule,
          priority,
          visibilityConfig: visibilityConfig(rule.name),
        }),
      )

    this.webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      name: `${stackName}-web-acl`,
      scope: "REGIONAL",
      defaultAction: { allow: {} },
      visibilityConfig: visibilityConfig("web-acl"),
      rules,
    })

    new wafv2.CfnWebACLAssociation(this, "Association", {
      resourceArn: props.loadBalancerArn,
      webAclArn: this.webAcl.attrArn,
    })

    // WAF requires the log group name to start with "aws-waf-logs-".
    const logGroup = new LogGroup(this, "LogGroup", {
      logGroupName: `aws-waf-logs-${stackName}`,
      retention: props.logRetention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    new wafv2.CfnLoggingConfiguration(this, "LoggingConfiguration", {
      resourceArn: this.webAcl.attrArn,
      logDestinationConfigs: [logGroup.logGroupArn],
      // Only log requests WAF did something with: allowed traffic is already
      // in the ALB/app logs, and logging it all would cost a lot.
      loggingFilter: {
        DefaultBehavior: "DROP",
        Filters: [
          {
            Behavior: "KEEP",
            Requirement: "MEETS_ANY",
            Conditions: [
              { ActionCondition: { Action: "BLOCK" } },
              { ActionCondition: { Action: "COUNT" } },
            ],
          },
        ],
      },
    })
  }
}

function getMatchesHostNamesStatement(
  hostNames: string[],
): wafv2.CfnWebACL.StatementProperty {
  if (hostNames.length === 0) {
    throw new Error("A WAF rule set needs at least one host name")
  }
  const matches = hostNames.map(
    (hostName): wafv2.CfnWebACL.StatementProperty => ({
      byteMatchStatement: {
        fieldToMatch: { singleHeader: { Name: "host" } },
        positionalConstraint: "EXACTLY",
        searchString: hostName.toLowerCase(),
        textTransformations: [{ priority: 0, type: "LOWERCASE" }],
      },
    }),
  )
  return matches.length === 1
    ? matches[0]
    : { orStatement: { statements: matches } }
}

/**
 * Makes a rule only apply to requests that matches an app's host names.
 * WAF does not allow managed rule groups or rate-based rules
 * inside an AND, so for those the condition goes in their scope-down statement.
 */
function scopeDown(
  statement: wafv2.CfnWebACL.StatementProperty | cdk.IResolvable,
  matchesHostNamesStatement: wafv2.CfnWebACL.StatementProperty,
): wafv2.CfnWebACL.StatementProperty {
  if (cdk.Token.isUnresolved(statement)) {
    throw new Error("WAF rule statements must not be tokens")
  }
  const s = statement as wafv2.CfnWebACL.StatementProperty
  const and = (
    existing: wafv2.CfnWebACL.StatementProperty | cdk.IResolvable | undefined,
  ): wafv2.CfnWebACL.StatementProperty =>
    existing
      ? { andStatement: { statements: [matchesHostNamesStatement, existing] } }
      : matchesHostNamesStatement

  if (s.managedRuleGroupStatement) {
    const inner =
      s.managedRuleGroupStatement as wafv2.CfnWebACL.ManagedRuleGroupStatementProperty
    return {
      managedRuleGroupStatement: {
        ...inner,
        scopeDownStatement: and(inner.scopeDownStatement),
      },
    }
  }
  if (s.rateBasedStatement) {
    const inner =
      s.rateBasedStatement as wafv2.CfnWebACL.RateBasedStatementProperty
    return {
      rateBasedStatement: {
        ...inner,
        scopeDownStatement: and(inner.scopeDownStatement),
      },
    }
  }
  if (s.ruleGroupReferenceStatement) {
    throw new Error(
      "Rule group references cannot be scoped down; use managed rule groups or plain statements",
    )
  }
  return and(s)
}
