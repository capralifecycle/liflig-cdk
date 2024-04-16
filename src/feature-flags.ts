import * as constructs from "constructs"

interface FeatureFlagInfo {
  /**
   * The default value for the feature flag.
   *
   * NOTE: This will be the value used for consumers that have not
   * explicitly set the feature flag (which will be most of them!),
   * so we should make sure that the default value does NOT lead
   * to any breaking behavior.
   */
  default: boolean
  /**
   * A short description of the feature flag.
   */
  description: string
}

// Custom feature flags for liflig-cdk
/**
 * @deprecated No longer in use, this is now the default behaviour.
 */
export const FEATURE_FLAG_CDK_PIPELINES_SPEED_UP =
  "@liflig-cdk/cdk-pipelines:enableExperimentalSpeedUp"

const FLAGS: { [key: string]: FeatureFlagInfo } = {
  [FEATURE_FLAG_CDK_PIPELINES_SPEED_UP]: {
    default: true,
    description:
      "Reduce execution time of CDK Pipelines by making various tweaks (e.g., skip creation of CloudFormation changesets, disable CodePipeline S3 polling).",
  },
}

const getFeatureFlagDefault = (flagName: string) => {
  return FLAGS[flagName]?.default ?? false
}

/**
 * Exposes feature flags we can use in liflig-cdk to allow consumers to opt-in
 * to experimental functionality without affecting current consumers and having
 * to pollute the official library API with experimental properties and behavior.
 *
 * NOTE: We should only use these flags temporarily and very sparingly as they lead
 * to a brittle and more complex codebase with a lot of branching logic.
 * Once an experiment has concluded we should remove them and update the
 * official library API.
 */
export class FeatureFlags {
  private constructor(private readonly scope: constructs.IConstruct) {}
  public static of(scope: constructs.Construct) {
    return new FeatureFlags(scope)
  }
  public isEnabled(flagName: string) {
    if (!Object.keys(FLAGS).includes(flagName)) {
      throw new Error(`Unsupported feature flag ${flagName}`)
    }
    const contextValue = this.scope.node.tryGetContext(flagName) as unknown
    if (contextValue === undefined) {
      return getFeatureFlagDefault(flagName)
    } else if (
      Object.prototype.toString.call(contextValue) === "[object Boolean]"
    ) {
      return Boolean(contextValue)
    }
    throw new Error(
      `Unsupported value for feature flag ${flagName}. Only boolean values are supported.`,
    )
  }
}
