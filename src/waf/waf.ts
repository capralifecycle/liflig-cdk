import * as cdk from "aws-cdk-lib"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import * as iam from "aws-cdk-lib/aws-iam"
import * as kinesisfirehose from "aws-cdk-lib/aws-kinesisfirehose"
import * as logs from "aws-cdk-lib/aws-logs"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as wafv2 from "aws-cdk-lib/aws-wafv2"
import * as constructs from "constructs"
import type { CustomRule } from "./custom-rules"
import type { ManagedRuleGroup } from "./managed-rule-groups"

export interface WafProps {
  /**
   * Name of the Web ACL
   */
  name?: string

  /**
   * Description of the Web ACL
   */
  description?: string

  /**
   * Scope of the WAF
   * CLOUDFRONT for CloudFront distributions (must be in us-east-1)
   * REGIONAL for ALB, API Gateway, AppSync, Cognito User Pool, App Runner, Verified Access
   * @default REGIONAL
   */
  scope?: "REGIONAL" | "CLOUDFRONT"

  /**
   * Managed rule groups to include
   */
  managedRuleGroups?: ManagedRuleGroup[]

  /**
   * Custom rules
   */
  customRules?: CustomRule[]

  /**
   * Default action for requests that don't match any rules
   * @default ALLOW
   */
  defaultAction?: "ALLOW" | "BLOCK"

  /**
   * Enable CloudWatch metrics
   * When disabled, the metric property will not be created
   * @default true
   */
  enableMetrics?: boolean

  /**
   * Enable logging
   * @default false
   */
  enableLogging?: boolean

  /**
   * Log retention in days (only used if enableLogging is true)
   * @default 7
   */
  logRetention?: logs.RetentionDays

  /**
   * Enable sampled requests
   * @default true
   */
  enableSampledRequests?: boolean

  /**
   * Custom response bodies
   */
  customResponseBodies?: {
    [key: string]: {
      content: string
      contentType: "TEXT_PLAIN" | "TEXT_HTML" | "APPLICATION_JSON"
    }
  }

  /**
   * Token domains for CAPTCHA and Challenge
   */
  tokenDomains?: string[]

  /**
   * Override CfnWebACL properties
   */
  overrideWebAclProps?: Partial<wafv2.CfnWebACLProps>
}

export class Waf extends constructs.Construct {
  public readonly webAcl: wafv2.CfnWebACL
  public readonly webAclArn: string
  public readonly webAclId: string
  public logGroup?: logs.LogGroup
  public logBucket?: s3.Bucket
  public readonly metric?: cloudwatch.Metric

  constructor(scope: constructs.Construct, id: string, props: WafProps = {}) {
    super(scope, id)

    const wafScope = props.scope ?? "REGIONAL"
    const enableMetrics = props.enableMetrics ?? true
    const enableSampledRequests = props.enableSampledRequests ?? true
    const defaultAction = props.defaultAction ?? "ALLOW"

    // Convert custom response bodies if provided
    const customResponseBodies = props.customResponseBodies
      ? Object.entries(props.customResponseBodies).reduce(
          (acc, [key, value]) => {
            acc[key] = {
              content: value.content,
              contentType: value.contentType,
            }
            return acc
          },
          {} as Record<string, any>,
        )
      : undefined

    // Build rules array
    const rules: wafv2.CfnWebACL.RuleProperty[] = []

    // Add managed rule groups
    if (props.managedRuleGroups) {
      for (const managedGroup of props.managedRuleGroups) {
        const rule: wafv2.CfnWebACL.RuleProperty = {
          name: `ManagedRule-${managedGroup.name}`,
          priority: managedGroup.priority,
          statement: {
            managedRuleGroupStatement: {
              vendorName: managedGroup.vendor ?? "AWS",
              name: managedGroup.name,
              version: managedGroup.version,
              excludedRules: managedGroup.excludedRules?.map((ruleName) => ({
                name: ruleName,
              })),
              scopeDownStatement: managedGroup.scopeDownStatement,
            },
          },
          overrideAction: {
            [managedGroup.overrideAction === "COUNT" ? "count" : "none"]: {},
          },
          visibilityConfig: managedGroup.visibilityConfig ?? {
            sampledRequestsEnabled: enableSampledRequests,
            cloudWatchMetricsEnabled: enableMetrics,
            metricName: `ManagedRule-${managedGroup.name.replace(
              /[^a-zA-Z0-9]/g,
              "",
            )}`,
          },
        }
        rules.push(rule)
      }
    }

    // Add custom rules
    if (props.customRules) {
      for (const customRule of props.customRules) {
        const rule: wafv2.CfnWebACL.RuleProperty = {
          name: customRule.name,
          priority: customRule.priority,
          statement: customRule.statement,
          action: this.convertAction(customRule.action),
          visibilityConfig: customRule.visibilityConfig ?? {
            sampledRequestsEnabled: enableSampledRequests,
            cloudWatchMetricsEnabled: enableMetrics,
            metricName: customRule.name.replace(/[^a-zA-Z0-9]/g, ""),
          },
          ruleLabels: customRule.ruleLabels?.map((label) => ({ name: label })),
          captchaConfig: customRule.captchaConfig,
          challengeConfig: customRule.challengeConfig,
        }
        rules.push(rule)
      }
    }

    // Sort rules by priority
    rules.sort((a, b) => a.priority - b.priority)

    // Create Web ACL
    this.webAcl = new wafv2.CfnWebACL(this, "WebACL", {
      scope: wafScope,
      name: props.name,
      description: props.description,
      defaultAction: {
        [defaultAction.toLowerCase()]: {},
      },
      rules,
      visibilityConfig: {
        sampledRequestsEnabled: enableSampledRequests,
        cloudWatchMetricsEnabled: enableMetrics,
        metricName:
          props.name?.replace(/[^a-zA-Z0-9]/g, "") ?? `WAF-${this.node.addr}`,
      },
      customResponseBodies,
      tokenDomains: props.tokenDomains,
      ...props.overrideWebAclProps,
    })

    this.webAclArn = this.webAcl.attrArn
    this.webAclId = this.webAcl.attrId

    // Set up logging if enabled
    if (props.enableLogging) {
      this.setupLogging(props.logRetention ?? logs.RetentionDays.ONE_WEEK)
    }

    // Create CloudWatch metric if metrics are enabled
    if (enableMetrics) {
      this.metric = new cloudwatch.Metric({
        namespace: "AWS/WAFV2",
        metricName: "AllowedRequests",
        dimensionsMap: {
          WebACL: this.webAcl.name ?? `WAF-${this.node.addr}`,
          Rule: "ALL",
          Region: cdk.Stack.of(this).region,
        },
      })
    }
  }

  /**
   * Associate this WAF with a resource (ALB, API Gateway, etc.)
   */
  public associateWithResource(resourceArn: string): void {
    new wafv2.CfnWebACLAssociation(this, "Association", {
      resourceArn,
      webAclArn: this.webAclArn,
    })
  }

  /**
   * Add a CloudWatch alarm for blocked requests
   */
  public addBlockedRequestsAlarm(
    threshold: number,
    evaluationPeriods = 1,
    datapointsToAlarm = 1,
  ): cloudwatch.Alarm {
    return new cloudwatch.Alarm(this, "BlockedRequestsAlarm", {
      metric: new cloudwatch.Metric({
        namespace: "AWS/WAFV2",
        metricName: "BlockedRequests",
        dimensionsMap: {
          WebACL: this.webAcl.name ?? `WAF-${this.node.addr}`,
          Rule: "ALL",
          Region: cdk.Stack.of(this).region,
        },
      }),
      threshold,
      evaluationPeriods,
      datapointsToAlarm,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    })
  }

  /**
   * Add a CloudWatch alarm for allowed requests
   */
  public addAllowedRequestsAlarm(
    threshold: number,
    evaluationPeriods = 1,
    datapointsToAlarm = 1,
  ): cloudwatch.Alarm {
    if (!this.metric) {
      throw new Error(
        "Cannot create allowed requests alarm when metrics are disabled",
      )
    }
    return new cloudwatch.Alarm(this, "AllowedRequestsAlarm", {
      metric: this.metric,
      threshold,
      evaluationPeriods,
      datapointsToAlarm,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    })
  }

  private convertAction(action: string): wafv2.CfnWebACL.RuleActionProperty {
    switch (action.toUpperCase()) {
      case "ALLOW":
        return { allow: {} }
      case "BLOCK":
        return { block: {} }
      case "COUNT":
        return { count: {} }
      case "CAPTCHA":
        return { captcha: {} }
      case "CHALLENGE":
        return { challenge: {} }
      default:
        return { allow: {} }
    }
  }

  private setupLogging(retention: logs.RetentionDays): void {
    // Create S3 bucket for logs
    this.logBucket = new s3.Bucket(this, "LogBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(90),
        },
      ],
    })

    // Create Kinesis Firehose delivery stream
    const firehoseRole = new iam.Role(this, "FirehoseRole", {
      assumedBy: new iam.ServicePrincipal("firehose.amazonaws.com"),
    })

    this.logBucket.grantWrite(firehoseRole)

    const deliveryStream = new kinesisfirehose.CfnDeliveryStream(
      this,
      "LogDeliveryStream",
      {
        deliveryStreamType: "DirectPut",
        s3DestinationConfiguration: {
          bucketArn: this.logBucket.bucketArn,
          prefix: "waf-logs/",
          errorOutputPrefix: "error/",
          compressionFormat: "GZIP",
          roleArn: firehoseRole.roleArn,
        },
      },
    )

    // Create logging configuration
    new wafv2.CfnLoggingConfiguration(this, "LoggingConfiguration", {
      resourceArn: this.webAclArn,
      logDestinationConfigs: [deliveryStream.attrArn],
    })

    // Also create CloudWatch Logs group for easier viewing
    this.logGroup = new logs.LogGroup(this, "LogGroup", {
      retention,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
  }
}
