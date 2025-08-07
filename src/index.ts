import * as alarms from "./alarms"
import * as apigw from "./api-gateway"
import * as cdkPipelines from "./cdk-pipelines"
import * as cloudTrailSlackIntegration from "./cloudtrail-slack-integration"
import * as configureParameters from "./configure-parameters"
import * as ecs from "./ecs"
import * as loadBalancer from "./load-balancer"
import * as platform from "./platform"
import * as rds from "./rds"
import * as ses from "./ses"
import * as webapp from "./webapp"

// TODO: We want to switch exports so they every construct under
//  a namespace such as the sns export.

export { BastionHost } from "./bastion-host"
export * from "./build-artifacts"
export { CrossRegionSsmParameter } from "./cross-region-ssm-parameter"
export { HostedZoneWithParam } from "./hosted-zone-with-param"
export { createCloudAssemblySnapshot } from "./snapshots"
export { SsmParameterBackedResource } from "./ssm-parameter-backed-resource"
export { SsmParameterReader } from "./ssm-parameter-reader"
export { tagResources } from "./tags"
export { WebappDeployViaRole } from "./webapp-deploy-via-role"

export {
  alarms,
  cdkPipelines,
  ses,
  webapp,
  configureParameters,
  ecs,
  loadBalancer,
  rds,
  platform,
  cloudTrailSlackIntegration,
  apigw,
}

/**
 * Check if we are synthesizing a snapshot by setting IS_SNAPSHOT
 * environment variable to true.
 *
 * This allows for special conditional logic that should only
 * happen during snapshot creation.
 */
export const isSnapshot = process.env.IS_SNAPSHOT === "true"
