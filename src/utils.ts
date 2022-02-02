import * as constructs from "constructs"
import * as cdk from "aws-cdk-lib"

export function getStageOrApp(
  scope: constructs.Construct,
): constructs.Construct {
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
