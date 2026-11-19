import * as cdk from "aws-cdk-lib"
import type * as wafv2 from "aws-cdk-lib/aws-wafv2"

// WAF does not allow these inside and, or and not statements.
const NON_NESTABLE_STATEMENTS = [
  "managedRuleGroupStatement",
  "rateBasedStatement",
  "ruleGroupReferenceStatement",
] as const

/** A condition on a request, rendered to a WAF statement. */
export class Match {
  /**
   * Requests whose `host` header is one of the given host names. Host names
   * are compared in lowercase.
   *
   * A leading `*.` matches any subdomain: `*.example.com` matches
   * `api.example.com` and `a.b.example.com`, but not `example.com` itself,
   * as with certificates. List the apex separately when it should match too.
   * WAF has no general wildcard, so `*` anywhere else is an error.
   */
  static hostNames(hosts: string[]): Match {
    if (hosts.length === 0) {
      throw new Error("Match.hostNames needs at least one host name")
    }
    return Match.or(
      ...hosts.map((host) => {
        const wildcard = !cdk.Token.isUnresolved(host) && host.startsWith("*.")
        const name = wildcard ? host.slice(1) : host
        if (!cdk.Token.isUnresolved(name) && name.includes("*")) {
          throw new Error(
            `Match.hostNames: '${host}' has a wildcard that is not a leading '*.'`,
          )
        }
        return new Match({
          byteMatchStatement: {
            fieldToMatch: { singleHeader: { Name: "host" } },
            positionalConstraint: wildcard ? "ENDS_WITH" : "EXACTLY",
            searchString: name.toLowerCase(),
            textTransformations: [{ priority: 0, type: "LOWERCASE" }],
          },
        })
      }),
    )
  }

  /**
   * Requests whose URI path starts with the given prefix. The path is URL
   * decoded and normalized before it is compared, as WAF inspects the raw path
   * otherwise.
   */
  static pathPrefix(
    prefix: string,
    options: {
      /**
       * Compare in lowercase.
       *
       * @default false
       */
      caseInsensitive?: boolean
    } = {},
  ): Match {
    const caseInsensitive = options.caseInsensitive ?? false
    return new Match({
      byteMatchStatement: {
        fieldToMatch: { uriPath: {} },
        positionalConstraint: "STARTS_WITH",
        searchString: caseInsensitive ? prefix.toLowerCase() : prefix,
        textTransformations: [
          { priority: 0, type: "URL_DECODE" },
          { priority: 1, type: "NORMALIZE_PATH" },
          ...(caseInsensitive ? [{ priority: 2, type: "LOWERCASE" }] : []),
        ],
      },
    })
  }

  /** Requests originating from one of the given ISO 3166 country codes. */
  static geo(countryCodes: string[]): Match {
    return new Match({ geoMatchStatement: { countryCodes } })
  }

  /** Requests from an IP set, given the ARN of the IP set. */
  static ipSet(arn: string): Match {
    return new Match({ ipSetReferenceStatement: { arn } })
  }

  /** Requests that an earlier rule in the web ACL has labeled with `key`. */
  static label(key: string): Match {
    return new Match({ labelMatchStatement: { scope: "LABEL", key } })
  }

  /** Requests matching all of the given matches. */
  static and(...matches: Match[]): Match {
    return combine("andStatement", matches)
  }

  /** Requests matching at least one of the given matches. */
  static or(...matches: Match[]): Match {
    return combine("orStatement", matches)
  }

  /** Requests not matching the given match. */
  static not(match: Match): Match {
    return new Match({ notStatement: { statement: match.render() } })
  }

  /**
   * Escape hatch for statements the other factories do not cover. Managed rule
   * group, rate-based and rule group reference statements cannot be nested in
   * a match: use `Rule.managed` or `Rule.rateLimit`.
   */
  static statement(raw: wafv2.CfnWebACL.StatementProperty): Match {
    assertNestable(raw)
    return new Match(raw)
  }

  private constructor(
    private readonly statement: wafv2.CfnWebACL.StatementProperty,
  ) {}

  render(): wafv2.CfnWebACL.StatementProperty {
    return this.statement
  }
}

function combine(
  kind: "andStatement" | "orStatement",
  matches: Match[],
): Match {
  if (matches.length === 0) {
    const method = kind === "andStatement" ? "and" : "or"
    throw new Error(`Match.${method} needs at least one match`)
  }
  if (matches.length === 1) {
    return matches[0]
  }
  return Match.statement({
    [kind]: { statements: matches.map((m) => m.render()) },
  })
}

function assertNestable(statement: unknown): void {
  if (statement === undefined || cdk.Token.isUnresolved(statement)) {
    return
  }
  const s = statement as wafv2.CfnWebACL.StatementProperty
  for (const key of NON_NESTABLE_STATEMENTS) {
    if (s[key] !== undefined) {
      throw new Error(
        `${key} cannot be used in Match.statement: WAF does not allow it inside another statement. Use Rule.managed or Rule.rateLimit instead`,
      )
    }
  }
  for (const key of ["andStatement", "orStatement"] as const) {
    const children = s[key]
    if (children === undefined || cdk.Token.isUnresolved(children)) continue
    const { statements } = children as wafv2.CfnWebACL.AndStatementProperty
    if (cdk.Token.isUnresolved(statements)) continue
    for (const child of statements as unknown[]) assertNestable(child)
  }
  const not = s.notStatement
  if (not !== undefined && !cdk.Token.isUnresolved(not)) {
    assertNestable((not as wafv2.CfnWebACL.NotStatementProperty).statement)
  }
}
