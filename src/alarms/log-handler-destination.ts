import * as cdk from "aws-cdk-lib"
import * as iam from "aws-cdk-lib/aws-iam"
import type * as lambda from "aws-cdk-lib/aws-lambda"
import type * as logs from "aws-cdk-lib/aws-logs"
import * as logsDestinations from "aws-cdk-lib/aws-logs-destinations"
import type * as constructs from "constructs"

const permissionId = "AllowInvokeFromCloudWatchLogs"

/**
 * A `LambdaDestination` for a log handler Lambda that is shared across many
 * log groups.
 *
 * By default `LambdaDestination` adds one resource policy statement per
 * subscription filter. With a shared handler these add up across stacks until
 * the deploy fails with `PolicyLengthExceededException` (Lambda's 20 KB policy
 * limit). See https://github.com/aws/aws-cdk/issues/14198.
 *
 * Instead, the handler gets a single statement allowing CloudWatch Logs to
 * invoke it from any log group in its account and region. Which log groups
 * are actually forwarded is still controlled by the subscription filters.
 */
export class LogHandlerDestination extends logsDestinations.LambdaDestination {
  constructor(private readonly handler: lambda.IFunction) {
    super(handler, { addPermissions: false })
  }

  override bind(
    scope: constructs.Construct,
    logGroup: logs.ILogGroup,
  ): logs.LogSubscriptionDestinationConfig {
    if (!this.handler.permissionsNode.tryFindChild(permissionId)) {
      this.handler.addPermission(permissionId, {
        principal: new iam.ServicePrincipal("logs.amazonaws.com"),
        sourceAccount: this.handler.env.account,
        sourceArn: cdk.Stack.of(this.handler).formatArn({
          service: "logs",
          region: this.handler.env.region,
          account: this.handler.env.account,
          resource: "log-group",
          resourceName: "*",
          arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
        }),
      })
    }

    // The subscription filter can only be created once the handler
    // allows CloudWatch Logs to invoke it.
    const permission = this.handler.permissionsNode.tryFindChild(permissionId)
    if (permission) {
      scope.node.addDependency(permission)
    }

    return super.bind(scope, logGroup)
  }
}
