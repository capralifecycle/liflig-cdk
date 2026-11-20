import * as cdk from "aws-cdk-lib"
import type * as wafv2 from "aws-cdk-lib/aws-wafv2"
import { Action } from "./action"
import type { AwsManagedRuleGroup } from "./managed-rule-groups"
import { Match } from "./match"

/** What the web ACL decides about a rule when it renders it. */
export interface RuleRenderContext {
  /** The rule's name in the web ACL, prefixed with its rule set. */
  name: string
  priority: number
  visibilityConfig: wafv2.CfnWebACL.VisibilityConfigProperty
  /** A match the request must satisfy for the rule to apply. */
  scope?: Match
}

export interface CustomRuleOptions {
  /** Requests the rule applies to. */
  match: Match
  action: Action
  /**
   * Labels added to requests that match, for later rules to match on.
   *
   * @default no labels
   */
  labels?: string[]
}

export interface ManagedRuleOptions {
  /**
   * @default "AWS"
   */
  vendorName?: string
  /**
   * Name of the rule in the web ACL.
   *
   * @default the name of the rule group
   */
  name?: string
  /**
   * @default the default version of the rule group
   */
  version?: string
  /**
   * Actions that replace the action of individual rules in the group, keyed by
   * rule name. For example, to only count a rule that blocks legitimate
   * requests.
   *
   * @default the actions of the rule group
   */
  ruleActionOverrides?: Record<string, Action>
  /**
   * Only inspect requests that match.
   *
   * @default all requests
   */
  scopeDown?: Match
  /**
   * Count matches of the rule group instead of applying its actions.
   *
   * @default false
   */
  count?: boolean
  /**
   * @default no configuration
   */
  managedRuleGroupConfigs?: wafv2.CfnWebACL.ManagedRuleGroupConfigProperty[]
}

export interface RateLimitOptions {
  /**
   * Maximum requests per aggregation key within the evaluation window, an
   * integer from 10 to 2,000,000,000.
   */
  limit: number
  /**
   * One of 60, 120, 300 or 600 seconds.
   *
   * @default 5 minutes
   */
  evaluationWindow?: cdk.Duration
  /**
   * @default "IP"
   */
  aggregateKeyType?: "IP" | "FORWARDED_IP"
  /**
   * Required when `aggregateKeyType` is "FORWARDED_IP".
   */
  forwardedIpConfig?: wafv2.CfnWebACL.ForwardedIPConfigurationProperty
  /**
   * Only count requests that match.
   *
   * @default all requests
   */
  scopeDown?: Match
  /**
   * Cannot be `Action.allow()`.
   *
   * @default Action.block()
   */
  action?: Action
}

const EVALUATION_WINDOWS = [60, 120, 300, 600]
const MIN_LIMIT = 10
const MAX_LIMIT = 2_000_000_000

function allOf(...matches: (Match | undefined)[]): Match | undefined {
  const present = matches.filter((m): m is Match => m !== undefined)
  return present.length === 0 ? undefined : Match.and(...present)
}

/**
 * A rule of a web ACL. Rules are values: the web ACL decides name, priority
 * and metrics when it renders them.
 */
export abstract class Rule {
  /** A rule that applies an action to the requests that match. */
  static custom(name: string, options: CustomRuleOptions): Rule {
    return new CustomRule(name, options)
  }

  /**
   * A rule that runs a managed rule group. Known AWS groups are suggested, any
   * other name works with the right `vendorName`.
   */
  static managed(
    group: AwsManagedRuleGroup | (string & {}),
    options: ManagedRuleOptions = {},
  ): Rule {
    return new ManagedRule(group, options)
  }

  /** A rule that blocks (by default) IPs that send too many requests. */
  static rateLimit(name: string, options: RateLimitOptions): Rule {
    return new RateLimitRule(name, options)
  }

  protected constructor(public readonly name: string) {}

  abstract render(context: RuleRenderContext): wafv2.CfnWebACL.RuleProperty
}

class CustomRule extends Rule {
  constructor(
    name: string,
    private readonly options: CustomRuleOptions,
  ) {
    super(name)
  }

  render(context: RuleRenderContext): wafv2.CfnWebACL.RuleProperty {
    const match = allOf(context.scope, this.options.match)!
    return {
      name: context.name,
      priority: context.priority,
      statement: match.render(),
      action: this.options.action.render(),
      visibilityConfig: context.visibilityConfig,
      ruleLabels: this.options.labels?.map((name) => ({ name })),
    }
  }
}

class ManagedRule extends Rule {
  constructor(
    private readonly group: string,
    private readonly options: ManagedRuleOptions,
  ) {
    super(options.name ?? group)
  }

  render(context: RuleRenderContext): wafv2.CfnWebACL.RuleProperty {
    const { options } = this
    const scopeDown = allOf(context.scope, options.scopeDown)
    return {
      name: context.name,
      priority: context.priority,
      overrideAction: options.count ? { count: {} } : { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: options.vendorName ?? "AWS",
          name: this.group,
          version: options.version,
          ruleActionOverrides: options.ruleActionOverrides
            ? Object.entries(options.ruleActionOverrides)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([name, action]) => ({
                  name,
                  actionToUse: action.render(),
                }))
            : undefined,
          managedRuleGroupConfigs: options.managedRuleGroupConfigs,
          scopeDownStatement: scopeDown?.render(),
        },
      },
      visibilityConfig: context.visibilityConfig,
    }
  }
}

class RateLimitRule extends Rule {
  private readonly windowSeconds: number
  private readonly action: Action

  constructor(
    name: string,
    private readonly options: RateLimitOptions,
  ) {
    super(name)
    this.action = options.action ?? Action.block()
    if (this.action.kind === "allow") {
      throw new Error(
        `Rate limit rule '${name}' cannot use the allow action: a rate-based rule must block, count, captcha or challenge`,
      )
    }
    if (
      options.aggregateKeyType === "FORWARDED_IP" &&
      !options.forwardedIpConfig
    ) {
      throw new Error(
        `Rate limit rule '${name}': aggregateKeyType FORWARDED_IP requires forwardedIpConfig`,
      )
    }
    if (
      !cdk.Token.isUnresolved(options.limit) &&
      !(
        Number.isInteger(options.limit) &&
        options.limit >= MIN_LIMIT &&
        options.limit <= MAX_LIMIT
      )
    ) {
      throw new Error(
        `Rate limit rule '${name}': limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}, got ${options.limit}`,
      )
    }
    this.windowSeconds = (
      options.evaluationWindow ?? cdk.Duration.minutes(5)
    ).toSeconds()
    if (!EVALUATION_WINDOWS.includes(this.windowSeconds)) {
      throw new Error(
        `Rate limit rule '${name}': evaluation window must be one of ${EVALUATION_WINDOWS.join(", ")} seconds, got ${this.windowSeconds}`,
      )
    }
  }

  render(context: RuleRenderContext): wafv2.CfnWebACL.RuleProperty {
    const { options } = this
    const scopeDown = allOf(context.scope, options.scopeDown)
    return {
      name: context.name,
      priority: context.priority,
      action: this.action.render(),
      statement: {
        rateBasedStatement: {
          limit: options.limit,
          evaluationWindowSec: this.windowSeconds,
          aggregateKeyType: options.aggregateKeyType ?? "IP",
          forwardedIpConfig: options.forwardedIpConfig,
          scopeDownStatement: scopeDown?.render(),
        },
      },
      visibilityConfig: context.visibilityConfig,
    }
  }
}
