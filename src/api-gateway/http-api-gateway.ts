import * as constructs from "constructs"
import * as cdk from "aws-cdk-lib"
import * as route53 from "aws-cdk-lib/aws-route53"
import * as route53Targets from "aws-cdk-lib/aws-route53-targets"
import * as elb from "aws-cdk-lib/aws-elasticloadbalancingv2"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as sqs from "aws-cdk-lib/aws-sqs"
import * as apigw from "aws-cdk-lib/aws-apigatewayv2"
import * as apigwAlpha from "@aws-cdk/aws-apigatewayv2-alpha"
import * as logs from "aws-cdk-lib/aws-logs"
import * as iam from "aws-cdk-lib/aws-iam"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import * as integrations from "@aws-cdk/aws-apigatewayv2-integrations-alpha"
import * as authorizers from "@aws-cdk/aws-apigatewayv2-authorizers-alpha"
import * as acm from "aws-cdk-lib/aws-certificatemanager"
import { tagResources } from "../tags"

/**
 * @author Kristian Rekstad <kre@capraconsulting.no>
 */
export interface ApiGatewayProps {
  /**
   * Settings for the external-facing part of the API-GW.
   */
  dns: {
    /** Only the subdomain prefix, which should be the name of the service.
     * For example `my-service`.
     * This would give the end result of an API-GW with `my-service.my-customer.liflig.io`.
     */
    subdomain: string
    /**
     * HZ for the external facing domain.
     * This is where routes will be created, to redirect consumers to the API-GW.
     * For example a HostedZone for `my-customer.liflig.io`.
     */
    hostedZone: route53.IHostedZone

    /**
     * The Time To Live (TTL) for the public DNS A record that will expose the API-GW.
     * This is how long DNS servers will cache the record.
     *
     * A long TTL (hours) is beneficial to DNS servers, but makes developers (you) wait a long time when doing changes.
     *
     * @default 5 minutes
     */
    ttl?: cdk.Duration
  }

  /**
   * Settings for the API-Gateway.
   *
   * You must specify exactly one integration, using
   * {@link ApiGatewayProps.apiGateway.albIntegration albIntegration},
   * {@link ApiGatewayProps.apiGateway.lambdaIntegration lambdaIntegration}
   * or {@link ApiGatewayProps.apiGateway.sqsIntegration sqsIntegration}.
   */
  apiGateway: {
    /** Use this when connecting the routes to an ALB. */
    albIntegration?: AlbIntegrationProps
    /** Use this when connecting routes to a lambda. */
    lambdaIntegration?: LambdaIntegrationProps
    /** Use this when connecting a route to send to an SQS queue. */
    sqsIntegration?: SqsIntegrationProps

    /**
     * The authorizer to use. NONE (public), IAM, JWT, Basic Auth Lambda, Custom Lambda Authorizer.
     *
     * Currently only supports NONE, IAM, BASIC_AUTH_LAMBDA.
     *
     * TODO: Support others, when needed.
     */
    authorization:
      | NoAuthorizationProps
      | IamAuthorizationProps
      | BasicAuthLambdaProps

    /**
     * The API-GW will use a `/{proxy+}` route, but you can set a prefix before it.
     * For example, to not expose `/health`, only `/api/*`, you set the basePath to
     * `/api` and the resulting API-GW has a route with `/api/{proxy+}`.
     *
     * To not set a `basePath`, use an empty string `""`.
     *
     * @see disableProxyPath
     */
    basePath: string

    /**
     * If you want to use the exact route in {@link basePath},
     * you can set this to `true` to not get `/{proxy+}` at the end of the path
     *
     * @default false
     */
    disableProxyPath?: boolean

    /**
     * The API-GW access logs for the `$default` stage are kept.
     * This has options for the logs.
     *
     * You probably want to set the {@link encryptionKey}.
     */
    accessLogs?: {
      /**
       * DISABLED. FIXME EUR-914: Remove this option if it is best without it.
       *
       * If set, the API-GW access logs are encrypted with this key.
       * They are unencrypted otherwise.
       */
      //encryptionKey?: kms.IKey

      /**
       * Delete the access logs if this construct is deleted?
       *
       * Maybe you want to DESTROY instead.
       * Or for legal reasons, retain for audit
       * @default {@link cdk.RemovalPolicy.RETAIN}
       */
      removalPolicy?: cdk.RemovalPolicy

      retention?: logs.RetentionDays

      /**
       * A custom JSON log format, which uses variables from `"$context"`.
       *
       * See [AWS: CloudWatch log formats for API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-logging.html#apigateway-cloudwatch-log-formats)
       * for formats and rules.
       * It is possible to use other formats like CLF and XML, but this construct only supports JSON for now.
       *
       * For a list of all possible variables to log, see
       * [AWS: $context Variables for data models, authorizers, mapping templates, and CloudWatch access logging](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-mapping-template-reference.html#context-variable-reference)
       * and
       * [AWS: $context Variables for access logging only](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-mapping-template-reference.html#context-variable-reference-access-logging-only) .
       *
       * @default {@link defaultAccessLogFormat}
       */
      accessLogFormat?: Record<string, string>
    }

    /**
     * Set false to disable route-level metrics.
     * This can increase CloudWatch costs when not disabled.
     *
     * See [AWS: Working with metrics for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-metrics.html?icmpid=apigateway_console_help#:~:text=and%20stage%20ID.-,ApiId%2C%20Stage%2C%20Route,-Filters%20API%20Gateway)
     * for info.
     *
     * @default `true`
     */
    detailedMetrics?: boolean

    /** Throttling of requests.
     * If not set, the AWS default of 5000 burst and 10000 rate is used.
     *
     * The default throttling is per-account, and counts all APIs in the account and region.
     * If you have another API in this region getting 10_000 request rate, it may impact this API as well.
     */
    throttling?: {
      /**
       * Going over `5_000` may require you to contact AWS Support - they are account bound.
       **/
      burst?: number
      /**
       * Going over `10_000` may require you to contact AWS Support - they are account bound.
       **/
      rate?: number
    }
  }

  /** If some settings in this construct do not work for you,
   * this is an escape hatch mechanism to override anything.
   */
  propsOverride?: {
    /**
     * Override settings for the {@link apigwAlpha.HttpApi} (accessible in {@link ApiGateway.httpApi}).
     *
     * For example, if you have a frontend accessing this API, you might want to set
     * [CORS preflight](https://docs.aws.amazon.com/cdk/api/v1/docs/aws-apigatewayv2-readme.html#cross-origin-resource-sharing-cors)
     * settings.
     */
    httpApi?: Partial<apigwAlpha.HttpApiProps>
    // TODO add more as needed
  }
}

interface BaseAuthorizationProps {
  type: "IAM" | "BASIC_AUTH_LAMBDA" | "NONE"
}

export interface NoAuthorizationProps extends BaseAuthorizationProps {
  type: "NONE"
}

export interface IamAuthorizationProps extends BaseAuthorizationProps {
  type: "IAM"
}

export interface BasicAuthLambdaProps extends BaseAuthorizationProps {
  /**
   * Creates a custom authorizer lambda which reads `Authorization: Basic <base64Credential>` HTTP header.
   */
  type: "BASIC_AUTH_LAMBDA"

  /**
   * Store the Base64 encoded credentials as a json object in this secret.
   *
   * The object must have the key `credentials`.
   * The `credentials` value must be a string.
   * The string must be json-escaped and the contents must be a json list of strings.
   * The strings in the list must be Base64 encoded credentials on the form `username:password`.
   * See `load-m3-collector-gateway-secrets.ts` for how to create this.
   *
   * The Base64 scheme should use *standard* (with symbols `+/`) and padding, and `UTF-8` encoding.
   * Do not use the url-safe Base64 scheme (`-_`).
   *
   * @example `{ "credentials": "[\"dXNlcm5hbWU6cGFzc3dvcmQ=\", \"YWRtaW46aHVudGVyMg==\"]" }`
   *
   */
  credentialsJsonArraySecret: secretsmanager.ISecret
}

/** Properties that define an Application Load Balancer as the backend behind the API-GW. */
export interface AlbIntegrationProps {
  /**
   * A listener on e.g. port 443 (HTTPS)
   */
  applicationLoadBalancerListener: elb.IApplicationListener

  /**
   * The created API-GW {@link elb.ApplicationListenerRule}'s priority.
   * Must be unique among all rules in the listener.
   *
   * @see elb.BaseApplicationListenerRuleProps#priority
   */
  listenerPriority: number

  /**
   * The VPC used by the ALB.
   * The API-GW integration will connect to the ALB using a VPC Link for this VPC.
   */
  applicationLoadBalancerVpc: ec2.IVpc

  /**
   * A security group (SG) that allows incoming traffic to the ALB.
   * Will be used by the VPC link, so the API-GW integration can connect.
   *
   * This is usually the same SG as the ALB uses, because they have a rule that
   * allows traffic from others in the same SG.
   */
  securityGroupWithAlbAccess: ec2.ISecurityGroup

  /**
   * To verify the HTTPS certificate, the API-GW needs to know what host to expect.
   * This is something like `<service>.prod.my-customer.liflig.io`.
   *
   * If undefined, the private integration to ALB will use HTTP.
   *
   * @see {@link overwriteHostTo}
   */
  hostHttpsName: string

  /**
   * The `Host` header which the {@link elb.ApplicationListenerRule} tries to match,
   * in order to route requests to the correct Target Group.
   *
   * If you use `@liflig/cdk.lifligEcs.ListenerRule` for your service,
   * this `serviceListenerRuleHost` is the same as the {@link @liflig/cdk:ecs.ListenerRuleProps#domainName}.
   */
  serviceListenerRuleHostHeader: string
}

export interface LambdaIntegrationProps {
  lambdaFunction: cdk.aws_lambda.IFunction
}

export interface SqsIntegrationProps {
  queue: sqs.IQueue
}

/**
 * A slightly extended version of the [default JSON format suggested by AWS](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html#http-api-enable-logging.examples).
 */
export const defaultAccessLogFormat = {
  requestId: "$context.requestId",
  userAgent: "$context.identity.userAgent",
  ip: "$context.identity.sourceIp",
  /** CLF format: `dd/MMM/yyyy:HH:mm:ss +-hhmm` */
  requestTime: "$context.requestTime",
  requestTimeEpoch: "$context.requestTimeEpoch",
  httpMethod: "$context.httpMethod",
  path: "$context.path",
  routeKey: "$context.routeKey",
  status: "$context.status",
  protocol: "$context.protocol",
  responseLength: "$context.responseLength",
  responseLatency: "$context.responseLatency",
  domainName: "$context.domainName",
  //  hostHeaderOverride: "$context.requestOverride.header.Host", //Mapping template overrides cannot be used with proxy integration endpoints, which lack data mappings https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-override-request-response-parameters.html#:~:text=Mapping%20template%20overrides%20cannot%20be%20used%20with%20proxy%20integration%20endpoints%2C%20which%20lack%20data%20mappings
  apiGwErrorMessage: "$context.error.message",
  auth: {
    iam: {
      userArn: "$context.identity.userArn",
      awsAccount: "$context.identity.accountId",
      awsPrincipal: "$context.identity.caller",
      awsPrincipalOrg: "$context.identity.principalOrgId",
    },
    basic: {
      user: "$context.authorizer.user",
    },
  },
  integration: {
    error: "$context.integration.error",
    latency: "$context.integration.latency",
    requestId: "$context.integration.requestId",
    responseStatus: "$context.integration.status",
  },
  awsEndpointRequestId: "$context.awsEndpointRequestId",
  awsEndpointRequestId2: "$context.awsEndpointRequestId2",
  // For datadog
  message:
    "$context.identity.sourceIp - $context.httpMethod $context.domainName $context.path ($context.routeKey) - $context.status [$context.responseLatency ms]",
}

/**
 * This construct tries to simplify the creation of an API-GW for a service,
 * by collecting most of the common setup here.
 *
 * The approach followed in this construct is:
 * 1. One API-GW per service
 * 3. One subdomain per API-GW / service.
 * 4. Use HTTP API, not REST
 * 5. Use a $default stage with autodeploy
 * 6. Use IAM authorizer on default route
 * 7. Use 1 route (with `/{proxy+}` to let all sub-paths through)
 * 8. Use one integration (backend) on the route
 *
 * The integration is one of these:
 * * ALB private integration with VPC Link using HTTPS to the ALB
 * * Lambda integration
 * * SQS AddMessage integration
 *
 *
 * ## Load Balancer Security Group
 * Note that the Loadbalancer used in an {@link ApiGatewayProps#apiGateway#albIntegration} must allow
 * outbound HTTPS traffic to its SecurityGroup.
 * Otherwise, the VPC Link used by the API-GW can't get traffic from the ALB.
 *
 * ```ts
 * const loadBalancerSecurityGroup = new ec2.SecurityGroup(…, {
 *   allowAllOutbound: false,
 * })
 *
 * loadBalancerSecurityGroup.addEgressRule(
 *   loadBalancerSecurityGroup,
 *   ec2.Port.tcp(443),
 *   "Outbound to self for ALB to API-GW VPC-Link",
 * )
 * const loadBalancer = new lifligLoadBalancer.LoadBalancer(…,
 *   {
 *     overrideLoadBalancerProps: {
 *       securityGroup: loadBalancerSecurityGroup,
 *     },
 *   },
 * )
 * ```
 *
 * @author Kristian Rekstad <kre@capraconsulting.no>
 */
export class ApiGateway extends constructs.Construct {
  /** The API-Gateway HTTP API. This is the main construct for API-GW. */
  public readonly httpApi: apigwAlpha.HttpApi

  /** The route which connects the {@link httpApi} to the backing integration. */
  public readonly route: apigwAlpha.HttpRoute

  /** The domain which consumers must use.*/
  public readonly domain: string

  /** Access logs */
  public readonly logGroup: logs.LogGroup

  protected readonly props: ApiGatewayProps

  constructor(scope: constructs.Construct, id: string, props: ApiGatewayProps) {
    super(scope, id)
    this.props = props

    ApiGateway.validateProps(props, id, cdk.Stack.of(this))

    const customDomain = new CustomDomain(this, "CustomDomain", props)
    this.domain = customDomain.customDomainName

    // The integration is what connects the API-GW to a backend, like ALB or Lambda.
    // They are specified per-route, and possibly a default catch-all for the API-GW.

    let integrationFactory: IntegrationFactory | null = null
    if (props.apiGateway.albIntegration) {
      integrationFactory = new AlbIntegration(
        props.apiGateway.albIntegration,
        props.dns.subdomain,
      )
    } else if (props.apiGateway.lambdaIntegration) {
      integrationFactory = new LambdaIntegration(
        props.apiGateway.lambdaIntegration,
      )
    } else if (props.apiGateway.sqsIntegration) {
      integrationFactory = new SqsIntegration(props.apiGateway.sqsIntegration)
    }

    const defaultIntegration: apigwAlpha.HttpRouteIntegration =
      integrationFactory!.createIntegration(this)

    // The actual API. This holds the routes, authorizers and integrations.
    const api = new apigwAlpha.HttpApi(this, "HttpApi-" + props.dns.subdomain, {
      // defaultIntegration: defaultIntegration, // This is for a catch-all $default route
      description: `An HTTP API for ${props.dns.subdomain}.${
        props.dns.hostedZone.zoneName
      }${
        props.apiGateway.basePath
      } which proxies to ${integrationFactory!.getHumanReadableEndpointName()}.`,
      disableExecuteApiEndpoint: true, // Force externals to go through custom domain. MUST be true when using Mutual TLS, for security reasons
      createDefaultStage: true,
      defaultDomainMapping: {
        domainName: customDomain.apiGwCustomDomain,
      },
      ...props?.propsOverride?.httpApi,
    })
    this.httpApi = api

    const stage = api.defaultStage?.node.defaultChild as apigw.CfnStage

    const logs = new ApiGatewayAccessLogs(this, "AccessLogs", {
      ...props,
      stage: stage,
    })
    this.logGroup = logs.logGroup

    stage.defaultRouteSettings = {
      ...stage.defaultRouteSettings,
      detailedMetricsEnabled: props.apiGateway.detailedMetrics ?? true,
      throttlingBurstLimit: props.apiGateway.throttling?.burst, // Default for account is 5_000
      throttlingRateLimit: props.apiGateway.throttling?.rate, // Default for account is 10_000
    }

    /** The authorizer only accepts requests from external users that are authorized.
     * Unauthorized users are stopped in the API-GW, and not forwarded to the integration. */
    let authorizer: apigwAlpha.IHttpRouteAuthorizer | undefined = undefined
    if (props.apiGateway.authorization.type === "NONE") {
      authorizer = undefined
    } else if (props.apiGateway.authorization.type === "IAM") {
      // API Gateway invokes your API route only if the client has execute-api permission for the route.
      // The client has to use AWS SigV4 to identify themselves in the request.

      // Read this page for help with IAM and API-GW https://docs.aws.amazon.com/apigateway/latest/developerguide/security_iam_service-with-iam.html
      // Note that [resource policies are not supported yet for HTTP](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-access-control-iam.html)

      authorizer = new authorizers.HttpIamAuthorizer()
    } else if (props.apiGateway.authorization.type === "BASIC_AUTH_LAMBDA") {
      const lambda = new BasicAuthLambda(this, "BasicAuthLambda", {
        secret: props.apiGateway.authorization.credentialsJsonArraySecret,
      })

      authorizer = new authorizers.HttpLambdaAuthorizer(
        "AuthBasicLambdaAuthorizer",
        lambda.basicAuthLambda,
        {
          responseTypes: lambda.responseTypes,
          resultsCacheTtl: cdk.Duration.minutes(30), // max 1h, or disabled (0s). The value only matters when invalidating/dynamic credentials
        },
      )
    }

    let routePath = props.apiGateway.basePath
    if (!props.apiGateway.disableProxyPath) {
      routePath += "/{proxy+}"
    }
    // This is the actual route which connects the API-GW to a backend.
    this.route = new apigwAlpha.HttpRoute(this, "DefaultProxyRoute", {
      httpApi: api,
      integration: defaultIntegration,
      routeKey: apigwAlpha.HttpRouteKey.with(
        routePath,
        apigwAlpha.HttpMethod.ANY,
      ),
      authorizer: authorizer,
    })

    tagResources(this, () => ({ service: props.dns.subdomain }))
  }

  /** @throws Error */
  protected static validateProps(
    props: ApiGatewayProps,
    id: string,
    stack: cdk.Stack,
  ) {
    const integrations = [
      props.apiGateway.albIntegration,
      props.apiGateway.lambdaIntegration,
      props.apiGateway.sqsIntegration,
    ].filter((it) => it !== undefined)
    if (integrations.length == 0) {
      throw new Error("At least one integration is required!")
    } else if (integrations.length > 1) {
      // todo: You can refactor to 1 non-null integration property and instead use different classes for different integrations.
      throw new Error(
        `Only 1 integration can be used, but ${integrations.length} integrations were found. Leave the other integration properties as undefined`,
      )
    }
    const validTypes: Array<BaseAuthorizationProps["type"]> = [
      "NONE",
      "IAM",
      "BASIC_AUTH_LAMBDA",
    ]
    if (!validTypes.includes(props.apiGateway.authorization.type)) {
      throw new Error(
        `Only ${validTypes.join(", ")} are supported for now: ${
          props.apiGateway.authorization.type as string
        }`,
      )
    }
    if (props.dns.subdomain === "" || props.dns.subdomain.includes(" ")) {
      throw new Error(
        `Subdomain must be set, and not contain spaces: ${props.dns.subdomain}`,
      )
    }
    if (props.apiGateway.basePath.endsWith("/")) {
      throw new Error(
        "Don't end base path with '/'. For root path, set it to an empty string.",
      )
    }
    if (props.apiGateway.disableProxyPath === true) {
      if (props.apiGateway.basePath === undefined) {
        throw new Error(
          "Please set a basePath if you disable the '/{proxy+}' default path. You currently do not have any path on the route!",
        )
      }

      if (!props.apiGateway.basePath.startsWith("/")) {
        throw new Error(
          "When using only the basePath without automatic appending of '/{proxy+}', the basePath should start with '/' : " +
            props.apiGateway.basePath,
        )
      }
    }
    if (props.apiGateway.albIntegration?.hostHttpsName?.startsWith("https:")) {
      throw new Error(
        `The albIntegration.hostHttpsName should not include a protocol: ${props.apiGateway.albIntegration?.hostHttpsName}`,
      )
    }
    if (
      props.apiGateway.throttling?.burst &&
      props.apiGateway.throttling.burst > 5_000
    ) {
      console.warn(
        `⚠️ Your throttling burst limit '${props.apiGateway.throttling.burst}' is higher than the AWS Account limit. Make sure your account has upgraded this quota! `,
        stack,
        id,
      )
    }
    if (
      props.apiGateway.throttling?.rate &&
      props.apiGateway.throttling.rate > 10_000
    ) {
      console.warn(
        `⚠️ Your throttling rate limit '${props.apiGateway.throttling.rate}' is higher than the AWS Account limit. Make sure your account has upgraded this quota! `,
        stack,
        id,
      )
    }
  }

  /**
   * Allows a grantable target (role, user etc.) to invoke the API.
   * Only works when using `IAM` as {@link ApiGatewayProps#apiGateway#authorization}.
   *
   * @param target a grantable, like {@link iam.Role}
   */
  public grantInvoke(target: iam.IGrantable) {
    if (this.props.apiGateway.authorization.type !== "IAM") {
      throw new Error(
        `Cannot grant invoke when not using IAM auth: ${
          this.props.apiGateway.authorization.type
        }. ${cdk.Stack.of(this).stackName}`,
      )
    }
    this.route.grantInvoke(target)
  }

  /**
   * Utility method for Liflig to get access to the API
   */
  public grantTeamAdministratorRoleInvoke() {
    const account = cdk.Stack.of(this).account
    this.grantInvoke(
      iam.Role.fromRoleArn(
        this,
        "LifligAdmin",
        `arn:aws:iam::${account}:role/LifligAdministrator`,
      ),
    )
  }
}

/**
 * Creates a custom domain for the API-Gateway, a Route53 record and an HTTPS cert.
 * @author Kristian Rekstad <kre@capraconsulting.no>
 */
class CustomDomain extends constructs.Construct {
  public readonly apiGwCustomDomain: apigwAlpha.DomainName

  /** The Fully Qualified Domain Name (FQDN) like `my-service.prod.my-customer.liflig.io`. */
  public readonly customDomainName: string

  constructor(scope: constructs.Construct, id: string, props: ApiGatewayProps) {
    super(scope, id)
    this.customDomainName = `${props.dns.subdomain}.${props.dns.hostedZone.zoneName}`

    // Can also use wildcard certs instead! Cheaper
    /** Allows external users to connect with HTTPS. */
    const customDomainCert = new acm.DnsValidatedCertificate(
      this,
      "HttpsCertificate",
      {
        domainName: this.customDomainName,
        hostedZone: props.dns.hostedZone,
      },
    )

    // Note that API-GW can also support wildcard domains! https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-custom-domain-names.html#http-wildcard-custom-domain-names
    // But this will not work when AWS account X has CustomDomain `staging.my-customer.liflig.io` and account Y has CustomDomain `*.my-customer.liflig.io`.
    // Not sure how sub-subdomains are affected: `my-service.prod.my-customer.liflig.io` and `*.my-customer.liflig.io`.
    this.apiGwCustomDomain = new apigwAlpha.DomainName(
      this,
      "DomainName-" + props.dns.subdomain,
      {
        domainName: this.customDomainName,
        certificate: customDomainCert,
        endpointType: apigwAlpha.EndpointType.REGIONAL,
        securityPolicy: apigwAlpha.SecurityPolicy.TLS_1_2,
      },
    )

    // This makes the API-GW publicly available on the custom domain name.
    new route53.ARecord(this, "Route53ARecordApigwAlias", {
      recordName: props.dns.subdomain,
      zone: props.dns.hostedZone,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.ApiGatewayv2DomainProperties(
          this.apiGwCustomDomain.regionalDomainName,
          this.apiGwCustomDomain.regionalHostedZoneId,
        ),
      ),
      ttl: props.dns.ttl ?? cdk.Duration.minutes(5), // Low TTL makes it easier to do changes
    })
  }
}

/**
 * Enables access logs on the API-Gateway.
 *
 * @author Kristian Rekstad <kre@capraconsulting.no>
 */
class ApiGatewayAccessLogs extends constructs.Construct {
  public readonly logGroup: logs.LogGroup

  constructor(
    scope: constructs.Construct,
    id: string,
    props: ApiGatewayProps & { stage: apigw.CfnStage },
  ) {
    super(scope, id)

    // logGroup is set up with help from: https://github.com/aws/aws-cdk/issues/11100#issuecomment-904627081
    // Not sure if HTTP API actually needs the service role with managed policy: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html
    const accessLogs = new logs.LogGroup(this, "AccessLogGroup", {
      retention: props.apiGateway.accessLogs?.retention,
      removalPolicy:
        props.apiGateway.accessLogs?.removalPolicy ?? cdk.RemovalPolicy.RETAIN,
      encryptionKey: undefined, //props.apiGateway.accessLogs?.encryptionKey, // Always use the default encryption key. Otherwise, the key needs special policies https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/encrypt-log-data-kms.html#cmk-permissions
    })
    this.logGroup = accessLogs

    props.stage.accessLogSettings = {
      destinationArn: accessLogs.logGroupArn,
      format: JSON.stringify(
        props.apiGateway.accessLogs?.accessLogFormat ?? defaultAccessLogFormat,
      ),
    }

    const apiGwLogsRole = new iam.Role(
      this,
      "ApiGatewayPushToCloudwatchLogsRole",
      {
        assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AmazonAPIGatewayPushToCloudWatchLogs",
          ),
        ],
      },
    )

    accessLogs.grantWrite(apiGwLogsRole)
  }
}

/** Allows different integrations to be made using a common interface. */
interface IntegrationFactory {
  /** Creates the integration. Use the result as the defaultIntegration of the API-GW route. */
  createIntegration(
    scope: constructs.Construct,
  ): apigwAlpha.HttpRouteIntegration

  /** Return a name that can be used in the API-GW's description of where
   * the routes direct to.
   */
  getHumanReadableEndpointName(): string
}

/** Creates an integration to an Application Load Balancer. */
class AlbIntegration implements IntegrationFactory {
  constructor(
    private props: AlbIntegrationProps,
    private dnsSubdomain: string,
  ) {}

  createIntegration(
    scope: constructs.Construct,
  ): apigwAlpha.HttpRouteIntegration {
    // The VPCLink connects the integration into the ALB's VPC.
    // Must be manually created when the VPC is imported, which is the case when using CorePlatformConsumer.
    const vpcLink = new apigwAlpha.VpcLink(scope, "AlbVpcLink", {
      vpc: this.props.applicationLoadBalancerVpc,
      securityGroups: [this.props.securityGroupWithAlbAccess],
      subnets: this.props.applicationLoadBalancerVpc.selectSubnets(), // This correctly selects the private subnets
    })

    return new integrations.HttpAlbIntegration(
      "AlbIntegration-" + this.dnsSubdomain,
      this.props.applicationLoadBalancerListener,
      {
        secureServerName: this.props.hostHttpsName,
        vpcLink: vpcLink,
        method: apigwAlpha.HttpMethod.ANY,
        parameterMapping: new apigwAlpha.ParameterMapping().overwriteHeader(
          "Host",
          apigwAlpha.MappingValue.custom(
            this.props.serviceListenerRuleHostHeader, // The Host header can NOT use dynamic mapping, like $context.domainName etc.
          ),
        ),
      },
    )
  }

  getHumanReadableEndpointName(): string {
    return this.props.serviceListenerRuleHostHeader
  }
}

class LambdaIntegration implements IntegrationFactory {
  constructor(private props: { lambdaFunction: cdk.aws_lambda.IFunction }) {}

  createIntegration(): apigwAlpha.HttpRouteIntegration {
    return new integrations.HttpLambdaIntegration(
      "LambdaIntegration",
      this.props.lambdaFunction,
      {
        payloadFormatVersion: apigwAlpha.PayloadFormatVersion.VERSION_2_0,
        parameterMapping: undefined,
      },
    )
  }

  getHumanReadableEndpointName(): string {
    return "lambda " + this.props.lambdaFunction.functionName
  }
}

/** Creates an integration for pushing messages to SQS. */
class SqsIntegration implements IntegrationFactory {
  constructor(private props: SqsIntegrationProps) {}

  createIntegration(
    scope: constructs.Construct,
  ): apigwAlpha.HttpRouteIntegration {
    // API-GW does not have access to SQS by default
    const role = new iam.Role(scope, "ApiGwToSqsServiceRole", {
      description:
        "Allows API-GW to add messages to " + this.props.queue.queueArn,
      assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
    })
    this.props.queue.grantSendMessages(role)

    return new SqsRouteIntegration("SqsIntegration", {
      type: apigwAlpha.HttpIntegrationType.AWS_PROXY,
      subtype: apigwAlpha.HttpIntegrationSubtype.SQS_SEND_MESSAGE,
      credentials: apigwAlpha.IntegrationCredentials.fromRole(role),
      parameterMapping: new apigwAlpha.ParameterMapping()
        // https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-aws-services-reference.html#SQS-SendMessage
        .custom("QueueUrl", this.props.queue.queueUrl)
        .custom("MessageBody", "$request.body")
        .custom("Region", "eu-west-1"), // Change this if the SQS queue is in another region!
      payloadFormatVersion: apigwAlpha.PayloadFormatVersion.VERSION_1_0,
    })
  }

  getHumanReadableEndpointName(): string {
    return "SQS " + this.props.queue.queueName
  }
}

/** Acts as glue (between the integration props and the HttpApi) when creating an SqsIntegration. */
class SqsRouteIntegration extends apigwAlpha.HttpRouteIntegration {
  /**
   * @param id The id used in the {@link apigwAlpha.HttpIntegration} construct
   *    created internally by {@link apigwAlpha.HttpRouteIntegration._bindToRoute}.
   *    [Source code](https://github.com/aws/aws-cdk/blob/b5ae37782bc3cb637eeef9fbb1fbe2c5efdfc068/packages/%40aws-cdk/aws-apigatewayv2/lib/http/integration.ts#L321)
   * @param integrationProps The props to pass to the {@link apigwAlpha.HttpIntegration} construct.
   */
  constructor(
    id: string,
    private integrationProps: apigwAlpha.HttpRouteIntegrationConfig,
  ) {
    super(id)
  }

  /** This sends the properties needed for creating a {@link apigwAlpha.HttpIntegration} to the {@link apigwAlpha.HttpRouteIntegration}. */
  bind(): apigwAlpha.HttpRouteIntegrationConfig {
    // This method is called by:
    // https://github.com/aws/aws-cdk/blob/b5ae37782bc3cb637eeef9fbb1fbe2c5efdfc068/packages/%40aws-cdk/aws-apigatewayv2/lib/http/integration.ts#L319
    return this.integrationProps
  }
}

class BasicAuthLambda extends constructs.Construct {
  public readonly basicAuthLambda: lambda.IFunction

  // Simple is `{ isAuthorized: true/false }`, as opposed to returning an IAM Policy document
  public readonly responseTypes: authorizers.HttpLambdaResponseType[] = [
    authorizers.HttpLambdaResponseType.SIMPLE,
  ]

  constructor(
    scope: constructs.Construct,
    id: string,
    props: { secret: secretsmanager.ISecret },
  ) {
    super(scope, id)

    this.basicAuthLambda = new lambda.Function(this, "BasicAuthLambda", {
      description:
        "An authorizer for API-Gateway that checks Basic Auth credentials on requests",
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: "index.handler",
      environment: {
        credentialsSecretId: props.secret.secretName,
        secretRegion: props.secret.stack.region,
      },
      // For code secretsmanager, see https://github.com/awsdocs/aws-doc-sdk-examples/blob/main/javascript/example_code/secrets/secrets_getsecretvalue.js
      code: new lambda.InlineCode(
        `"use strict"
const AWS = require('aws-sdk');
const secretsManager = new AWS.SecretsManager({ region: process.env.secretRegion || "eu-west-1" });

// Returns a string of json object. The object has a key credentials of type string,
// containing a stringified json array of base64 strings.
// E.g.: '{ "credentials": "[\\"dXNlcm5hbWU6cGFzc3dvcmQ=\\", \\"YWRtaW46aHVudGVyMg==\\"]" }'
async function getSecret() {
  return new Promise((resolve, reject) => {
    secretsManager.getSecretValue({ SecretId: process.env.credentialsSecretId }, (err, data) => {
      if (err) { return reject(err.code); }
      if ("SecretString" in data) {
        return resolve(data.SecretString);
      } else {
        const buffer = Buffer.from(data.SecretBinary, "base64");
        return resolve(buffer.toString("ascii"));
      }
    });
  });
};

exports.handler = async(event) => {
  let response = {
    "isAuthorized": false
  };

  const auth = event.headers.authorization || "";
  try {
    const validCredentials = JSON.parse(JSON.parse(await getSecret()).credentials);
    if (auth.startsWith("Basic ")) {
      for (const cred of validCredentials) {
        if (auth === "Basic " + cred && cred !== "") {
          response = {
            "isAuthorized": true,
             "context": {
               "user" : Buffer.from(cred, "base64").toString("utf-8").split(":")[0]
             }
          };
          break;
        }
      }
    }
  } catch (err) {
    console.error("Failure during authentication. Verify that the secret is correct.", err);
    throw err; // Makes API-GW return 500 instead of 401
  }

  return response;
};`,
      ),
    })
    props.secret.grantRead(this.basicAuthLambda)
  }
}
