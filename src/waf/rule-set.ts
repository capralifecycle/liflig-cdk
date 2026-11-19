import type { Match } from "./match"
import type { Rule } from "./rule"

export interface RuleSetProps {
  rules: Rule[]
  /**
   * Only apply the rules to requests that match, for example the host names
   * of one app behind a shared load balancer.
   *
   * @default the rules apply to all requests
   */
  scope?: Match
}

/**
 * A named group of rules, owned by one app. The web ACL prefixes rule and
 * metric names with the name of the set, and applies the rules to the requests
 * that match its scope only.
 */
export class RuleSet {
  public readonly rules: Rule[]
  public readonly scope?: Match

  constructor(
    public readonly name: string,
    props: RuleSetProps,
  ) {
    this.rules = props.rules
    this.scope = props.scope
  }
}
