import * as cdk from "@aws-cdk/core"

function getStageOrApp(scope: cdk.Construct): cdk.Construct {
  const stage = cdk.Stage.of(scope)
  if (stage != null) {
    return stage
  }

  const app = scope.node.root
  if (!cdk.App.isApp(app)) {
    throw new Error(`Could not locate cdk App for ${scope.node.id}`)
  }
  return app
}

/**
 * The intention of this method is to force exports from the stack
 * without the need for another stack to depend on it.
 *
 * This helps us to solve two problems:
 *
 *   1. When we remove a resource that depends on the stack, it will
 *      first attempt to remove the export from the stack, causing
 *      the deployment to fail. Now it will leave the export.
 *      See also https://github.com/aws/aws-cdk/issues/7602
 *
 *   2. During development, we can deploy certain resources directly from
 *      localhost, without adding new exports to the stack which is
 *      managed by the CD pipeline.
 *
 * The stack produced is never supposed to be deployed. It should only
 * be used as hints for CDK.
 */
export class ForceExports extends cdk.Stack {
  private i = 0

  constructor(scope: cdk.Construct) {
    super(getStageOrApp(scope), `EXPORTS-${scope.node.id}`, {
      env: {
        account: cdk.Stack.of(scope).account,
        region: cdk.Stack.of(scope).region,
      },
    })
  }

  private genId() {
    return `Output${this.i++}`
  }

  public register(resource: string): void {
    new cdk.CfnOutput(this, this.genId(), {
      value: resource,
    })
  }
}
