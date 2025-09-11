import "@aws-cdk/assert/jest"
import * as cdk from "aws-cdk-lib"
import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as logs from "aws-cdk-lib/aws-logs"
import "jest-cdk-snapshot"
import { LoadBalancer } from "../../load-balancer"
import {
  AwsManagedRules,
  ManagedRuleGroupBuilder,
  RuleBuilder,
  Waf,
  WafIpSet,
  WafRegexPatternSet,
} from "../index"

test("create basic WAF with default settings", () => {
  const app = new cdk.App()
  const stack = new cdk.Stack(app, "Stack")

  new Waf(stack, "TestWaf")

  const template = app.synth().getStackByName(stack.stackName).template
  expect(template).toMatchSnapshot()
  expect(template).toHaveResourceLike("AWS::WAFv2::WebACL", {
    Scope: "REGIONAL",
    DefaultAction: {
      Allow: {},
    },
    VisibilityConfig: {
      SampledRequestsEnabled: true,
      CloudWatchMetricsEnabled: true,
    },
  })
})

test("create WAF with managed rule groups", () => {
  const app = new cdk.App()
  const stack = new cdk.Stack(app, "Stack")

  new Waf(stack, "TestWaf", {
    name: "MyWebACL",
    description: "Test Web ACL with managed rules",
    managedRuleGroups: [
      ManagedRuleGroupBuilder.coreRuleSet(10),
      ManagedRuleGroupBuilder.knownBadInputs(20),
      ManagedRuleGroupBuilder.sqlDatabase(30),
      {
        name: AwsManagedRules.BOT_CONTROL,
        vendor: "AWS",
        priority: 40,
        overrideAction: "COUNT",
      },
    ],
  })

  const template = app.synth().getStackByName(stack.stackName).template
  expect(template).toMatchSnapshot()
  expect(template).toHaveResourceLike("AWS::WAFv2::WebACL", {
    Name: "MyWebACL",
    Description: "Test Web ACL with managed rules",
  })
})

test("create WAF with custom rules", () => {
  const app = new cdk.App()
  const stack = new cdk.Stack(app, "Stack")

  const ipSet = new WafIpSet(stack, "AllowedIPs", {
    addresses: ["192.168.1.0/24", "10.0.0.0/8"],
    description: "Allowed IP addresses",
  })

  new Waf(stack, "TestWaf", {
    name: "CustomRulesWebACL",
    customRules: [
      RuleBuilder.blockPath("/admin", 1),
      RuleBuilder.blockPath("/wp-admin", 2),
      RuleBuilder.allowPath("/public", 3),
      RuleBuilder.rateLimit(2000, 5, { aggregateKeyType: "IP" }),
      RuleBuilder.geoBlock(["CN", "RU", "KP"], 10),
      RuleBuilder.ipAllowlist(ipSet.arn, 15),
    ],
    defaultAction: "BLOCK",
  })

  const template = app.synth().getStackByName(stack.stackName).template
  expect(template).toMatchSnapshot()
  expect(template).toHaveResourceLike("AWS::WAFv2::WebACL", {
    Name: "CustomRulesWebACL",
    DefaultAction: {
      Block: {},
    },
  })
})

test("create WAF with both managed and custom rules", () => {
  const app = new cdk.App()
  const stack = new cdk.Stack(app, "Stack")

  new Waf(stack, "TestWaf", {
    name: "MixedRulesWebACL",
    managedRuleGroups: [
      ManagedRuleGroupBuilder.coreRuleSet(100),
      ManagedRuleGroupBuilder.botControl(110, {
        excludedRules: ["SignalNonBrowserUserAgent"],
      }),
    ],
    customRules: [
      RuleBuilder.blockPath("/api/internal", 1),
      RuleBuilder.rateLimit(1000, 5, {
        aggregateKeyType: "FORWARDED_IP",
        action: "CAPTCHA",
      }),
    ],
  })

  const template = app.synth().getStackByName(stack.stackName).template
  expect(template).toMatchSnapshot()
})

test("create WAF with logging enabled", () => {
  const app = new cdk.App()
  const stack = new cdk.Stack(app, "Stack")

  new Waf(stack, "TestWaf", {
    name: "LoggingEnabledWebACL",
    enableLogging: true,
    logRetention: logs.RetentionDays.TWO_WEEKS,
  })

  const template = app.synth().getStackByName(stack.stackName).template
  expect(template).toMatchSnapshot()
  expect(template).toHaveResourceLike("AWS::S3::Bucket", {
    BucketEncryption: {
      ServerSideEncryptionConfiguration: [
        {
          ServerSideEncryptionByDefault: {
            SSEAlgorithm: "AES256",
          },
        },
      ],
    },
  })
  expect(template).toHaveResourceLike("AWS::KinesisFirehose::DeliveryStream", {
    DeliveryStreamType: "DirectPut",
  })
  expect(template).toHaveResourceLike("AWS::WAFv2::LoggingConfiguration", {})
})

test("create WAF for CloudFront", () => {
  const app = new cdk.App()
  const stack = new cdk.Stack(app, "Stack", {
    env: { region: "us-east-1" }, // CloudFront WAFs must be in us-east-1
  })

  new Waf(stack, "TestWaf", {
    name: "CloudFrontWebACL",
    scope: "CLOUDFRONT",
    managedRuleGroups: [ManagedRuleGroupBuilder.coreRuleSet(10)],
  })

  const template = app.synth().getStackByName(stack.stackName).template
  expect(template).toMatchSnapshot()
  expect(template).toHaveResourceLike("AWS::WAFv2::WebACL", {
    Scope: "CLOUDFRONT",
  })
})

test("create WAF and associate with ALB", () => {
  const app = new cdk.App()
  const stack = new cdk.Stack(app, "Stack", {
    env: { region: "us-east-1" },
  })

  const vpc = new ec2.Vpc(stack, "VPC")
  const certificate = certificatemanager.Certificate.fromCertificateArn(
    stack,
    "Certificate",
    "arn:aws:acm:us-east-1:123456789012:certificate/test",
  )

  const loadBalancer = new LoadBalancer(stack, "LoadBalancer", {
    certificates: [certificate],
    vpc,
  })

  const waf = new Waf(stack, "TestWaf", {
    name: "ALBWebACL",
    managedRuleGroups: [ManagedRuleGroupBuilder.coreRuleSet(10)],
  })

  waf.associateWithResource(loadBalancer.loadBalancer.loadBalancerArn)

  const template = app.synth().getStackByName(stack.stackName).template
  expect(template).toMatchSnapshot()
  expect(template).toHaveResourceLike("AWS::WAFv2::WebACLAssociation", {})
})

test("create WAF with custom response bodies", () => {
  const app = new cdk.App()
  const stack = new cdk.Stack(app, "Stack")

  new Waf(stack, "TestWaf", {
    name: "CustomResponseWebACL",
    customResponseBodies: {
      BlockedResponse: {
        content: "<html><body><h1>Access Denied</h1></body></html>",
        contentType: "TEXT_HTML",
      },
      RateLimitResponse: {
        content: JSON.stringify({ error: "Too many requests" }),
        contentType: "APPLICATION_JSON",
      },
    },
  })

  const template = app.synth().getStackByName(stack.stackName).template
  expect(template).toMatchSnapshot()
  expect(template).toHaveResourceLike("AWS::WAFv2::WebACL", {
    CustomResponseBodies: {
      BlockedResponse: {
        Content: "<html><body><h1>Access Denied</h1></body></html>",
        ContentType: "TEXT_HTML",
      },
      RateLimitResponse: {
        Content: '{"error":"Too many requests"}',
        ContentType: "APPLICATION_JSON",
      },
    },
  })
})

test("create WAF with regex pattern set", () => {
  const app = new cdk.App()
  const stack = new cdk.Stack(app, "Stack")

  const regexSet = new WafRegexPatternSet(stack, "BadPatterns", {
    patterns: ["[sS][qQ][lL].*[iI][nN][jJ][eE][cC][tT]", "<script.*>"],
    description: "Patterns to block",
  })

  new Waf(stack, "TestWaf", {
    name: "RegexWebACL",
    customRules: [
      RuleBuilder.regexMatch(
        regexSet.arn,
        { allQueryArguments: {} },
        1,
        "BLOCK",
      ),
    ],
  })

  const template = app.synth().getStackByName(stack.stackName).template
  expect(template).toMatchSnapshot()
  expect(template).toHaveResourceLike("AWS::WAFv2::RegexPatternSet", {
    Scope: "REGIONAL",
  })
})

test("create WAF with size constraint rule", () => {
  const app = new cdk.App()
  const stack = new cdk.Stack(app, "Stack")

  new Waf(stack, "TestWaf", {
    name: "SizeConstraintWebACL",
    customRules: [
      RuleBuilder.sizeConstraint(8192, "GT", { body: {} }, 1, "BLOCK"),
    ],
  })

  const template = app.synth().getStackByName(stack.stackName).template
  expect(template).toMatchSnapshot()
  expect(template).toHaveResourceLike("AWS::WAFv2::WebACL", {
    Name: "SizeConstraintWebACL",
  })
})

test("create WAF with CloudWatch alarms", () => {
  const app = new cdk.App()
  const stack = new cdk.Stack(app, "Stack")

  const waf = new Waf(stack, "TestWaf", {
    name: "AlarmedWebACL",
  })

  waf.addBlockedRequestsAlarm(100, 2, 2)
  waf.addAllowedRequestsAlarm(10000, 1, 1)

  const template = app.synth().getStackByName(stack.stackName).template
  expect(template).toMatchSnapshot()
  expect(template).toHaveResourceLike("AWS::CloudWatch::Alarm", {
    MetricName: "BlockedRequests",
    Threshold: 100,
    EvaluationPeriods: 2,
    DatapointsToAlarm: 2,
  })
  expect(template).toHaveResourceLike("AWS::CloudWatch::Alarm", {
    MetricName: "AllowedRequests",
    Threshold: 10000,
  })
})

test("create WAF with metrics disabled", () => {
  const app = new cdk.App()
  const stack = new cdk.Stack(app, "Stack")

  const waf = new Waf(stack, "TestWaf", {
    name: "NoMetricsWebACL",
    enableMetrics: false,
  })

  // Metric property should be undefined
  expect(waf.metric).toBeUndefined()

  // Should throw error when trying to create allowed requests alarm
  expect(() => {
    waf.addAllowedRequestsAlarm(10000)
  }).toThrow("Cannot create allowed requests alarm when metrics are disabled")

  const template = app.synth().getStackByName(stack.stackName).template
  expect(template).toMatchSnapshot()
  expect(template).toHaveResourceLike("AWS::WAFv2::WebACL", {
    Name: "NoMetricsWebACL",
    VisibilityConfig: {
      CloudWatchMetricsEnabled: false,
      SampledRequestsEnabled: true,
    },
  })
})
