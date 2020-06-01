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
  app.node.applyAspect({
    visit(construct: cdk.IConstruct) {
      if (construct instanceof cdk.Construct) {
        const stack = construct.node.scopes.find(cdk.Stack.isStack)
        if (stack != null) {
          for (const [key, value] of Object.entries(tags(stack))) {
            cdk.Tag.add(construct, key, value)
          }
        }
      }
    },
  })
}
