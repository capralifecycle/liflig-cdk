# WAF

`waf` holds one construct, `WebAcl`, and the values that describe its rules: `RuleSet`, `Rule`, `Match` and `Action`.

## Model

- One `WebAcl` per protected entry point (an ALB, an API Gateway REST API stage or a CloudFront distribution). A resource takes only one web ACL.
- Apps own `RuleSet` values. The platform stack that owns the entry point composes them into the `WebAcl`.
- Priority is the order of the rule sets, then the order of the rules in each set.
- Rule and metric names are `<ruleSet>-<rule>`, metrics are prefixed with the stack name (`metricNamePrefix`).
- A `RuleSet` with a `scope` (for example `Match.hostNames([...])`) only applies to the requests that match it. `Match.hostNames` takes exact host names and `*.example.com` for any subdomain (an `ENDS_WITH` match on `.example.com`, same WCU as an exact host); like a certificate, it does not match `example.com` itself, so list the apex separately. The scope is added inside each rule: custom rules match `AND(scope, match)`, managed and rate-based rules get it in their scope-down statement. Unscoped sets render their rules unchanged.
- Rule sets that share a name are merged when their rules are identical, so each app can pass the same shared set. The merged set applies to the requests matching any of the scopes, or to all requests if one occurrence is unscoped. The same name with different rules is an error. Empty sets are skipped with a warning.
- Rule sets are compared when the `WebAcl` is constructed, so a `Lazy` whose value is only set later is compared by its early value.
- Merging compares the rendered rules after tokens are resolved (the order of `ruleActionOverrides` does not matter), and scopes by their resolved value, so equal host lists from two apps do not produce `OR(a, a)`.
- Defaults: `defaultAction` has no default and must be chosen (`DefaultAction.allow()` or `DefaultAction.block()`). Web ACL name `${stackName}-web-acl`, log group `aws-waf-logs-${stackName}` with `ONE_MONTH` retention, and the `authorization` and `cookie` headers redacted. The log filter keeps requests that are blocked, counted, answered with CAPTCHA or challenge, or matched by a managed group rule overridden to count (`EXCLUDED_AS_COUNT`). Set `logging.logAllRequests` to log everything.
- Web ACL names, metric name prefixes and log group names must be unique. `WebAcl` throws at synth, naming the value, if another web ACL in the same stack already uses one of them. The defaults are taken by the first web ACL that uses them, so a second one needs its own `webAclName`, `metricNamePrefix` and (with logging enabled) `logging.logGroupName`.
- `metricBlockedRequests()`, `metricAllowedRequests()` and `metricCountedRequests()` use the web ACL's metric name (`<metricNamePrefix>-web-acl`) as the `WebACL` dimension.
- The library applies no rules by default.

## Choosing managed rule groups

Each web ACL includes 1,500 web ACL capacity units (WCU); rule groups count against that.

| Group | WCU | Notes |
| --- | --- | --- |
| `AWSManagedRulesAmazonIpReputationList` | 25 | Low false positives. The `AWSManagedIPDDoSList` rule only counts. Only useful where the web ACL sees the real client IP. |
| `AWSManagedRulesKnownBadInputsRuleSet` | 200 | Low false positives. Includes the Log4j and Java deserialization RCE rules, relevant for JVM (Kotlin/http4k) services. |
| `AWSManagedRulesCommonRuleSet` | 700 | Higher false positives: `SizeRestrictions_BODY` (bodies over 8 KB), `NoUserAgent_HEADER` (blocks server-to-server clients without a User-Agent), `GenericRFI_BODY` (URLs with IPs in bodies), `CrossSiteScripting_BODY` (rich text). Start in count mode or override these rules to count. |
| `AWSManagedRulesAnonymousIpList` | 50 | `HostingProviderIPList` blocks non-AWS cloud and hosting IPs, which breaks partner integrations that call APIs from other clouds. Use it for browser-facing apps only, deliberately. |
| `AWSManagedRulesAdminProtectionRuleSet` | 100 | Blocks admin-like paths. For third-party software. |
| Bot Control, ATP, ACFP, Anti-DDoS | | Paid per request. Opt in deliberately. |

## Cost

Prices are on-demand list prices from <https://aws.amazon.com/waf/pricing/>; check it for current numbers.

- $5.00 per web ACL per month, $1.00 per rule or rule group per month, $0.60 per million requests.
- Above the 1,500 WCU included in a web ACL: +$0.20 per million requests per 500 WCU.
- Body inspection above the default size: +$0.30 per million requests per extra 16 KB (CloudFront and API Gateway only; an ALB is fixed at 8 KB).

Scoping a rule set costs WCU, not money: rules stay $1.00 per month each. A host match is an exact byte match (2 WCU) plus 10 WCU for the `LOWERCASE` transformation, so **12 WCU per host, repeated in every scoped rule**. See the WCU of a byte match at <https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-string-match.html> (exactly and starts-with cost 2 WCU, plus 10 per text transformation).

`Match.pathPrefix` is a starts-with match (2 WCU) with `URL_DECODE` (10) and `NORMALIZE_PATH` (10): **22 WCU**, or 32 with `caseInsensitive`. That buys protection against `/%61dmin`, `//admin` and `/x/../admin` bypassing a path-scoped rule or rate limit.

The WCU numbers are upper bounds: AWS may optimise repeated statements.

## Caveats

- Behind CloudFront or API Gateway, a WAF on the ALB sees the proxy's IP. IP reputation, anonymous IP and per-IP rate limits belong at the edge.
- A rate limit on an ALB behind CloudFront or API Gateway counts the proxy's IP, and aggregating on `FORWARDED_IP` does not fix that: WAF reads the first address in `X-Forwarded-For`, which the client controls, so such limits can be bypassed. Put rate limits at the edge only (a `CLOUDFRONT` web ACL or the API Gateway stage).
- `logging.redactedHeaders` (default `authorization` and `cookie`) redacts those headers in the log. It does not hide matched data that rules inspecting all headers or all cookies write to the log, as `RedactedFields` cannot express that.
- Body inspection is limited: 8 KB fixed on an ALB, 16 KB by default on CloudFront and API Gateway (configurable up to 64 KB at extra cost).
- WAF supports API Gateway REST APIs, not HTTP APIs.
- A `CLOUDFRONT` web ACL must be created in us-east-1 and is attached through the distribution's `webAclId` (`webAclArn`); `attachTo` throws for it. One web ACL cannot serve both scopes: use two `WebAcl` instances and share the `RuleSet` values.

## Count first

Add new rules in count mode, `Rule.managed(..., { count: true })` or `ruleActionOverrides` for single rules of a group. Watch the logs (`COUNT` and `EXCLUDED_AS_COUNT` are kept by the default filter) and the `CountedRequests` metric (`webAcl.metricCountedRequests()`), then switch to block.

## Recipes

### 1. BFF (Hono/Remix) behind CloudFront, private ALB as VPC origin

The web ACL lives in a us-east-1 stack, and its ARN reaches the distribution's stack through `SsmParameterBackedResource`, which stores it in an SSM parameter in the app's region. The distribution therefore picks up the new ARN if the web ACL is ever replaced. The private ALB has no WAF.

VPC origin prerequisites: the ALB must be `internetFacing: false`, and its security group must allow the CloudFront origin-facing prefix list (or the `CloudFront-VPCOrigins-Service-SG` security group).

```ts
import { SsmParameterBackedResource, waf } from "@liflig/cdk"
import * as cdk from "aws-cdk-lib"
import * as cloudfront from "aws-cdk-lib/aws-cloudfront"
import * as origins from "aws-cdk-lib/aws-cloudfront-origins"
import type * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2"

const app = new cdk.App()
const env = { account: "123456789012" }

const edge = new cdk.Stack(app, "BffEdge", {
  env: { ...env, region: "us-east-1" },
})
const webAcl = new waf.WebAcl(edge, "WebAcl", {
  defaultAction: waf.DefaultAction.allow(),
  scope: "CLOUDFRONT",
  ruleSets: [
    new waf.RuleSet("Bff", {
      rules: [
        waf.Rule.managed("AWSManagedRulesAmazonIpReputationList"),
        waf.Rule.managed("AWSManagedRulesKnownBadInputsRuleSet"),
        waf.Rule.rateLimit("PerIp", { limit: 1000 }),
        waf.Rule.managed("AWSManagedRulesCommonRuleSet", { count: true }),
      ],
    }),
  ],
})
const webAclArn = new SsmParameterBackedResource(edge, "WebAclArn", {
  parameterName: "/bff/web-acl-arn",
  resource: webAcl.webAclArn,
  resourceToReference: (arn) => arn,
  referenceToResource: (_scope, _id, reference) => reference,
  regions: ["eu-west-1"],
})

declare const alb: elbv2.ApplicationLoadBalancer
const appStack = new cdk.Stack(app, "Bff", {
  env: { ...env, region: "eu-west-1" },
})
appStack.addDependency(edge)
new cloudfront.Distribution(appStack, "Distribution", {
  defaultBehavior: {
    origin: origins.VpcOrigin.withApplicationLoadBalancer(alb),
  },
  webAclId: webAclArn.get(appStack, "WebAclArn"),
})
```

### 2. API (Kotlin/http4k) behind a public ALB

```ts
import { waf } from "@liflig/cdk"
import * as cdk from "aws-cdk-lib"
import type * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2"

declare const stack: cdk.Stack
declare const alb: elbv2.ApplicationLoadBalancer

new waf.WebAcl(stack, "WebAcl", {
  defaultAction: waf.DefaultAction.allow(),
  ruleSets: [
    new waf.RuleSet("Api", {
      rules: [
        waf.Rule.managed("AWSManagedRulesAmazonIpReputationList"),
        waf.Rule.managed("AWSManagedRulesKnownBadInputsRuleSet"),
        waf.Rule.rateLimit("PerIp", { limit: 2000 }),
        waf.Rule.managed("AWSManagedRulesCommonRuleSet", {
          ruleActionOverrides: {
            SizeRestrictions_BODY: waf.Action.count(),
            NoUserAgent_HEADER: waf.Action.count(),
          },
        }),
      ],
    }),
  ],
}).attachTo(alb)
```

### 3. API behind API Gateway (REST) and a private ALB

Attach a regional web ACL to the stage by ARN. The ALB behind it sees the proxy's IP, so keep IP-based rules on the stage.

```ts
import { waf } from "@liflig/cdk"
import * as cdk from "aws-cdk-lib"
import type * as apigateway from "aws-cdk-lib/aws-apigateway"

declare const stack: cdk.Stack
declare const api: apigateway.RestApi

const webAcl = new waf.WebAcl(stack, "WebAcl", {
  defaultAction: waf.DefaultAction.allow(),
  ruleSets: [
    new waf.RuleSet("Api", {
      rules: [
        waf.Rule.managed("AWSManagedRulesAmazonIpReputationList"),
        waf.Rule.managed("AWSManagedRulesKnownBadInputsRuleSet"),
        waf.Rule.rateLimit("PerIp", { limit: 2000 }),
      ],
    }),
  ],
})
webAcl.attachTo(api.deploymentStage.stageArn)
```

### 4. Legacy shared public ALB with several apps

Each app exports a `RuleSet` scoped to its host names. The platform stack composes them.

```ts
import { waf } from "@liflig/cdk"
import * as cdk from "aws-cdk-lib"
import type * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2"

declare const stack: cdk.Stack
declare const alb: elbv2.ApplicationLoadBalancer

const shop = new waf.RuleSet("Shop", {
  scope: waf.Match.hostNames(["shop.example.com"]),
  rules: [
    waf.Rule.managed("AWSManagedRulesAmazonIpReputationList"),
    waf.Rule.managed("AWSManagedRulesKnownBadInputsRuleSet"),
  ],
})
const admin = new waf.RuleSet("Admin", {
  scope: waf.Match.hostNames(["admin.example.com"]),
  rules: [
    waf.Rule.rateLimit("Login", {
      limit: 100,
      evaluationWindow: cdk.Duration.minutes(1),
      scopeDown: waf.Match.pathPrefix("/login"),
    }),
  ],
})

new waf.WebAcl(stack, "WebAcl", {
  defaultAction: waf.DefaultAction.allow(),
  ruleSets: [shop, admin],
}).attachTo(alb)
```

## Sources

- <https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html>
- <https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-ip-rep.html>
- <https://aws.amazon.com/waf/pricing/>
- <https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statement-type-string-match.html>
- <https://docs.aws.amazon.com/waf/latest/developerguide/aws-waf-capacity-units.html>
- <https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-vpc-origins.html>
