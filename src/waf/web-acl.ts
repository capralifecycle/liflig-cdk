import * as cdk from "aws-cdk-lib"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import type * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2"
import * as logs from "aws-cdk-lib/aws-logs"
import * as wafv2 from "aws-cdk-lib/aws-wafv2"
import * as constructs from "constructs"
import type { DefaultAction } from "./action"
import { Match } from "./match"
import { RuleSet } from "./rule-set"

export interface WebAclLoggingProps {
  /**
   * @default true
   */
  enabled?: boolean
  /**
   * @default logs.RetentionDays.ONE_MONTH
   */
  retention?: logs.RetentionDays
  /**
   * Must start with `aws-waf-logs-`, which WAF requires of its log groups.
   * Must be set on every web ACL after the first in a stack that has logging
   * enabled.
   *
   * @default `aws-waf-logs-${stackName}`
   */
  logGroupName?: string
  /**
   * @default cdk.RemovalPolicy.DESTROY
   */
  removalPolicy?: cdk.RemovalPolicy
  /**
   * Names of headers to redact from the logs. Use an empty list to redact
   * none.
   *
   * @default ["authorization", "cookie"]
   */
  redactedHeaders?: string[]
  /**
   * Log all requests. By default only requests that a rule blocks, counts
   * (including managed group rules overridden to count), or answers with a
   * CAPTCHA or challenge are logged: allowed traffic is already in the load
   * balancer and app logs, and logging it all costs a lot.
   *
   * @default false
   */
  logAllRequests?: boolean
}

export interface WebAclProps {
  /**
   * The rule sets of the apps behind the web ACL. May be empty, in which case
   * the web ACL only applies its default action. Priorities follow the order
   * of the rule sets.
   *
   * Several rule sets may share a name, so that every app can pass the same
   * shared rule set value: they are merged into one if their rules are
   * identical, and it is an error if they differ. The merged set sits at the
   * position of the first occurrence and applies to the requests that match
   * any of the scopes, or to all requests if one of them has no scope. Rule
   * sets without rules are skipped, with a warning.
   */
  ruleSets: RuleSet[]
  /**
   * What to do with requests that no rule decides. There is no default on
   * purpose: choose `DefaultAction.allow()` to block only what rules match
   * (the usual choice in front of an app), or `DefaultAction.block()` to allow
   * only what rules allow.
   */
  defaultAction: DefaultAction
  /**
   * `CLOUDFRONT` web ACLs must be created in us-east-1, and are attached to a
   * distribution by passing `webAclArn` to its `webAclId`. One web ACL cannot
   * serve both scopes: use two `WebAcl` instances and share the `RuleSet`
   * values between them.
   *
   * @default "REGIONAL"
   */
  scope?: "REGIONAL" | "CLOUDFRONT"
  /**
   * Must be set on every web ACL after the first in a stack.
   *
   * @default `${stackName}-web-acl`
   */
  webAclName?: string
  /**
   * Prefix of the CloudWatch metric names of the web ACL and its rules. Must
   * be set on every web ACL after the first in a stack.
   *
   * @default the stack name
   */
  metricNamePrefix?: string
  /**
   * Custom response bodies that block actions can refer to by key.
   *
   * @default none
   */
  customResponseBodies?: wafv2.CfnWebACLProps["customResponseBodies"]
  /**
   * Domains that CAPTCHA and challenge tokens are valid for.
   *
   * @default only the domain of the protected resource
   */
  tokenDomains?: string[]
  /**
   * @default logging to CloudWatch Logs is enabled
   */
  logging?: WebAclLoggingProps
  /**
   * Escape hatch for web ACL options the construct doesn't expose directly.
   * Overrides any value set via the typed props above.
   */
  overrideWebAclProps?: Omit<
    Partial<wafv2.CfnWebACLProps>,
    "name" | "rules" | "scope" | "defaultAction" | "visibilityConfig"
  >
}

const RULE_NAME_PATTERN = /^[0-9A-Za-z_-]{1,128}$/
const METRIC_NAME_PATTERN = /^[\w#:.\-/]+$/
const LOG_GROUP_PREFIX = "aws-waf-logs-"

const NAMES_IN_STACK = new WeakMap<cdk.Stack, Set<string>>()

/**
 * Web ACL names, metric name prefixes and log group names must be unique, or
 * the deployment fails. Throws at synth on a clash with another WebAcl in the
 * same stack. Nothing is claimed if any of the names clash.
 */
function claimNames(
  stack: cdk.Stack,
  construct: constructs.Construct,
  names: [kind: string, name: string][],
): void {
  let taken = NAMES_IN_STACK.get(stack)
  if (!taken) {
    taken = new Set()
    NAMES_IN_STACK.set(stack, taken)
  }
  for (const [kind, name] of names) {
    if (taken.has(`${kind}:${name}`)) {
      throw new Error(
        `Another WebAcl in stack '${stack.stackName}' already uses the ${kind} '${name}'. Set a different value on ${construct.node.path}`,
      )
    }
  }
  for (const [kind, name] of names) {
    taken.add(`${kind}:${name}`)
  }
}

const PLACEHOLDER_VISIBILITY: wafv2.CfnWebACL.VisibilityConfigProperty = {
  cloudWatchMetricsEnabled: true,
  sampledRequestsEnabled: true,
  metricName: "placeholder",
}

/** Resolves tokens, so that equal values compare equal and Lazy values by what they resolve to. */
function resolvedJson(stack: cdk.Stack, value: unknown): string {
  return JSON.stringify(stack.resolve(value))
}

/** The rules of a set as they render without scope, name prefix or priority. */
function fingerprint(stack: cdk.Stack, ruleSet: RuleSet): string {
  return resolvedJson(
    stack,
    ruleSet.rules.map((rule) =>
      rule.render({
        name: rule.name,
        priority: 0,
        visibilityConfig: PLACEHOLDER_VISIBILITY,
      }),
    ),
  )
}

function mergeRuleSets(stack: cdk.Stack, ruleSets: RuleSet[]): RuleSet[] {
  const byName = new Map<
    string,
    { first: RuleSet; fingerprint: string; scopes: (Match | undefined)[] }
  >()
  for (const ruleSet of ruleSets) {
    const existing = byName.get(ruleSet.name)
    const ruleSetFingerprint = fingerprint(stack, ruleSet)
    if (!existing) {
      byName.set(ruleSet.name, {
        first: ruleSet,
        fingerprint: ruleSetFingerprint,
        scopes: [ruleSet.scope],
      })
    } else if (existing.fingerprint === ruleSetFingerprint) {
      existing.scopes.push(ruleSet.scope)
    } else {
      throw new Error(
        `Duplicate WAF rule set name '${ruleSet.name}' with different rules`,
      )
    }
  }
  return [...byName.values()].map(({ first, scopes }) => {
    // A set without scope applies to all requests.
    if (scopes.includes(undefined)) {
      return first.scope === undefined
        ? first
        : new RuleSet(first.name, { rules: first.rules })
    }
    const distinct = new Map<string, Match>()
    for (const scope of scopes as Match[]) {
      distinct.set(resolvedJson(stack, scope.render()), scope)
    }
    if (distinct.size === 1) {
      return first
    }
    return new RuleSet(first.name, {
      rules: first.rules,
      scope: Match.or(...distinct.values()),
    })
  })
}

/**
 * A web ACL for a load balancer, an API Gateway REST API stage or a CloudFront
 * distribution.
 *
 * A protected resource takes only one web ACL, so create one per entry point
 * and let the apps behind it own their rules as {@link RuleSet} values, which
 * are passed in here. A rule set with a `scope` only applies to requests that
 * match it: the match is added to each of its rules, or to their scope-down
 * statement for managed and rate-based rules. Rule and metric names are
 * prefixed with the name of the rule set, and priorities follow the order of
 * the rule sets.
 */
export class WebAcl extends constructs.Construct {
  public readonly webAcl: wafv2.CfnWebACL
  public readonly webAclArn: string
  public readonly webAclId: string
  public readonly webAclName: string
  public readonly scope: "REGIONAL" | "CLOUDFRONT"
  public readonly logGroup?: logs.ILogGroup

  private associations = 0
  private readonly metricName: string

  constructor(scope: constructs.Construct, id: string, props: WebAclProps) {
    super(scope, id)

    const stack = cdk.Stack.of(this)
    const stackName = stack.stackName
    const metricNamePrefix = props.metricNamePrefix ?? stackName
    this.webAclName = props.webAclName ?? `${stackName}-web-acl`
    claimNames(stack, this, [
      ["web ACL name", this.webAclName],
      ["metric name prefix", metricNamePrefix],
      ...(props.logging?.enabled !== false
        ? [
            [
              "log group name",
              props.logging?.logGroupName ?? `${LOG_GROUP_PREFIX}${stackName}`,
            ] as [string, string],
          ]
        : []),
    ])
    this.scope = props.scope ?? "REGIONAL"

    if (this.scope === "CLOUDFRONT") {
      if (cdk.Token.isUnresolved(stack.region)) {
        cdk.Annotations.of(this).addWarningV2(
          "@liflig/cdk:waf-cloudfront-region",
          "CLOUDFRONT web ACLs must be created in us-east-1, but the region of the stack is not known",
        )
      } else if (stack.region !== "us-east-1") {
        throw new Error(
          `CLOUDFRONT web ACLs must be created in us-east-1, but the stack is in ${stack.region}`,
        )
      }
    }

    const visibilityConfig = (
      suffix: string,
    ): wafv2.CfnWebACL.VisibilityConfigProperty => {
      const metricName = `${metricNamePrefix}-${suffix}`
      if (metricName.length > 255 || !METRIC_NAME_PATTERN.test(metricName)) {
        throw new Error(
          `Invalid WAF metric name '${metricName}': must be 1-255 characters of letters, digits and _#:.-/`,
        )
      }
      return {
        cloudWatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName,
      }
    }

    const webAclVisibility = visibilityConfig("web-acl")
    this.metricName = webAclVisibility.metricName
    const ruleNames = new Set<string>()
    const rules: wafv2.CfnWebACL.RuleProperty[] = []

    for (const ruleSet of mergeRuleSets(stack, props.ruleSets)) {
      if (ruleSet.rules.length === 0) {
        cdk.Annotations.of(this).addWarningV2(
          "@liflig/cdk:waf-empty-rule-set",
          `WAF rule set '${ruleSet.name}' has no rules and is skipped`,
        )
        continue
      }
      for (const rule of ruleSet.rules) {
        const name = `${ruleSet.name}-${rule.name}`
        if (!RULE_NAME_PATTERN.test(name)) {
          throw new Error(
            `Invalid WAF rule name '${name}': must be 1-128 characters of letters, digits, '_' and '-'`,
          )
        }
        if (ruleNames.has(name)) {
          throw new Error(`Duplicate WAF rule name '${name}'`)
        }
        ruleNames.add(name)
        rules.push(
          rule.render({
            name,
            priority: rules.length,
            visibilityConfig: visibilityConfig(name),
            scope: ruleSet.scope,
          }),
        )
      }
    }

    this.webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      name: this.webAclName,
      scope: this.scope,
      defaultAction: props.defaultAction.render(),
      visibilityConfig: webAclVisibility,
      rules,
      customResponseBodies: props.customResponseBodies,
      tokenDomains: props.tokenDomains,
      ...props.overrideWebAclProps,
    })
    this.webAclArn = this.webAcl.attrArn
    this.webAclId = this.webAcl.attrId

    if (props.logging?.enabled !== false) {
      this.logGroup = this.addLogging(stackName, props.logging)
    }
  }

  /**
   * Associates the web ACL with an application load balancer, or with another
   * regional resource given by ARN, such as an API Gateway REST API stage. A
   * resource can only have one web ACL.
   *
   * CloudFront distributions are not associated this way: pass `webAclArn` to
   * the distribution's `webAclId`.
   */
  attachTo(
    target: elbv2.IApplicationLoadBalancer | string,
  ): wafv2.CfnWebACLAssociation {
    if (this.scope === "CLOUDFRONT") {
      throw new Error(
        "A CLOUDFRONT web ACL cannot be attached with attachTo: pass webAclArn to the distribution's webAclId instead",
      )
    }
    this.associations += 1
    // The first association keeps the id "Association" that LegacyWebAcl used.
    const id =
      this.associations === 1
        ? "Association"
        : `Association${this.associations}`
    return new wafv2.CfnWebACLAssociation(this, id, {
      resourceArn:
        typeof target === "string"
          ? target
          : target.loadBalancerRef.loadBalancerArn,
      webAclArn: this.webAclArn,
    })
  }

  metricBlockedRequests(props?: cloudwatch.MetricOptions): cloudwatch.Metric {
    return this.metric("BlockedRequests", props)
  }

  metricAllowedRequests(props?: cloudwatch.MetricOptions): cloudwatch.Metric {
    return this.metric("AllowedRequests", props)
  }

  metricCountedRequests(props?: cloudwatch.MetricOptions): cloudwatch.Metric {
    return this.metric("CountedRequests", props)
  }

  private metric(
    metricName: string,
    props?: cloudwatch.MetricOptions,
  ): cloudwatch.Metric {
    return new cloudwatch.Metric({
      namespace: "AWS/WAFV2",
      metricName,
      statistic: "Sum",
      period: cdk.Duration.minutes(5),
      dimensionsMap: {
        // The dimension is the metric name from the visibility config.
        WebACL: this.metricName,
        Rule: "ALL",
        // CloudFront web ACL metrics have no Region dimension.
        ...(this.scope === "REGIONAL"
          ? { Region: cdk.Stack.of(this).region }
          : {}),
      },
      ...props,
    })
  }

  private addLogging(
    stackName: string,
    logging: WebAclLoggingProps | undefined,
  ): logs.ILogGroup {
    const logGroupName =
      logging?.logGroupName ?? `${LOG_GROUP_PREFIX}${stackName}`
    if (!logGroupName.startsWith(LOG_GROUP_PREFIX)) {
      throw new Error(
        `WAF log group name '${logGroupName}' must start with '${LOG_GROUP_PREFIX}'`,
      )
    }
    const logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName,
      retention: logging?.retention ?? logs.RetentionDays.ONE_MONTH,
      removalPolicy: logging?.removalPolicy ?? cdk.RemovalPolicy.DESTROY,
    })

    const redactedHeaders = logging?.redactedHeaders ?? [
      "authorization",
      "cookie",
    ]
    new wafv2.CfnLoggingConfiguration(this, "LoggingConfiguration", {
      resourceArn: this.webAclArn,
      logDestinationConfigs: [logGroup.logGroupArn],
      redactedFields: redactedHeaders.length
        ? redactedHeaders.map((name) => ({ singleHeader: { Name: name } }))
        : undefined,
      loggingFilter: logging?.logAllRequests
        ? undefined
        : {
            DefaultBehavior: "DROP",
            Filters: [
              {
                Behavior: "KEEP",
                Requirement: "MEETS_ANY",
                Conditions: (
                  [
                    "BLOCK",
                    "COUNT",
                    "CAPTCHA",
                    "CHALLENGE",
                    "EXCLUDED_AS_COUNT",
                  ] as const
                ).map((action) => ({ ActionCondition: { Action: action } })),
              },
            ],
          },
    })
    return logGroup
  }
}
