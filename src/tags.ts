import * as cdk from "@aws-cdk/core"

/**
 * Tag all supported resources within an application.
 *
 * CDK will propagate tags too all resources that support it.
 */
export function tagResources(
  scope: cdk.Construct,
  tags: (stack: cdk.Stack) => Record<string, string>,
): void {
  // Keep the deprecated code to remain compatible with older CDK versions.
  // We will resolve this deprecation later.
  // eslint-disable-next-line deprecation/deprecation
  scope.node.applyAspect({
    visit(construct: cdk.IConstruct) {
      if (cdk.TagManager.isTaggable(construct)) {
        // We pick the last stack in chain to support stages where
        // there are multiple stacks.
        const allStacks = construct.node.scopes.filter((it): it is cdk.Stack =>
          cdk.Stack.isStack(it),
        )

        const stack =
          allStacks.length > 0 ? allStacks[allStacks.length - 1] : undefined
        if (stack != null) {
          for (const [key, value] of Object.entries(tags(stack))) {
            construct.tags.setTag(key, value, 100, true)
          }
        }
      }
    },
  })
}
