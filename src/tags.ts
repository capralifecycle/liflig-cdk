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
      if (cdk.Stack.isStack(construct)) {
        for (const [key, value] of Object.entries(tags(construct))) {
          cdk.Tag.add(construct, key, value)
        }
      }
    },
  })
}
