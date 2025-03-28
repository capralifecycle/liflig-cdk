import * as constructs from "constructs"
import * as cdk from "aws-cdk-lib"
import type * as elb from "aws-cdk-lib/aws-elasticloadbalancingv2"
import type * as ec2 from "aws-cdk-lib/aws-ec2"
import * as lambda from "aws-cdk-lib/aws-lambda"
import type * as sqs from "aws-cdk-lib/aws-sqs"
import type * as events from "aws-cdk-lib/aws-events"
import * as apigw from "aws-cdk-lib/aws-apigatewayv2"
import * as logs from "aws-cdk-lib/aws-logs"
import * as iam from "aws-cdk-lib/aws-iam"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations"
import * as authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers"
import type { IUserPool } from "aws-cdk-lib/aws-cognito"
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs"
import { createHash } from "crypto"
import { tagResources } from "../tags"
import * as path from "path"
import { fileURLToPath } from "url"
import { ApiGatewayDnsProps, ApiGatewayDomain } from "./domain"
import { ApiGatewayAccessLogs, ApiGatewayAccessLogsProps } from "./access-logs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Props for the {@link ApiGateway} construct.
 *
 * @author Kristian Rekstad <kre@capraconsulting.no>
 * @author Hermann Mørkrid <hem@liflig.no>
 */
export type ApiGatewayProps<AuthScopesT extends string = string> = {
  /** Settings for the external-facing part of the API-GW. */
  dns: ApiGatewayDnsProps

  /**
   * If no integration is specified for a route, this integration is used.
   *
   * See {@link IntegrationProps} for the available options.
   */
  defaultIntegration?: IntegrationProps

  /**
   * If no authorization is specified for a route, this authorization is used.
   *
   * See {@link AuthorizationProps} for the available options.
   */
  defaultAuthorization?: AuthorizationProps<AuthScopesT>

  routes: ApiGatewayRoute<AuthScopesT>[]

  /**
   * The API-GW access logs for the `$default` stage are kept.
   * This has options for the logs.
   */
  accessLogs?: ApiGatewayAccessLogsProps

  /**
   * Set to false to disable route-level metrics.
   * This can increase CloudWatch costs when not disabled.
   *
   * See [AWS: Working with metrics for HTTP APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-metrics.html?icmpid=apigateway_console_help#:~:text=and%20stage%20ID.-,ApiId%2C%20Stage%2C%20Route,-Filters%20API%20Gateway)
   * for more info.
   *
   * @default true
   */
  detailedMetrics?: boolean

  /**
   * Throttling of requests.
   * If not set, the AWS default of 5000 burst and 10000 rate is used.
   *
   * The default throttling is per-account, and counts all APIs in the account and region.
   * If you have another API in this region getting 10_000 request rate, it may impact this API as well.
   */
  throttling?: {
    /**
     * Going over `5_000` may require you to contact AWS Support - they are account bound.
     */
    burst?: number
    /**
     * Going over `10_000` may require you to contact AWS Support - they are account bound.
     */
    rate?: number
  }

  /**
   * Sets CORS headers on responses from the API Gateway to allow all origins, headers and methods.
   * Useful if your API should be accessed by any browser.
   */
  corsAllowAll?: boolean

  /**
   * If some settings in this construct do not work for you, this is an escape hatch mechanism to
   * override anything.
   */
  propsOverride?: {
    /**
     * Override settings for the {@link apigw.HttpApi} (accessible in {@link ApiGateway.httpApi}).
     *
     * For example, if you have a frontend accessing this API, you might want to set
     * [CORS preflight](https://docs.aws.amazon.com/cdk/api/v1/docs/aws-apigatewayv2-readme.html#cross-origin-resource-sharing-cors)
     * settings.
     */
    httpApi?: Partial<apigw.HttpApiProps>
  }
}

export type ApiGatewayRoute<AuthScopesT extends string = string> = {
  /** The path of the route to expose through the API Gateway. Use "/" for the root route. */
  path: string

  /**
   * By default, we only forward requests that match the route's path exactly. So for a route with
   * path `/api/users`, a request to `/api/users` will be forwarded, but a request to
   * `/api/users/admin` will not. If you want to forward requests to all sub-paths under the route's
   * path, you can set this to true.
   *
   * @default false
   */
  includeSubpaths?: boolean

  /**
   * The HTTP method to expose. `ANY` exposes all HTTP methods on the path.
   *
   * @default "ANY"
   */
  method?: HttpMethod

  /**
   * The integration that the route will forward to. See {@link IntegrationProps} for the available
   * options.
   *
   * If undefined, uses the {@link ApiGatewayProps.defaultIntegration}.
   */
  integration?: IntegrationProps

  /**
   * How requests on the route are authenticated. See {@link AuthorizationProps} for the available
   * options.
   *
   * If undefined, uses the {@link ApiGatewayProps.defaultAuthorization}.
   */
  authorization?: AuthorizationProps<AuthScopesT>
}

export type HttpMethod =
  | "ANY"
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD"

export type IntegrationProps =
  /** Use this when connecting the route to an ALB (Application Load Balancer). */
  | ({ type: "ALB" } & AlbIntegrationProps)
  /** Use this when connecting route to a Lambda. */
  | ({ type: "Lambda" } & LambdaIntegrationProps)
  /** Use this when connecting a route to send to an SQS queue. */
  | ({ type: "SQS" } & SqsIntegrationProps)
  /** Use this when connecting a route to send to an EventBridge event bus. */
  | ({ type: "EventBridge" } & EventBridgeIntegrationProps)

/**
 * Props for the API-GW -> ALB (Application Load Balancer) integration.
 *
 * See the note on {@link ApiGateway} about the load balancer security group.
 */
export type AlbIntegrationProps = {
  /**
   * A listener on e.g. port 443 (HTTPS).
   *
   * See the note on {@link ApiGateway} about the load balancer security group.
   */
  loadBalancerListener: elb.IApplicationListener

  /**
   * The host name (domain name) of the backend service that we want to reach through the ALB.
   *
   * This is used to:
   * - Verify the HTTPS certificate of the backend service, so that the request forwarded from
   *   API-GW can use TLS
   * - Set the `Host` header on the request when forwarding to the ALB, so that requests can be
   *   routed to the correct Target Group
   *
   * Example value: `<service>.staging.my-project.liflig.io` (not prefixed by `https://`).
   */
  hostName: string

  /**
   * The VPC used by the ALB. The API-GW integration will connect to the ALB using a VPC Link for
   * this VPC.
   *
   * See the note on {@link ApiGateway} about the load balancer security group.
   */
  vpc: ec2.IVpc

  /**
   * A security group (SG) that allows incoming traffic to the ALB. Will be used by the VPC link, so
   * the API-GW integration can connect.
   *
   * This is usually the same SG as the ALB uses, because they have a rule that allows traffic from
   * others in the same SG.
   *
   * See the note on {@link ApiGateway} about the load balancer security group.
   */
  securityGroup: ec2.ISecurityGroup

  /**
   * Map request parameters (add/overwrite path/headers/query params) before forwarding to the
   * backend.
   *
   * See {@link https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-parameter-mapping.html}
   * for more on this. Read the 'Reserved headers' section for which headers cannot be overridden.
   * In addition to the AWS-reserved headers, you should not override the 'Host' header either, as
   * that's used for routing the request to the correct service behind the load balancer.
   *
   * ### Example:
   *
   * Adding a header:
   * ```
   * mapParameters: (parameters) => parameters.overwriteHeader(
   *    "X-My-Custom-Header",
   *    apigw.MappingValue.custom("my-custom-value"),
   * )
   * ```
   *
   * Overwriting the path (if, for example, you configure a `/users` route on the API Gateway that
   * you want to forward to `/api/users` on the backend):
   * ```
   * mapParameters: (parameters) => parameters.overwritePath("/api/users")
   * ```
   */
  mapParameters?: (parameters: apigw.ParameterMapping) => void
}

export type LambdaIntegrationProps = {
  /**
   * The Lambda integration uses the V2 payload format:
   * {@link https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html}
   *
   * If writing the Lambda in TypeScript, this means you should use `APIGatewayProxyEventV2` as the
   * request type, and `APIGatewayProxyResultV2` as the response type.
   */
  lambda: lambda.IFunction
}

export type SqsIntegrationProps = {
  queue: sqs.IQueue

  /**
   * Message attributes to pass on to SQS. The keys in this object are the names of the attributes.
   * Each attribute has a DataType field, and either a StringValue or BinaryValue field depending on
   * its type. See AWS docs:
   * https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_MessageAttributeValue.html
   *
   * In the StringValue field, you can do API Gateway parameter mapping:
   * https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-parameter-mapping.html
   *
   * Example:
   * ```
   * messageAttributes: {
   *   clientId: {
   *     DataType: "String",
   *     StringValue: "${context.authorizer.clientId}",
   *   },
   * },
   * ```
   */
  messageAttributes?: {
    [attributeName: string]:
      | { DataType: "String" | "Number"; StringValue: string }
      | {
          DataType: "Binary"
          /** Base64-encoded binary data object. */
          BinaryValue: string
        }
  }
}

export type EventBridgeIntegrationProps = {
  /**
   * A role is needed in order to grant api gateway access to put events
   * on the desired event bus.
   *
   * If no role is provided, a new role will be created in order to grant apigw access to the event bus
   *
   * @default: creates role that can be assumed by api gw with access to putEvents on the but inputted
   */
  role?: iam.IRole
  /**
   * An EventBridge event bus. Request bodies sent to the route will be forwarded to this event bus,
   * in the `Detail` field (see
   * https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_PutEventsRequestEntry.html).
   */
  eventBus: events.IEventBus
  /**
   * Sets the `DetailType` field (i.e., event type) on events published to the event bus.
   *
   * See AWS docs for more on this:
   * https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_PutEventsRequestEntry.html
   */
  detailType: string
}

export type AuthorizationProps<AuthScopesT extends string = string> =
  /**
   * No authentication, for when you want a fully public route (or handle authentication in the
   * backend integration).
   */
  | { type: "NONE" }
  /**
   * AWS IAM authorization.
   * https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-access-control-iam.html
   */
  | { type: "IAM" }
  /**
   * Creates a custom Lambda authorizer which reads `Authorization: Bearer <access token>` header
   * and verifies the token against a Cognito user pool.
   */
  | ({
      type: "COGNITO_USER_POOL"
    } & CognitoUserPoolAuthorizerProps<AuthScopesT>)
  /**
   * Creates a custom Lambda authorizer which reads `Authorization: Basic <base64-encoded credentials>`
   * header and verifies the credentials against a given secret.
   */
  | ({ type: "BASIC_AUTH" } & BasicAuthAuthorizerProps)
  /**
   * Creates a custom Lambda authorizer which allows both:
   * - `Authorization: Bearer <access token>` header, for which the token is checked against the
   *   given Cognito user pool
   * - `Authorization: Basic <base64-encoded credentials>` header, for which the credentials are
   *   checked against the credentials from the given basic auth secret name
   *
   * If either of these are given and valid, the request is authenticated.
   */
  | ({
      type: "COGNITO_USER_POOL_OR_BASIC_AUTH"
    } & CognitoUserPoolOrBasicAuthAuthorizerProps<AuthScopesT>)
  /**
   * Creates a custom authorizer with the given Lambda function. Use this if you have custom
   * authorization logic, and the other authorizers from this construct don't meet your needs.
   *
   * https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-lambda-authorizer.html
   */
  | ({ type: "CUSTOM_LAMBDA_AUTHORIZER" } & CustomLambdaAuthorizerProps)

export type CognitoUserPoolAuthorizerProps<
  AuthScopesT extends string = string,
> = {
  userPool: IUserPool

  /**
   * Verifies that access token claims contain the given scope.
   *
   * When defined as part of a resource server, scopes are on the format:
   * `{resource server identifier}/{scope name}`, e.g. `external/view_users`.
   *
   * To get more type safety on this parameter, see the docs for the `AuthScopesT` type parameter on
   * {@link ApiGateway}.
   */
  requiredScope?: AuthScopesT

  /**
   * Name of secret in AWS Secrets Manager that stores basic auth credentials for the backend
   * service, to be forwarded to the backend if Cognito user pool authentication succeeded.
   *
   * The secret value must follow this format:
   * ```json
   * { "username": "<username>", "password": "<password>" }
   * ```
   *
   * This prop solves the following use-case:
   * - You want to do Cognito user pool authentication in the API Gateway
   * - You want an additional auth check in the backend, but you don't want to deal with Cognito
   *   there
   * - The backend uses basic auth
   *
   * This prop solves this by letting you specify credentials to pass to the backend after API-GW
   * authentication succeeds. You can pass the encoded credentials through
   * {@link AlbIntegrationProps.mapParameters}, using the `authorizer.internalAuthorizationHeader`
   * context variable, like so:
   * ```
   * mapParameters: (parameters) => parameters.overwriteHeader(
   *   // 'Authorization' header cannot be overridden, so we use a custom header
   *   "X-Internal-Authorization",
   *   apigw.MappingValue.contextVariable("authorizer.internalAuthorizationHeader"),
   * )
   * ```
   * The backend can then check the `X-Internal-Authorization` header.
   */
  credentialsForInternalAuthorization?: string
}

export type BasicAuthAuthorizerProps = {
  /**
   * Name of secret in AWS Secrets Manager that stores basic auth credentials.
   *
   * The following formats are supported for the secret value:
   * - Single username and password:
   *   ```json
   *   { "username": "<username>", "password": "<password>" }
   *   ```
   * - Array of username + password objects:
   *   ```json
   *   { "credentials": "[{\"username\":\"<user-1>\",\"password\":\"password-1\"},{\"username\":\"<user-2>\",\"password\":\"<password-2>\"}]" }
   *   ```
   *   - The value of the `credentials` field is a string, with a stringified, escaped JSON array of
   *     objects with `username` and `password` fields.
   *   - The reason that this second format stores stringified JSON _inside_ JSON, is due to a
   *     limitation in Liflig's `load-secrets` library, which only allows storing string values.
   * - Array of base64-encoded credentials:
   *   ```json
   *   { "credentials": "[\"<encoded-credential-1>\",\"<encoded-credential-2>\"]" }
   *   ```
   *   - Each element is encoded from `<username>:<password>`.
   *   - The array is stringified for the same reason as above.
   *
   * If the secret uses one of the array formats, the authorizer will match the request's
   * Authorization header against any one of the credentials.
   */
  credentialsSecretName: string
}

export type CognitoUserPoolOrBasicAuthAuthorizerProps<
  AuthScopesT extends string = string,
> = {
  userPool: IUserPool

  /**
   * Name of secret in AWS Secrets Manager that stores basic auth credentials.
   *
   * See {@link BasicAuthAuthorizerProps.credentialsSecretName} for the supported formats.
   */
  basicAuthCredentialsSecretName?: string

  /**
   * Verifies that access token claims contain the given scope. Only applicable for requests that
   * use `Authorization: Bearer <access token>` (not applicable for basic auth).
   *
   * When defined as part of a resource server, scopes are on the format:
   * `{resource server identifier}/{scope name}`, e.g. `external/view_users`.
   *
   * To get more type safety on this parameter, see the docs for the `AuthScopesT` type parameter on
   * {@link ApiGateway}.
   */
  requiredScope?: AuthScopesT
}

type CustomLambdaAuthorizerProps = {
  /**
   * The Lambda function that will be run whenever the API Gateway route is invoked, to authenticate
   * the request. See AWS docs for more on how to write the Lambda:
   * https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-lambda-authorizer.html
   *
   * The default response format used is `HttpLambdaResponseType.SIMPLE` (format 2.0). If you write
   * your Lambda in TypeScript, this means that your handler must return
   * `APIGatewaySimpleAuthorizerResult` (from the `aws-lambda` package). The request event will also
   * use format 2.0 (`APIGatewayRequestAuthorizerEventV2` in TypeScript). See the AWS docs linked
   * above for more details on these formats.
   *
   * You can override the response format type in
   * {@link CustomLambdaAuthorizerProps.authorizerProps}.
   *
   * See the Lambdas under the `authorizers` folder next to the `ApiGateway` construct in
   * `liflig-cdk` for examples.
   */
  lambdaAuthorizer: lambda.IFunction

  /**
   * Props for the `HttpLambdaAuthorizer` construct. We provide some different defaults:
   * - `responseTypes` defaults to `[HttpLambdaResponseType.SIMPLE]`
   * - `resultsCacheTtl` defaults to `Duration.hours(1)`
   */
  authorizerProps?: Partial<authorizers.HttpLambdaAuthorizerProps>
}

/**
 * This construct tries to simplify the creation of an API Gateway for a service, by collecting most
 * of the common setup here.
 *
 * The approach followed in this construct is:
 * 1. One API-GW per service
 * 2. One subdomain per API-GW / service
 * 3. Use HTTP API, not REST
 * 4. Use a $default stage with autodeploy
 * 5. Support multiple routes (with possible `/{proxy+}` to let all sub-paths through)
 * 6. Allow custom integration/authorizer for each route, or defaults for the whole gateway
 *
 * The route integration is one of these:
 * - ALB private integration with VPC Link using HTTPS to the ALB
 * - Lambda integration
 * - SQS integration
 *
 * ### Load Balancer Security Group
 *
 * Note that the load balancer used in an {@link AlbIntegrationProps} must allow outbound HTTPS
 * traffic to its SecurityGroup. Otherwise, the VPC Link used by the API-GW can't get traffic from
 * the ALB.
 *
 * ```
 * const loadBalancerSecurityGroup = new ec2.SecurityGroup(..., {
 *   allowAllOutbound: false,
 * })
 *
 * loadBalancerSecurityGroup.addEgressRule(
 *   loadBalancerSecurityGroup,
 *   ec2.Port.tcp(443),
 *   "Outbound to self for ALB to API-GW VPC-Link",
 * )
 *
 * const loadBalancer = new lifligLoadBalancer.LoadBalancer(...,
 *   {
 *     overrideLoadBalancerProps: {
 *       securityGroup: loadBalancerSecurityGroup,
 *     },
 *   },
 * )
 * ```
 *
 * @template AuthScopesT This type parameter allows you to improve type safety on the
 * `requiredScope` field on {@link CognitoUserPoolOrBasicAuthAuthorizerProps}, by narrowing the type
 * to specific strings. You can then extend the `ApiGateway` with this type to enforce those scopes
 * across the application. Remember that auth scopes must be on the format
 * `{resource server identifier}/{scope name}`.
 *
 * Example:
 * ```
 * type AuthScopes = "external/read_users" | "internal/create_users"
 *
 * export class MyProjectApiGateway extends ApiGateway<AuthScopes> {}
 * ```
 * TypeScript will then enforce that `requiredScope` is one of `AuthScopes`, and provide
 * auto-complete.
 *
 * @author Kristian Rekstad <kre@capraconsulting.no>
 * @author Hermann Mørkrid <hem@liflig.no>
 */
export class ApiGateway<
  AuthScopesT extends string = string,
> extends constructs.Construct {
  /** The API Gateway HTTP API. This is the main construct for API-GW. */
  public readonly httpApi: apigw.HttpApi

  /** The routes which connect the {@link httpApi} to the backend integration(s). */
  public readonly routes: apigw.HttpRoute[] = []

  /** The domain which consumers must use.*/
  public readonly domain: string

  /** Access log group. */
  public readonly logGroup: logs.LogGroup

  private readonly props: ApiGatewayProps<AuthScopesT>

  constructor(
    scope: constructs.Construct,
    id: string,
    props: ApiGatewayProps<AuthScopesT>,
  ) {
    super(scope, id)
    this.props = props

    ApiGateway.validateProps(props, id, cdk.Stack.of(this))

    const customDomain = new ApiGatewayDomain(this, "CustomDomain", props.dns)
    this.domain = customDomain.fullDomainName

    let corsOptions: apigw.CorsPreflightOptions | undefined
    if (props.corsAllowAll) {
      corsOptions = {
        allowOrigins: ["*"],
        // "The Authorization header can't be wildcarded and always needs to be listed explicitly"
        // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Headers
        // Content-Type may also require explicit whitelisting: https://stackoverflow.com/a/63567647
        allowHeaders: ["Authorization", "Content-Type", "*"],
        // Not using '*' here, because "In requests with credentials, it is treated as the literal
        // method name '*' without special semantics"
        // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Methods
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.PUT,
          apigw.CorsHttpMethod.PATCH,
          apigw.CorsHttpMethod.DELETE,
          apigw.CorsHttpMethod.OPTIONS,
          apigw.CorsHttpMethod.HEAD,
        ],
        maxAge: cdk.Duration.days(1),
      }
    }

    // The actual API. This holds the routes, authorizers and integrations.
    const api = new apigw.HttpApi(this, "HttpApi-" + props.dns.subdomain, {
      // defaultIntegration: defaultIntegration, // This is for a catch-all $default route
      description: `An HTTP API for ${props.dns.subdomain}.${props.dns.hostedZone.zoneName}.`,
      disableExecuteApiEndpoint: true, // Force externals to go through custom domain. MUST be true when using Mutual TLS, for security reasons
      createDefaultStage: true,
      defaultDomainMapping: { domainName: customDomain.apiGwDomainName },
      corsPreflight: corsOptions,
      ...props?.propsOverride?.httpApi,
    })
    this.httpApi = api

    const stage = api.defaultStage?.node.defaultChild as apigw.CfnStage

    const logs = new ApiGatewayAccessLogs(
      this,
      "AccessLogs",
      stage,
      props.accessLogs,
    )
    this.logGroup = logs.logGroup

    stage.defaultRouteSettings = {
      ...stage.defaultRouteSettings,
      detailedMetricsEnabled: props.detailedMetrics ?? true,
      throttlingBurstLimit: props.throttling?.burst, // Default for account is 5_000
      throttlingRateLimit: props.throttling?.rate, // Default for account is 10_000
    }

    const defaultIntegration = props.defaultIntegration
      ? this.createIntegration(props.defaultIntegration, props.dns)
      : undefined

    const defaultAuthorizer = props.defaultAuthorization
      ? this.createAuthorizer("DefaultAuthorizer", props.defaultAuthorization)
      : undefined

    for (const route of props.routes) {
      let integration: apigw.HttpRouteIntegration
      if (route.integration) {
        integration = this.createIntegration(route.integration, props.dns)
      } else {
        integration = defaultIntegration! // Verified in validateProps
      }

      let authorizer: apigw.IHttpRouteAuthorizer | undefined
      if (route.authorization) {
        authorizer = this.createAuthorizer(
          // Using the route path here caused CloudFormation to fail due to resource names being too
          // long. Therefore, we now hash the route path to get a shorter name.
          `RouteAuthorizer${shortHash(`${route.method ?? ""}${route.path}`)}`,
          route.authorization,
        )
      } else {
        authorizer = defaultAuthorizer
      }

      const routePaths = [route.path]
      if (route.includeSubpaths === true) {
        // If we include sub-paths, we add an additional route with /{proxy+} (the + means it will
        // match all subroutes). We want both this route and the normal route without /{proxy+},
        // since /{proxy+} will only match the base path with trailing slash.
        routePaths.push(
          route.path + (route.path === "/" ? "" : "/") + "{proxy+}",
        )
      }

      for (const routePath of routePaths) {
        // The previous version of the API Gateway construct had a single route with the ID
        // 'DefaultProxyRoute', and all gateways we used exposed the route /{proxy+}. When trying to
        // change to this new version of the construct, deployment failed for gateways exposing
        // /{proxy+}, because "a route with that key [i.e. path + method] already exists". We think
        // this may be because we used the same route path, but with a new route ID, causing
        // confusion for CloudFormation. So we keep the old route ID here for /{proxy+}.
        const routeId =
          routePath === "/{proxy+}" ? "DefaultProxyRoute" : `Route-${routePath}`

        this.routes.push(
          new apigw.HttpRoute(this, routeId, {
            httpApi: api,
            integration: integration,
            authorizer: authorizer,
            routeKey: apigw.HttpRouteKey.with(
              routePath,
              route.method
                ? apigw.HttpMethod[route.method]
                : apigw.HttpMethod.ANY,
            ),
          }),
        )
      }
    }

    tagResources(this, () => ({ service: props.dns.subdomain }))
  }

  /** @throws Error */
  private static validateProps(
    props: ApiGatewayProps,
    id: string,
    stack: cdk.Stack,
  ) {
    for (const route of props.routes) {
      if (!route.integration && !props.defaultIntegration) {
        throw new Error(
          `No integration defined for route '${route.path}', and no default integration specified for the gateway`,
        )
      }
      if (!route.authorization && !props.defaultAuthorization) {
        throw new Error(
          `No authorization defined for route '${route.path}', and no default authorization specified for the gateway`,
        )
      }
      if (!route.path.startsWith("/")) {
        throw new Error(
          `Invalid path '${route.path}': paths must begin with '/' (use '/' for root path)`,
        )
      }
      if (route.path !== "/" && route.path.endsWith("/")) {
        throw new Error(
          `Invalid path '${route.path}': paths cannot end with '/' (except root path)`,
        )
      }
      if (
        route.integration?.type === "ALB" &&
        route.integration.hostName.startsWith("https:")
      ) {
        throw new Error(
          `The albIntegration.hostHttpsName should not include a protocol: ${route.integration.hostName}`,
        )
      }
    }
    if (props.dns.subdomain === "" || props.dns.subdomain.includes(" ")) {
      throw new Error(
        `Subdomain must be set, and not contain spaces: ${props.dns.subdomain}`,
      )
    }
    if (props.throttling?.burst && props.throttling.burst > 5_000) {
      console.warn(
        `⚠️ Your throttling burst limit '${props.throttling.burst}' is higher than the AWS Account limit. Make sure your account has upgraded this quota! `,
        stack,
        id,
      )
    }
    if (props.throttling?.rate && props.throttling.rate > 10_000) {
      console.warn(
        `⚠️ Your throttling rate limit '${props.throttling.rate}' is higher than the AWS Account limit. Make sure your account has upgraded this quota! `,
        stack,
        id,
      )
    }
  }

  /**
   * The authorizer only accepts requests from external users that are authorized.
   * Unauthorized users are stopped in the API-GW, and not forwarded to the integration.
   */
  private createAuthorizer<AuthScopesT extends string>(
    id: string,
    authorization: AuthorizationProps<AuthScopesT>,
  ): apigw.IHttpRouteAuthorizer | undefined {
    switch (authorization.type) {
      case "NONE": {
        return undefined
      }
      case "IAM": {
        // API Gateway invokes your API route only if the client has execute-api permission for the route.
        // The client has to use AWS SigV4 to identify themselves in the request.
        // Read this page for help with IAM and API-GW https://docs.aws.amazon.com/apigateway/latest/developerguide/security_iam_service-with-iam.html
        // Note that [resource policies are not supported yet for HTTP](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-access-control-iam.html)
        return new authorizers.HttpIamAuthorizer()
      }
      case "COGNITO_USER_POOL": {
        // We use a custom lambda authorizer here instead of the `HttpUserPoolAuthorizer` provided
        // by CDK, in order to support `requiredScope` and setting of custom context variables.
        const authorizer = new CognitoUserPoolAuthorizer(
          this,
          id + "Lambda",
          authorization,
        )

        return new authorizers.HttpLambdaAuthorizer(id, authorizer.lambda, {
          responseTypes: authorizer.responseTypes,
          // Max 1h, or disabled (0s). The value only matters when invalidating/dynamic credentials
          resultsCacheTtl: cdk.Duration.hours(1),
        })
      }
      case "BASIC_AUTH": {
        const authorizer = new BasicAuthAuthorizer(
          this,
          id + "Lambda",
          authorization,
        )

        return new authorizers.HttpLambdaAuthorizer(id, authorizer.lambda, {
          responseTypes: authorizer.responseTypes,
          // Max 1h, or disabled (0s). The value only matters when invalidating/dynamic credentials
          resultsCacheTtl: cdk.Duration.minutes(30),
        })
      }
      case "COGNITO_USER_POOL_OR_BASIC_AUTH": {
        const authorizer = new CognitoUserPoolOrBasicAuthAuthorizer(
          this,
          id + "Lambda",
          authorization,
        )

        return new authorizers.HttpLambdaAuthorizer(id, authorizer.lambda, {
          responseTypes: authorizer.responseTypes,
          // Max 1h, or disabled (0s). The value only matters when invalidating/dynamic credentials
          resultsCacheTtl: cdk.Duration.hours(1),
        })
      }
      case "CUSTOM_LAMBDA_AUTHORIZER": {
        return new authorizers.HttpLambdaAuthorizer(
          id,
          authorization.lambdaAuthorizer,
          {
            ...authorization.authorizerProps,
            responseTypes: authorization.authorizerProps?.responseTypes ?? [
              authorizers.HttpLambdaResponseType.SIMPLE,
            ],
            resultsCacheTtl:
              authorization.authorizerProps?.resultsCacheTtl ??
              cdk.Duration.hours(1),
          },
        )
      }
    }
  }

  private createIntegration(
    integration: IntegrationProps,
    dns: ApiGatewayProps["dns"],
  ): apigw.HttpRouteIntegration {
    switch (integration.type) {
      case "ALB": {
        // The VPCLink connects the integration into the ALB's VPC. Must be manually created when
        // the VPC is imported, which is the case when using CorePlatformConsumer.
        const vpcLink = new apigw.VpcLink(this, "AlbVpcLink", {
          vpc: integration.vpc,
          securityGroups: [integration.securityGroup],
          subnets: integration.vpc.selectSubnets(), // This correctly selects the private subnets
        })

        const parameterMapping = new apigw.ParameterMapping()
          /** See {@link AlbIntegrationProps.hostName} */
          .overwriteHeader(
            "Host",
            // The Host header can NOT use dynamic mapping, like $context.domainName etc.
            apigw.MappingValue.custom(integration.hostName),
          )
        if (integration.mapParameters !== undefined) {
          integration.mapParameters(parameterMapping)
        }

        return new integrations.HttpAlbIntegration(
          "AlbIntegration-" + dns.subdomain,
          integration.loadBalancerListener,
          {
            secureServerName: integration.hostName,
            vpcLink: vpcLink,
            method: apigw.HttpMethod.ANY,
            parameterMapping,
          },
        )
      }
      case "Lambda": {
        return new integrations.HttpLambdaIntegration(
          "LambdaIntegration",
          integration.lambda,
          {
            payloadFormatVersion: apigw.PayloadFormatVersion.VERSION_2_0,
            parameterMapping: undefined,
          },
        )
      }
      case "SQS": {
        // API-GW does not have access to SQS by default
        const role = new iam.Role(
          this,
          `ApiGwTo${integration.queue.node.id}ServiceRole`,
          {
            description:
              "Allows API-GW to add messages to " + integration.queue.queueArn,
            assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
          },
        )
        integration.queue.grantSendMessages(role)

        let parameterMapping = new apigw.ParameterMapping()
          // https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-aws-services-reference.html#SQS-SendMessage
          .custom("QueueUrl", integration.queue.queueUrl)
          .custom("MessageBody", "$request.body")
          .custom("Region", "eu-west-1") // Change this if the SQS queue is in another region!

        if (integration.messageAttributes) {
          parameterMapping = parameterMapping.custom(
            "MessageAttributes",
            JSON.stringify(integration.messageAttributes),
          )
        }

        return new SqsRouteIntegration("SqsIntegration", {
          type: apigw.HttpIntegrationType.AWS_PROXY,
          subtype: apigw.HttpIntegrationSubtype.SQS_SEND_MESSAGE,
          credentials: apigw.IntegrationCredentials.fromRole(role),
          parameterMapping: parameterMapping,
          payloadFormatVersion: apigw.PayloadFormatVersion.VERSION_1_0,
        })
      }
      case "EventBridge": {
        /**
         * API-GW does not have access to put events to event bus by default
         *
         * By default, we will create a new role to be used if this is undefined in the input
         */
        const role =
          integration.role ??
          new iam.Role(
            this,
            `ApiGwTo${integration.eventBus.node.id}ServiceRole`,
            {
              description: `Allows API-GW to put events to ${integration.eventBus.eventBusArn}`,
              assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com"),
            },
          )
        integration.eventBus.grantPutEventsTo(role)

        const parameterMapping = new apigw.ParameterMapping()
          // https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_PutEventsRequestEntry.html
          .custom("EventBusName", integration.eventBus.eventBusName)
          .custom("Detail", "$request.body")
          .custom("DetailType", integration.detailType)
          .custom("Source", "$context.apiId")

        return new EventBridgeRouteIntegration("EventBridgeIntegration", {
          type: apigw.HttpIntegrationType.AWS_PROXY,
          subtype: apigw.HttpIntegrationSubtype.EVENTBRIDGE_PUT_EVENTS,
          credentials: apigw.IntegrationCredentials.fromRole(role),
          parameterMapping: parameterMapping,
          payloadFormatVersion: apigw.PayloadFormatVersion.VERSION_1_0,
        })
      }
    }
  }

  /**
   * Allows a grantable target (role, user etc.) permission to invoke the API.
   * Only works when using `IAM` as {@link ApiGatewayRoute.authorization}.
   *
   * @param target A grantable, like {@link iam.Role}
   */
  public grantInvoke(target: iam.IGrantable) {
    for (const routeProps of this.props.routes) {
      const authType =
        routeProps.authorization?.type ?? this.props.defaultAuthorization?.type

      if (authType !== "IAM") {
        throw new Error(
          `Cannot grant invoke for an API Gateway when not using IAM auth (found auth '${authType}' on route '${routeProps.path}') [${cdk.Stack.of(this).stackName}]`,
        )
      }
    }

    for (const route of this.routes) {
      route.grantInvoke(target)
    }
  }
}

/** Acts as glue (between the integration props and the HttpApi) when creating an SqsIntegration. */
class SqsRouteIntegration extends apigw.HttpRouteIntegration {
  /**
   * @param id The id used in the {@link apigw.HttpIntegration} construct
   *    created internally by {@link apigw.HttpRouteIntegration._bindToRoute}.
   *    [Source code](https://github.com/aws/aws-cdk/blob/b5ae37782bc3cb637eeef9fbb1fbe2c5efdfc068/packages/%40aws-cdk/aws-apigatewayv2/lib/http/integration.ts#L321)
   * @param integrationProps The props to pass to the {@link apigw.HttpIntegration} construct.
   */
  constructor(
    id: string,
    private integrationProps: apigw.HttpRouteIntegrationConfig,
  ) {
    super(id)
  }

  /**
   * This sends the properties needed for creating a {@link apigw.HttpIntegration} to the
   * {@link apigw.HttpRouteIntegration}.
   */
  bind(): apigw.HttpRouteIntegrationConfig {
    // This method is called by:
    // https://github.com/aws/aws-cdk/blob/b5ae37782bc3cb637eeef9fbb1fbe2c5efdfc068/packages/%40aws-cdk/aws-apigatewayv2/lib/http/integration.ts#L319
    return this.integrationProps
  }
}

/** Acts as glue (between the integration props and the HttpApi) when creating an EventBridge integration. */
class EventBridgeRouteIntegration extends apigw.HttpRouteIntegration {
  /**
   * @param id The id used in the {@link apigw.HttpIntegration} construct
   *    created internally by {@link apigw.HttpRouteIntegration._bindToRoute}.
   *    [Source code](https://github.com/aws/aws-cdk/blob/b5ae37782bc3cb637eeef9fbb1fbe2c5efdfc068/packages/%40aws-cdk/aws-apigatewayv2/lib/http/integration.ts#L321)
   * @param integrationProps The props to pass to the {@link apigw.HttpIntegration} construct.
   */
  constructor(
    id: string,
    private integrationProps: apigw.HttpRouteIntegrationConfig,
  ) {
    super(id)
  }

  /**
   * This sends the properties needed for creating a {@link apigw.HttpIntegration} to the
   * {@link apigw.HttpRouteIntegration}.
   */
  bind(): apigw.HttpRouteIntegrationConfig {
    // This method is called by:
    // https://github.com/aws/aws-cdk/blob/b5ae37782bc3cb637eeef9fbb1fbe2c5efdfc068/packages/%40aws-cdk/aws-apigatewayv2/lib/http/integration.ts#L319
    return this.integrationProps
  }
}

/**
 * When using `NodejsFunction` with `entry`, we point CDK to a file with our lambda code. This can
 * either be a TypeScript or JavaScript file. When creating constructs in tests inside this library,
 * the entry will point to the TypeScript file in the source code. But when a library consumer uses
 * this, it will instead point to the transpiled JavaScript file. So to set the correct file
 * extension, we must check if we're being run in the context of the TypeScript source code
 * (src/api-gateway), otherwise we're being run by a consumer as transpiled JavaScript.
 */
const authorizerFileExtension = __dirname.endsWith("src/api-gateway")
  ? "ts"
  : "js"

/**
 * Creates a custom Lambda authorizer which reads `Authorization: Bearer <access token>` header and
 * verifies the token against a Cognito user pool.
 */
class CognitoUserPoolAuthorizer<
  AuthScopesT extends string,
> extends constructs.Construct {
  public readonly lambda: lambda.IFunction

  /**
   * Use simple response type (`{ isAuthorized: true/false }`), as opposed to returning an IAM
   * Policy document.
   */
  public readonly responseTypes: authorizers.HttpLambdaResponseType[] = [
    authorizers.HttpLambdaResponseType.SIMPLE,
  ]

  constructor(
    scope: constructs.Construct,
    id: string,
    props: CognitoUserPoolAuthorizerProps<AuthScopesT>,
  ) {
    super(scope, id)

    this.lambda = new lambdaNodejs.NodejsFunction(this, "AuthorizerFunction", {
      entry: path.join(
        __dirname,
        `authorizers/cognito-user-pool-authorizer.${authorizerFileExtension}`,
      ),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(5),
      environment: {
        ["USER_POOL_ID"]: props.userPool.userPoolId,
        ["REQUIRED_SCOPE"]: props.requiredScope ?? "",
        ["CREDENTIALS_FOR_INTERNAL_AUTHORIZATION"]:
          props.credentialsForInternalAuthorization
            ? props.credentialsForInternalAuthorization
            : "",
      },
    })

    if (props.credentialsForInternalAuthorization) {
      secretsmanager.Secret.fromSecretNameV2(
        scope,
        id + "BasicAuthSecret",
        props.credentialsForInternalAuthorization,
      ).grantRead(this.lambda)
    }
  }
}

/**
 * Creates a custom Lambda authorizer which reads `Authorization: Basic <base64-encoded credentials>`
 * header and verifies the credentials against a given secret.
 */
class BasicAuthAuthorizer extends constructs.Construct {
  public readonly lambda: lambda.IFunction

  // Simple is `{ isAuthorized: true/false }`, as opposed to returning an IAM Policy document
  public readonly responseTypes: authorizers.HttpLambdaResponseType[] = [
    authorizers.HttpLambdaResponseType.SIMPLE,
  ]

  constructor(
    scope: constructs.Construct,
    id: string,
    props: BasicAuthAuthorizerProps,
  ) {
    super(scope, id)

    this.lambda = new lambdaNodejs.NodejsFunction(this, "BasicAuthLambda", {
      entry: path.join(
        __dirname,
        `authorizers/basic-auth-authorizer.${authorizerFileExtension}`,
      ),
      description:
        "An authorizer for API-Gateway that checks Basic Auth credentials on requests",
      runtime: lambda.Runtime.NODEJS_22_X,
      environment: {
        ["CREDENTIALS_SECRET_NAME"]: props.credentialsSecretName
          ? props.credentialsSecretName
          : "",
      },
    })

    secretsmanager.Secret.fromSecretNameV2(
      scope,
      id + "BasicAuthSecret",
      props.credentialsSecretName,
    ).grantRead(this.lambda)
  }
}

/**
 * Creates a custom Lambda authorizer which allows both:
 * - `Authorization: Bearer <access token>` header, for which the token is checked against the given
 *   Cognito user pool
 * - `Authorization: Basic <base64-encoded credentials>` header, for which the credentials are
 *   checked against the credentials from the given basic auth secret name
 *
 * If either of these are given and valid, the request is authenticated.
 */
class CognitoUserPoolOrBasicAuthAuthorizer<
  AuthScopesT extends string,
> extends constructs.Construct {
  public readonly lambda: lambda.IFunction

  /**
   * Use simple response type (`{ isAuthorized: true/false }`), as opposed to returning an IAM
   * Policy document.
   */
  public readonly responseTypes: authorizers.HttpLambdaResponseType[] = [
    authorizers.HttpLambdaResponseType.SIMPLE,
  ]

  constructor(
    scope: constructs.Construct,
    id: string,
    props: CognitoUserPoolOrBasicAuthAuthorizerProps<AuthScopesT>,
  ) {
    super(scope, id)

    this.lambda = new lambdaNodejs.NodejsFunction(this, "AuthorizerFunction", {
      entry: path.join(
        __dirname,
        `authorizers/cognito-user-pool-or-basic-auth-authorizer.${authorizerFileExtension}`,
      ),
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(5),
      environment: {
        ["USER_POOL_ID"]: props.userPool ? props.userPool.userPoolId : "",
        ["REQUIRED_SCOPE"]: props.requiredScope ?? "",
        ["BASIC_AUTH_CREDENTIALS_SECRET_NAME"]:
          props.basicAuthCredentialsSecretName
            ? props.basicAuthCredentialsSecretName
            : "",
      },
    })

    if (props.basicAuthCredentialsSecretName) {
      secretsmanager.Secret.fromSecretNameV2(
        scope,
        id + "BasicAuthSecret",
        props.basicAuthCredentialsSecretName,
      ).grantRead(this.lambda)
    }
  }
}

/** Returns a short semi-unique hash of the given string. */
function shortHash(str: string): string {
  // SHA-1 is no-no when we need cryptographic security, but here we just it for shortening a name,
  // which is fine
  return createHash("sha1").update(str).digest("hex").substring(0, 10)
}
