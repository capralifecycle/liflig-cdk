import * as cdk from "@aws-cdk/core"

/**
 * Tag all supported resources within an application.
 *
 * CDK will propagate tags too all resources that support it.
 */
export function tagResources(
  app: cdk.App,
  tags: (stack: cdk.Stack) => Record<string, string>,
): void {
  // Keep the deprecated code to remain compatible with older CDK versions.
  // We will resolve this deprecation later.
  // eslint-disable-next-line deprecation/deprecation
  app.node.applyAspect({
    visit(construct: cdk.IConstruct) {
      if (cdk.TagManager.isTaggable(construct)) {
        const stack = construct.node.scopes.find((it): it is cdk.Stack =>
          cdk.Stack.isStack(it),
        )

        if (stack != null) {
          for (const [key, value] of Object.entries(tags(stack))) {
            construct.tags.setTag(key, value, 100, true)
          }
        }
      }
    },
  })
}
