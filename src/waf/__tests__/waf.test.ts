import assert from "node:assert/strict"
import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import * as cdk from "aws-cdk-lib"
import {
  Annotations,
  Match as AssertMatch,
  Template,
} from "aws-cdk-lib/assertions"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2"
import * as logs from "aws-cdk-lib/aws-logs"
import type * as wafv2 from "aws-cdk-lib/aws-wafv2"
import {
  Action,
  DefaultAction,
  Match,
  Rule,
  RuleSet,
  WebAcl,
  type WebAclProps,
} from "../index"
import { LegacyWebAcl } from "./fixtures/legacy-web-acl"

configureCdkSnapshots()

function setup(stackName = "Stack") {
  const app = new cdk.App()
  const stack = new cdk.Stack(app, stackName)
  return { app, stack }
}

function webAclTemplate(props: Partial<WebAclProps>, stackName?: string) {
  const { stack } = setup(stackName)
  const webAcl = new WebAcl(stack, "WebAcl", {
    defaultAction: DefaultAction.allow(),
    ruleSets: [],
    ...props,
  })
  return { stack, webAcl, template: Template.fromStack(stack) }
}

function rules(template: Template) {
  const [acl] = Object.values(template.findResources("AWS::WAFv2::WebACL"))
  return acl.Properties.Rules as any[]
}

const hostScope = Match.hostNames(["app.example.com"])
const geoBlock = Rule.custom("GeoBlock", {
  match: Match.not(Match.geo(["NO"])),
  action: Action.block(),
})

test("default web ACL", (t) => {
  const { stack, template } = webAclTemplate({
    ruleSets: [
      new RuleSet("Baseline", {
        rules: [
          Rule.managed("AWSManagedRulesAmazonIpReputationList"),
          Rule.managed("AWSManagedRulesKnownBadInputsRuleSet"),
        ],
      }),
    ],
  })

  t.assert.snapshot(cdkTemplate(stack))
  template.hasResourceProperties("AWS::WAFv2::WebACL", {
    Name: "Stack-web-acl",
    Scope: "REGIONAL",
    DefaultAction: { Allow: {} },
    VisibilityConfig: {
      CloudWatchMetricsEnabled: true,
      SampledRequestsEnabled: true,
      MetricName: "Stack-web-acl",
    },
  })
  assert.deepEqual(
    rules(template).map((r) => [r.Priority, r.Name]),
    [
      [0, "Baseline-AWSManagedRulesAmazonIpReputationList"],
      [1, "Baseline-AWSManagedRulesKnownBadInputsRuleSet"],
    ],
  )
  template.resourceCountIs("AWS::WAFv2::WebACLAssociation", 0)
})

test("unscoped rules render their statements unchanged", () => {
  const { template } = webAclTemplate({
    ruleSets: [
      new RuleSet("App", {
        rules: [
          geoBlock,
          Rule.managed("AWSManagedRulesCommonRuleSet"),
          Rule.rateLimit("Limit", { limit: 100 }),
        ],
      }),
    ],
  })

  const [geo, common, limit] = rules(template)
  assert.equal(rules(template).length, 3)
  assert.deepEqual(geo.Statement, {
    NotStatement: {
      Statement: { GeoMatchStatement: { CountryCodes: ["NO"] } },
    },
  })
  assert.equal(
    common.Statement.ManagedRuleGroupStatement.ScopeDownStatement,
    undefined,
  )
  assert.equal(limit.Statement.RateBasedStatement.ScopeDownStatement, undefined)
})

test("scoped rules combine the scope with each rule", (t) => {
  const { stack } = setup("core")
  const vpc = new ec2.Vpc(stack, "VPC")
  const loadBalancer = new elbv2.ApplicationLoadBalancer(
    stack,
    "LoadBalancer",
    { vpc },
  )
  const webAcl = new WebAcl(stack, "WebAcl", {
    defaultAction: DefaultAction.allow(),
    ruleSets: [
      new RuleSet("App", {
        scope: Match.hostNames(["Shop.example.com", "shop.example.org"]),
        rules: [
          geoBlock,
          Rule.managed("AWSManagedRulesAmazonIpReputationList"),
          Rule.managed("AWSManagedRulesCommonRuleSet", {
            ruleActionOverrides: { SizeRestrictions_BODY: Action.count() },
            scopeDown: Match.pathPrefix("/api"),
          }),
          Rule.rateLimit("Login", {
            limit: 100,
            evaluationWindow: cdk.Duration.minutes(1),
          }),
          Rule.rateLimit("Api", {
            limit: 1000,
            scopeDown: Match.pathPrefix("/api"),
          }),
        ],
      }),
    ],
  })
  webAcl.attachTo(loadBalancer)

  t.assert.snapshot(cdkTemplate(stack))
  const template = Template.fromStack(stack)
  const hostLiteral = (host: string) => ({
    ByteMatchStatement: {
      FieldToMatch: { SingleHeader: { Name: "host" } },
      PositionalConstraint: "EXACTLY",
      SearchString: host,
      TextTransformations: [{ Priority: 0, Type: "LOWERCASE" }],
    },
  })
  const shopScope = {
    OrStatement: {
      Statements: [
        hostLiteral("shop.example.com"),
        hostLiteral("shop.example.org"),
      ],
    },
  }
  const [geo, ipRep, common, login, api] = rules(template)

  assert.deepEqual(geo.Statement.AndStatement.Statements[0], shopScope)
  assert.deepEqual(geo.Statement.AndStatement.Statements[1], {
    NotStatement: {
      Statement: { GeoMatchStatement: { CountryCodes: ["NO"] } },
    },
  })
  assert.deepEqual(
    ipRep.Statement.ManagedRuleGroupStatement.ScopeDownStatement,
    shopScope,
  )
  const commonScope =
    common.Statement.ManagedRuleGroupStatement.ScopeDownStatement
  assert.deepEqual(commonScope.AndStatement.Statements[0], shopScope)
  assert.equal(
    commonScope.AndStatement.Statements[1].ByteMatchStatement.SearchString,
    "/api",
  )
  assert.deepEqual(
    login.Statement.RateBasedStatement.ScopeDownStatement,
    shopScope,
  )
  assert.equal(
    api.Statement.RateBasedStatement.ScopeDownStatement.AndStatement.Statements
      .length,
    2,
  )
  assert.equal(login.Statement.RateBasedStatement.EvaluationWindowSec, 60)
  assert.deepEqual(login.Action, { Block: {} })
  assert.equal(
    rules(template).some((r) => /Scope$/.test(r.Name)),
    false,
  )
  template.hasResourceProperties("AWS::Logs::LogGroup", {
    LogGroupName: "aws-waf-logs-core",
    RetentionInDays: 30,
  })
})

test("migration from LegacyWebAcl keeps names, ids and rules", () => {
  const hostNames = ["App.example.com", "app.example.org"]
  const limitScope = Match.pathPrefix("/login")
  const arn =
    "arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/a/1"

  const old = new cdk.Stack(new cdk.App(), "core")
  new LegacyWebAcl(old, "Waf", {
    loadBalancerArn: arn,
    logRetention: logs.RetentionDays.ONE_MONTH,
    ruleSets: [
      {
        name: "App",
        hostNames,
        rules: [
          {
            name: "GeoBlock",
            action: { block: {} },
            statement: Match.not(Match.geo(["NO"])).render(),
          },
          {
            name: "AWSManagedRulesCommonRuleSet",
            overrideAction: { none: {} },
            statement: {
              managedRuleGroupStatement: {
                vendorName: "AWS",
                name: "AWSManagedRulesCommonRuleSet",
                ruleActionOverrides: [
                  { name: "SizeRestrictions_BODY", actionToUse: { count: {} } },
                ],
              },
            },
          },
          {
            name: "Login",
            action: { block: {} },
            statement: {
              rateBasedStatement: {
                limit: 100,
                evaluationWindowSec: 300,
                aggregateKeyType: "IP",
                scopeDownStatement: limitScope.render(),
              },
            },
          },
        ],
      },
    ],
  })

  const next = new cdk.Stack(new cdk.App(), "core")
  new WebAcl(next, "Waf", {
    defaultAction: DefaultAction.allow(),
    ruleSets: [
      new RuleSet("App", {
        scope: Match.hostNames(hostNames),
        rules: [
          geoBlock,
          Rule.managed("AWSManagedRulesCommonRuleSet", {
            ruleActionOverrides: { SizeRestrictions_BODY: Action.count() },
          }),
          Rule.rateLimit("Login", { limit: 100, scopeDown: limitScope }),
        ],
      }),
    ],
  }).attachTo(arn)

  const oldTemplate = Template.fromStack(old)
  const nextTemplate = Template.fromStack(next)
  const types = [
    "AWS::WAFv2::WebACL",
    "AWS::WAFv2::WebACLAssociation",
    "AWS::Logs::LogGroup",
    "AWS::WAFv2::LoggingConfiguration",
  ]
  for (const type of types) {
    const ids = Object.keys(nextTemplate.findResources(type))
    assert.equal(ids.length, 1, type)
    assert.deepEqual(ids, Object.keys(oldTemplate.findResources(type)), type)
  }

  const [oldAcl] = Object.values(
    oldTemplate.findResources("AWS::WAFv2::WebACL"),
  )
  const [newAcl] = Object.values(
    nextTemplate.findResources("AWS::WAFv2::WebACL"),
  )
  assert.equal(newAcl.Properties.Name, "core-web-acl")
  assert.equal(newAcl.Properties.Name, oldAcl.Properties.Name)
  assert.deepEqual(
    newAcl.Properties.VisibilityConfig,
    oldAcl.Properties.VisibilityConfig,
  )
  assert.deepEqual(newAcl.Properties.Rules, oldAcl.Properties.Rules)
  assert.deepEqual(
    newAcl.Properties.Rules.map((r: any) => r.VisibilityConfig.MetricName),
    [
      "core-App-GeoBlock",
      "core-App-AWSManagedRulesCommonRuleSet",
      "core-App-Login",
    ],
  )

  const [oldLogGroup] = Object.values(
    oldTemplate.findResources("AWS::Logs::LogGroup"),
  )
  const [newLogGroup] = Object.values(
    nextTemplate.findResources("AWS::Logs::LogGroup"),
  )
  assert.equal(newLogGroup.Properties.LogGroupName, "aws-waf-logs-core")
  assert.equal(
    newLogGroup.Properties.LogGroupName,
    oldLogGroup.Properties.LogGroupName,
  )

  // The new filter also keeps CAPTCHA, CHALLENGE and EXCLUDED_AS_COUNT.
  const filterConditions = (template: Template) => {
    const [config] = Object.values(
      template.findResources("AWS::WAFv2::LoggingConfiguration"),
    )
    assert.equal(config.Properties.LoggingFilter.DefaultBehavior, "DROP")
    return config.Properties.LoggingFilter.Filters[0].Conditions
  }
  assert.deepEqual(
    filterConditions(nextTemplate).slice(0, 2),
    filterConditions(oldTemplate),
  )
})

test("log filter keeps blocked, counted, captcha, challenge and excluded as count", () => {
  const { template } = webAclTemplate({})
  const [config] = Object.values(
    template.findResources("AWS::WAFv2::LoggingConfiguration"),
  )
  assert.deepEqual(
    config.Properties.LoggingFilter.Filters[0].Conditions.map(
      (c: any) => c.ActionCondition.Action,
    ),
    ["BLOCK", "COUNT", "CAPTCHA", "CHALLENGE", "EXCLUDED_AS_COUNT"],
  )
})

test("attachTo names the first association Association, then numbers", () => {
  const { stack } = setup()
  const webAcl = new WebAcl(stack, "WebAcl", {
    defaultAction: DefaultAction.allow(),
    ruleSets: [],
  })
  webAcl.attachTo(
    "arn:aws:elasticloadbalancing:eu-west-1:123456789012:loadbalancer/app/a/1",
  )
  webAcl.attachTo("arn:aws:apigateway:eu-west-1::/restapis/abc/stages/prod")

  const template = Template.fromStack(stack)
  template.resourceCountIs("AWS::WAFv2::WebACLAssociation", 2)
  const ids = Object.keys(
    template.findResources("AWS::WAFv2::WebACLAssociation"),
  )
  assert.match(ids[0], /^WebAclAssociation[0-9A-F]{8}$/)
  assert.match(ids[1], /^WebAclAssociation2[0-9A-F]{8}$/)
  assert.equal(
    webAcl.node.tryFindChild("Association") !== undefined &&
      webAcl.node.tryFindChild("Association2") !== undefined,
    true,
  )
})

test("attachTo accepts an application load balancer", () => {
  const { stack } = setup()
  const vpc = new ec2.Vpc(stack, "VPC")
  const alb = new elbv2.ApplicationLoadBalancer(stack, "Alb", { vpc })
  new WebAcl(stack, "WebAcl", {
    defaultAction: DefaultAction.allow(),
    ruleSets: [],
  }).attachTo(alb)
  Template.fromStack(stack).hasResourceProperties(
    "AWS::WAFv2::WebACLAssociation",
    { ResourceArn: { Ref: AssertMatch.stringLikeRegexp("^Alb") } },
  )
})

test("attachTo throws for CLOUDFRONT", () => {
  const stack = new cdk.Stack(new cdk.App(), "Edge", {
    env: { account: "123456789012", region: "us-east-1" },
  })
  const webAcl = new WebAcl(stack, "WebAcl", {
    defaultAction: DefaultAction.allow(),
    ruleSets: [],
    scope: "CLOUDFRONT",
  })
  assert.throws(() => webAcl.attachTo("arn:aws:x"), /webAclId/)
})

test("Match.statement rejects statements that cannot be nested", () => {
  const managed = {
    managedRuleGroupStatement: { vendorName: "AWS", name: "X" },
  }
  const rate = {
    rateBasedStatement: { limit: 100, aggregateKeyType: "IP" },
  }
  const reference = { ruleGroupReferenceStatement: { arn: "arn:aws:x" } }
  for (const statement of [managed, rate, reference]) {
    assert.throws(
      () => Match.statement(statement),
      /Rule\.managed or Rule\.rateLimit/,
    )
    assert.throws(
      () =>
        Match.statement({
          andStatement: {
            statements: [
              { geoMatchStatement: { countryCodes: ["NO"] } },
              statement,
            ],
          },
        }),
      /cannot be used in Match\.statement/,
    )
    assert.throws(
      () => Match.statement({ notStatement: { statement } }),
      /cannot be used in Match\.statement/,
    )
    assert.throws(
      () =>
        Match.statement({
          orStatement: { statements: [{ notStatement: { statement } }] },
        }),
      /cannot be used in Match\.statement/,
    )
  }
  assert.doesNotThrow(() =>
    Match.statement({ geoMatchStatement: { countryCodes: ["NO"] } }),
  )
})

test("rate limit validation", () => {
  assert.throws(() => Rule.rateLimit("L", { limit: 9 }), /limit must be/)
  assert.throws(() => Rule.rateLimit("L", { limit: 10.5 }), /limit must be/)
  assert.throws(
    () => Rule.rateLimit("L", { limit: 2_000_000_001 }),
    /limit must be/,
  )
  assert.doesNotThrow(() => Rule.rateLimit("L", { limit: 10 }))
  assert.throws(
    () => Rule.rateLimit("L", { limit: 100, aggregateKeyType: "FORWARDED_IP" }),
    /requires forwardedIpConfig/,
  )
  assert.doesNotThrow(() =>
    Rule.rateLimit("L", {
      limit: 100,
      aggregateKeyType: "FORWARDED_IP",
      forwardedIpConfig: {
        headerName: "X-Forwarded-For",
        fallbackBehavior: "MATCH",
      },
    }),
  )
  assert.throws(
    () => Rule.rateLimit("L", { limit: 100, action: Action.allow() }),
    /allow/,
  )
})

test("pathPrefix transformations", () => {
  assert.deepEqual(Match.pathPrefix("/Api").render(), {
    byteMatchStatement: {
      fieldToMatch: { uriPath: {} },
      positionalConstraint: "STARTS_WITH",
      searchString: "/Api",
      textTransformations: [
        { priority: 0, type: "URL_DECODE" },
        { priority: 1, type: "NORMALIZE_PATH" },
      ],
    },
  })
  assert.deepEqual(
    Match.pathPrefix("/Api", { caseInsensitive: true }).render(),
    {
      byteMatchStatement: {
        fieldToMatch: { uriPath: {} },
        positionalConstraint: "STARTS_WITH",
        searchString: "/api",
        textTransformations: [
          { priority: 0, type: "URL_DECODE" },
          { priority: 1, type: "NORMALIZE_PATH" },
          { priority: 2, type: "LOWERCASE" },
        ],
      },
    },
  )
})

test("managed rule groups from other vendors", () => {
  const { template } = webAclTemplate({
    ruleSets: [
      new RuleSet("App", {
        rules: [
          Rule.managed("SomeGroup", { vendorName: "Vendor", name: "Custom" }),
          Rule.managed("AWSManagedRulesCommonRuleSet", { count: true }),
        ],
      }),
    ],
  })
  const [vendor, common] = rules(template)
  assert.equal(vendor.Name, "App-Custom")
  assert.deepEqual(vendor.Statement.ManagedRuleGroupStatement, {
    VendorName: "Vendor",
    Name: "SomeGroup",
  })
  assert.equal(common.Statement.ManagedRuleGroupStatement.VendorName, "AWS")
  assert.deepEqual(common.OverrideAction, { Count: {} })
})

test("empty rule set is skipped with a warning", () => {
  const { stack, template } = webAclTemplate({
    ruleSets: [
      new RuleSet("Empty", { rules: [] }),
      new RuleSet("App", { rules: [geoBlock] }),
    ],
  })
  assert.deepEqual(
    rules(template).map((r) => r.Name),
    ["App-GeoBlock"],
  )
  Annotations.fromStack(stack).hasWarning(
    "*",
    AssertMatch.stringLikeRegexp("rule set 'Empty'"),
  )
})

test("rule sets with the same name and rules are merged", () => {
  const set = (scope?: Match) =>
    new RuleSet("Shared", { scope, rules: [geoBlock] })
  const other = new RuleSet("Other", {
    rules: [Rule.managed("AWSManagedRulesCommonRuleSet")],
  })

  const { template } = webAclTemplate({
    ruleSets: [
      set(Match.hostNames(["a.example.com"])),
      other,
      set(Match.hostNames(["b.example.com"])),
    ],
  })
  const merged = rules(template)
  assert.deepEqual(
    merged.map((r) => r.Name),
    ["Shared-GeoBlock", "Other-AWSManagedRulesCommonRuleSet"],
  )
  const [scope] = merged[0].Statement.AndStatement.Statements
  assert.equal(scope.OrStatement.Statements.length, 2)
  assert.equal(
    scope.OrStatement.Statements[0].ByteMatchStatement.SearchString,
    "a.example.com",
  )
  assert.equal(
    scope.OrStatement.Statements[1].ByteMatchStatement.SearchString,
    "b.example.com",
  )

  const unscoped = webAclTemplate({
    ruleSets: [set(Match.hostNames(["a.example.com"])), set()],
  })
  assert.deepEqual(rules(unscoped.template)[0].Statement, {
    NotStatement: {
      Statement: { GeoMatchStatement: { CountryCodes: ["NO"] } },
    },
  })
  assert.equal(rules(unscoped.template).length, 1)
})

test("rule sets with the same name and different rules throw", () => {
  assert.throws(
    () =>
      webAclTemplate({
        ruleSets: [
          new RuleSet("A", { rules: [geoBlock] }),
          new RuleSet("A", {
            rules: [
              Rule.custom("GeoBlock", {
                match: Match.geo(["SE"]),
                action: Action.block(),
              }),
            ],
          }),
        ],
      }),
    /Duplicate WAF rule set name 'A' with different rules/,
  )
})

test("default action, response bodies and overrides", () => {
  const { template } = webAclTemplate({
    ruleSets: [],
    defaultAction: DefaultAction.block({
      customResponse: { responseCode: 403, customResponseBodyKey: "denied" },
    }),
    customResponseBodies: {
      denied: { contentType: "TEXT_PLAIN", content: "denied" },
    },
    overrideWebAclProps: { description: "custom" },
  })

  template.hasResourceProperties("AWS::WAFv2::WebACL", {
    DefaultAction: {
      Block: {
        CustomResponse: { ResponseCode: 403, CustomResponseBodyKey: "denied" },
      },
    },
    Description: "custom",
    Rules: [],
  })
})

test("logging defaults", () => {
  const { template, webAcl } = webAclTemplate({})

  assert.ok(webAcl.logGroup)
  template.hasResourceProperties("AWS::WAFv2::LoggingConfiguration", {
    LogDestinationConfigs: [
      { "Fn::GetAtt": [AssertMatch.stringLikeRegexp("LogGroup"), "Arn"] },
    ],
    RedactedFields: [
      { SingleHeader: { Name: "authorization" } },
      { SingleHeader: { Name: "cookie" } },
    ],
    LoggingFilter: {
      DefaultBehavior: "DROP",
      Filters: [
        {
          Behavior: "KEEP",
          Requirement: "MEETS_ANY",
          Conditions: [
            { ActionCondition: { Action: "BLOCK" } },
            { ActionCondition: { Action: "COUNT" } },
            { ActionCondition: { Action: "CAPTCHA" } },
            { ActionCondition: { Action: "CHALLENGE" } },
            { ActionCondition: { Action: "EXCLUDED_AS_COUNT" } },
          ],
        },
      ],
    },
  })
})

test("logging options", () => {
  const { template } = webAclTemplate({
    logging: {
      logAllRequests: true,
      redactedHeaders: [],
      logGroupName: "aws-waf-logs-custom",
      retention: logs.RetentionDays.ONE_WEEK,
    },
  })

  template.hasResourceProperties("AWS::Logs::LogGroup", {
    LogGroupName: "aws-waf-logs-custom",
    RetentionInDays: 7,
  })
  const [config] = Object.values(
    template.findResources("AWS::WAFv2::LoggingConfiguration"),
  )
  assert.equal(config.Properties.LoggingFilter, undefined)
  assert.equal(config.Properties.RedactedFields, undefined)
})

test("logging disabled creates no log group", () => {
  const { template, webAcl } = webAclTemplate({ logging: { enabled: false } })

  assert.equal(webAcl.logGroup, undefined)
  template.resourceCountIs("AWS::Logs::LogGroup", 0)
  template.resourceCountIs("AWS::WAFv2::LoggingConfiguration", 0)
})

test("log group name must start with aws-waf-logs-", () => {
  assert.throws(
    () => webAclTemplate({ logging: { logGroupName: "my-logs" } }),
    /must start with 'aws-waf-logs-'/,
  )
})

test("CLOUDFRONT metrics have no Region dimension", () => {
  const stack = new cdk.Stack(new cdk.App(), "Edge", {
    env: { account: "123456789012", region: "us-east-1" },
  })
  const webAcl = new WebAcl(stack, "WebAcl", {
    defaultAction: DefaultAction.allow(),
    ruleSets: [],
    scope: "CLOUDFRONT",
  })
  assert.deepEqual(webAcl.metricBlockedRequests().dimensions, {
    WebACL: "Edge-web-acl",
    Rule: "ALL",
  })
})

test("REGIONAL metrics have a Region dimension", () => {
  const { webAcl } = webAclTemplate({})
  assert.deepEqual(
    Object.keys(webAcl.metricBlockedRequests().dimensions ?? {}),
    ["WebACL", "Rule", "Region"],
  )
})

test("CLOUDFRONT scope needs us-east-1", () => {
  const stackIn = (region: string) =>
    new cdk.Stack(new cdk.App(), "Edge", {
      env: { account: "123456789012", region },
    })
  assert.throws(
    () =>
      new WebAcl(stackIn("eu-west-1"), "WebAcl", {
        defaultAction: DefaultAction.allow(),
        ruleSets: [],
        scope: "CLOUDFRONT",
      }),
    /us-east-1/,
  )

  const stack = stackIn("us-east-1")
  new WebAcl(stack, "WebAcl", {
    defaultAction: DefaultAction.allow(),
    ruleSets: [],
    scope: "CLOUDFRONT",
  })
  Template.fromStack(stack).hasResourceProperties("AWS::WAFv2::WebACL", {
    Scope: "CLOUDFRONT",
  })
})

test("CLOUDFRONT scope warns when the region is unknown", () => {
  const { stack } = setup()
  new WebAcl(stack, "WebAcl", {
    defaultAction: DefaultAction.allow(),
    ruleSets: [],
    scope: "CLOUDFRONT",
  })
  Annotations.fromStack(stack).hasWarning(
    "*",
    AssertMatch.stringLikeRegexp("us-east-1"),
  )
})

test("validation errors", () => {
  const custom = (name: string) =>
    Rule.custom(name, { match: Match.geo(["NO"]), action: Action.block() })

  assert.throws(
    () =>
      webAclTemplate({
        ruleSets: [new RuleSet("A", { rules: [custom("bad name")] })],
      }),
    /Invalid WAF rule name 'A-bad name'/,
  )
  assert.throws(
    () =>
      webAclTemplate({
        ruleSets: [new RuleSet("A", { rules: [custom("x"), custom("x")] })],
      }),
    /Duplicate WAF rule name 'A-x'/,
  )
  assert.throws(
    () =>
      webAclTemplate({
        ruleSets: [new RuleSet("A", { rules: [custom("x".repeat(127))] })],
      }),
    /Invalid WAF rule name/,
  )
  assert.throws(
    () => webAclTemplate({ metricNamePrefix: "bad prefix" }),
    /Invalid WAF metric name/,
  )
  assert.throws(
    () => Rule.rateLimit("Limit", { limit: 10, action: Action.allow() }),
    /cannot use the allow action/,
  )
  assert.throws(
    () =>
      Rule.rateLimit("Limit", {
        limit: 10,
        evaluationWindow: cdk.Duration.seconds(90),
      }),
    /evaluation window/,
  )
  assert.throws(() => Match.hostNames([]), /at least one host name/)
  assert.throws(() => Match.and(), /at least one/)
  assert.throws(() => Match.or(), /at least one/)
})

test("hostNames: a leading *. matches subdomains with ENDS_WITH", () => {
  const or = Match.hostNames(["*.Example.com", "example.com"]).render()
    .orStatement as wafv2.CfnWebACL.OrStatementProperty
  const [wild, apex] = or.statements as wafv2.CfnWebACL.StatementProperty[]
  const byte = (s: wafv2.CfnWebACL.StatementProperty) =>
    s.byteMatchStatement as wafv2.CfnWebACL.ByteMatchStatementProperty
  assert.equal(byte(wild).positionalConstraint, "ENDS_WITH")
  assert.equal(byte(wild).searchString, ".example.com")
  assert.equal(byte(apex).positionalConstraint, "EXACTLY")
  assert.equal(byte(apex).searchString, "example.com")
  assert.throws(() => Match.hostNames(["api.*.example.com"]), /leading '\*\.'/)
  assert.throws(() => Match.hostNames(["*example.com"]), /leading '\*\.'/)
})

test("and and or with a single match return it", () => {
  const geo = Match.geo(["NO"])
  assert.equal(Match.and(geo), geo)
  assert.equal(Match.or(geo), geo)
})

test("metrics use the web ACL name", () => {
  const { webAcl } = webAclTemplate({})
  const metric = webAcl.metricBlockedRequests()
  assert.equal(metric.metricName, "BlockedRequests")
  assert.equal(metric.namespace, "AWS/WAFV2")
  assert.equal(webAcl.metricAllowedRequests().metricName, "AllowedRequests")
  assert.equal(webAcl.metricCountedRequests().metricName, "CountedRequests")
})

test("metrics use the web ACL metric name as the WebACL dimension", () => {
  const { template, webAcl } = webAclTemplate({
    webAclName: "my-acl",
    metricNamePrefix: "my-metrics",
  })
  template.hasResourceProperties("AWS::WAFv2::WebACL", {
    Name: "my-acl",
    VisibilityConfig: { MetricName: "my-metrics-web-acl" },
  })
  assert.equal(
    webAcl.metricBlockedRequests().dimensions?.WebACL,
    "my-metrics-web-acl",
  )
  assert.equal(
    webAcl.metricCountedRequests().dimensions?.WebACL,
    "my-metrics-web-acl",
  )
})

test("a second web ACL in a stack may use the defaults when the first is named", () => {
  const { stack } = setup()
  new WebAcl(stack, "First", {
    defaultAction: DefaultAction.allow(),
    ruleSets: [],
    webAclName: "first",
    metricNamePrefix: "first",
    logging: { logGroupName: "aws-waf-logs-first" },
  })
  new WebAcl(stack, "Second", {
    defaultAction: DefaultAction.allow(),
    ruleSets: [],
  })
  Template.fromStack(stack).resourceCountIs("AWS::WAFv2::WebACL", 2)
})

test("two web ACLs in a stack with default names clash on the web ACL name", () => {
  const { stack } = setup()
  new WebAcl(stack, "First", {
    defaultAction: DefaultAction.allow(),
    ruleSets: [],
  })
  assert.throws(
    () =>
      new WebAcl(stack, "Second", {
        defaultAction: DefaultAction.allow(),
        ruleSets: [],
      }),
    /web ACL name 'Stack-web-acl'/,
  )
})

test("a second web ACL reusing a taken name throws and names the value", () => {
  const { stack } = setup()
  new WebAcl(stack, "First", {
    defaultAction: DefaultAction.allow(),
    ruleSets: [],
    webAclName: "first",
    metricNamePrefix: "first",
    logging: { logGroupName: "aws-waf-logs-first" },
  })
  let attempt = 0
  const second = (props: Partial<WebAclProps>) => () =>
    new WebAcl(stack, `Second${attempt++}`, {
      defaultAction: DefaultAction.allow(),
      ruleSets: [],
      webAclName: "second",
      metricNamePrefix: "second",
      logging: { logGroupName: "aws-waf-logs-second" },
      ...props,
    })
  assert.throws(second({ webAclName: "first" }), /web ACL name 'first'/)
  assert.throws(
    second({ metricNamePrefix: "first" }),
    /metric name prefix 'first'/,
  )
  assert.throws(
    second({ logging: { logGroupName: "aws-waf-logs-first" } }),
    /log group name 'aws-waf-logs-first'/,
  )
  second({ logging: { enabled: false } })()
  Template.fromStack(stack).resourceCountIs("AWS::WAFv2::WebACL", 2)
})

test("merged scope and scopeDown on a rate limit render AND(OR(hosts), scopeDown)", () => {
  const set = (host: string) =>
    new RuleSet("Shared", {
      scope: Match.hostNames([host]),
      rules: [
        Rule.rateLimit("Login", {
          limit: 100,
          scopeDown: Match.pathPrefix("/login"),
        }),
      ],
    })
  const { template } = webAclTemplate({
    ruleSets: [set("a.example.com"), set("b.example.com")],
  })

  const [rule] = rules(template)
  const scopeDown = rule.Statement.RateBasedStatement.ScopeDownStatement
  assert.equal(scopeDown.AndStatement.Statements.length, 2)
  const [hosts, path] = scopeDown.AndStatement.Statements
  assert.deepEqual(
    hosts.OrStatement.Statements.map(
      (s: any) => s.ByteMatchStatement.SearchString,
    ),
    ["a.example.com", "b.example.com"],
  )
  assert.equal(path.ByteMatchStatement.FieldToMatch.UriPath !== undefined, true)
})

test("merging folds equal sets into one", () => {
  const set = (scope?: Match) =>
    new RuleSet("Shared", { scope, rules: [geoBlock] })

  const two = webAclTemplate({
    ruleSets: [
      set(Match.hostNames(["a.example.com"])),
      set(Match.hostNames(["b.example.com"])),
    ],
  })
  assert.equal(rules(two.template).length, 1)
  const [scope] = rules(two.template)[0].Statement.AndStatement.Statements
  assert.equal(scope.OrStatement.Statements.length, 2)

  // Equal scopes given as separate objects do not produce OR(a, a).
  const equal = webAclTemplate({
    ruleSets: [
      set(Match.hostNames(["a.example.com"])),
      set(Match.hostNames(["a.example.com"])),
    ],
  })
  assert.equal(rules(equal.template).length, 1)
  const [single] = rules(equal.template)[0].Statement.AndStatement.Statements
  assert.equal(single.OrStatement, undefined)
  assert.equal(single.ByteMatchStatement.SearchString, "a.example.com")
})

test("merging ignores the order of rule action overrides", () => {
  const set = (overrides: Record<string, Action>) =>
    new RuleSet("Shared", {
      rules: [
        Rule.managed("AWSManagedRulesCommonRuleSet", {
          ruleActionOverrides: overrides,
        }),
      ],
    })
  const { template } = webAclTemplate({
    ruleSets: [
      set({ A: Action.count(), B: Action.count() }),
      set({ B: Action.count(), A: Action.count() }),
    ],
  })
  assert.equal(rules(template).length, 1)
  assert.deepEqual(
    rules(
      template,
    )[0].Statement.ManagedRuleGroupStatement.RuleActionOverrides.map(
      (o: any) => o.Name,
    ),
    ["A", "B"],
  )
})

test("merging compares resolved values of Lazy values", () => {
  const set = (limit: number) =>
    new RuleSet("Shared", {
      rules: [
        Rule.rateLimit("Limit", {
          limit: cdk.Lazy.number({ produce: () => limit }),
        }),
      ],
    })

  const same = webAclTemplate({ ruleSets: [set(100), set(100)] })
  assert.equal(rules(same.template).length, 1)
  assert.throws(
    () => webAclTemplate({ ruleSets: [set(100), set(200)] }),
    /different rules/,
  )
})
