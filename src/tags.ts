import * as cdk from "aws-cdk-lib"
import * as cm from "aws-cdk-lib/aws-certificatemanager"
import type * as constructs from "constructs"

function shouldTag(construct: constructs.IConstruct) {
  // See https://github.com/aws/aws-cdk/issues/14519#issuecomment-833103147
  if (construct instanceof cm.DnsValidatedCertificate) {
    return false
  }

  return true
}

/**
 * Tag all supported resources within an application.
 *
 * CDK will propagate tags too all resources that support it.
 */
export function tagResources(
  scope: constructs.Construct,
  tags: (stack: cdk.Stack) => Record<string, string>,
): void {
  cdk.Aspects.of(scope).add({
    visit(construct: constructs.IConstruct) {
      if (cdk.TagManager.isTaggable(construct) && shouldTag(construct)) {
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
