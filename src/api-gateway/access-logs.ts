import * as cdk from "aws-cdk-lib"
import type * as apigw from "aws-cdk-lib/aws-apigatewayv2"
import * as iam from "aws-cdk-lib/aws-iam"
import * as logs from "aws-cdk-lib/aws-logs"
import * as constructs from "constructs"

export type ApiGatewayAccessLogsProps = {
  /**
   * Delete the access logs if this construct is deleted?
   *
   * Maybe you want to DESTROY instead. Or for legal reasons, retain for audit.
   *
   * @default RemovalPolicy.RETAIN
   */
  removalPolicy?: cdk.RemovalPolicy

  /**
   * How long to keep the logs. If undefined, uses the same default as new AWS log groups.
   *
   * @default RetentionDays.TWO_YEARS
   */
  retention?: logs.RetentionDays

  /**
   * A custom JSON log format, which uses variables from `"$context"`.
   *
   * See [AWS: CloudWatch log formats for API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-logging.html#apigateway-cloudwatch-log-formats)
   * for formats and rules. It is possible to use other formats like CLF and XML, but this construct
   * only supports JSON for now.
   *
   * For a list of all possible variables to log, see
   * [AWS: $context Variables for data models, authorizers, mapping templates, and CloudWatch access logging](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-mapping-template-reference.html#context-variable-reference)
   * and
   * [AWS: $context Variables for access logging only](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-mapping-template-reference.html#context-variable-reference-access-logging-only) .
   *
   * @default {@link defaultAccessLogFormat}
   */
  accessLogFormat?: Record<string, unknown>
}

/**
 * A slightly extended version of the [default JSON format suggested by AWS](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html#http-api-enable-logging.examples).
 */
const defaultAccessLogFormat = {
  requestId: "$context.requestId",
  userAgent: "$context.identity.userAgent",
  ip: "$context.identity.sourceIp",
  /** CLF format: `dd/MMM/yyyy:HH:mm:ss +-hhmm` */
  requestTime: "$context.requestTime",
  requestTimeEpoch: "$context.requestTimeEpoch",
  dataProcessed: "$context.dataProcessed",
  httpMethod: "$context.httpMethod",
  path: "$context.path",
  routeKey: "$context.routeKey",
  status: "$context.status",
  protocol: "$context.protocol",
  responseLength: "$context.responseLength",
  responseLatency: "$context.responseLatency",
  domainName: "$context.domainName",
  error: {
    type: "$context.error.responseType",
    gatewayError: "$context.error.message",
    integrationError: "$context.integration.error",
    authorizerError: "$context.authorizer.error",
  },
  integration: {
    latency: "$context.integration.latency",
    requestId: "$context.integration.requestId",
    responseStatus: "$context.integration.status",
  },
  auth: {
    iam: {
      userArn: "$context.identity.userArn",
      awsAccount: "$context.identity.accountId",
      awsPrincipal: "$context.identity.caller",
      awsPrincipalOrg: "$context.identity.principalOrgId",
    },
    // We output these context variables from our Lambda authorizers
    basic: { username: "$context.authorizer.username" },
    cognito: { clientId: "$context.authorizer.clientId" },
  },
  awsEndpointRequest: {
    id: "$context.awsEndpointRequestId",
    id2: "$context.awsEndpointRequestId2",
  },
  message:
    "$context.identity.sourceIp - $context.httpMethod $context.domainName $context.path ($context.routeKey) - $context.status [$context.responseLatency ms]",
}

/**
 * Enables access logs on the API-Gateway.
 *
 * @author Kristian Rekstad <kre@capraconsulting.no>
 */
export class ApiGatewayAccessLogs extends constructs.Construct {
  public readonly logGroup: logs.LogGroup

  constructor(
    scope: constructs.Construct,
    id: string,
    stage: apigw.CfnStage,
    props: ApiGatewayAccessLogsProps | undefined,
  ) {
    super(scope, id)

    // logGroup is set up with help from: https://github.com/aws/aws-cdk/issues/11100#issuecomment-904627081
    // Not sure if HTTP API actually needs the service role with managed policy: https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html
    const accessLogs = new logs.LogGroup(this, "AccessLogGroup", {
      retention: props?.retention,
      removalPolicy: props?.removalPolicy ?? cdk.RemovalPolicy.RETAIN,
      // Always use the default encryption key. Otherwise, the key needs special policies:
      // https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/encrypt-log-data-kms.html#cmk-permissions
      encryptionKey: undefined,
    })
    this.logGroup = accessLogs

    stage.accessLogSettings = {
      destinationArn: accessLogs.logGroupArn,
      format: JSON.stringify(props?.accessLogFormat ?? defaultAccessLogFormat),
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
