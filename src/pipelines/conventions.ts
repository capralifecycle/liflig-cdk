/**
 * The role used when running "cdk deploy".
 */
export const cdkDeployRoleName = "liflig-cdk-deployer-cdk"

/**
 * Path on S3 for pipeline configuration.
 */
export function pipelineS3Prefix(pipelineName: string): string {
  return `pipelines/${pipelineName}/`
}

/**
 * Key in S3 bucket used to trigger pipeline.
 *
 * This is an empty file within the pipeline path.
 */
export function pipelineS3TriggerKey(pipelineName: string): string {
  return `pipelines/${pipelineName}/trigger`
}
