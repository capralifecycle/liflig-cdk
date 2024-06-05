import * as alarms from "./alarms"
import * as cdkPipelines from "./cdk-pipelines"
import * as griid from "./griid"
import * as ses from "./ses"
import * as webapp from "./webapp"
import * as configureParameters from "./configure-parameters"
import * as ecs from "./ecs"
import * as loadBalancer from "./load-balancer"
import * as cloudTrailSlackIntegration from "./cloudtrail-slack-integration"
import * as rds from "./rds"
import * as platform from "./platform"

// TODO: We want to switch exports so they every construct under
//  a namespace such as the sns export.

export { BastionHost } from "./bastion-host"
export * from "./build-artifacts"
export { CrossRegionSsmParameter } from "./cross-region-ssm-parameter"
export * from "./ecs-update-image"
export { HostedZoneWithParam } from "./hosted-zone-with-param"
export { createCloudAssemblySnapshot } from "./snapshots"
export { SsmParameterBackedResource } from "./ssm-parameter-backed-resource"
export { SsmParameterReader } from "./ssm-parameter-reader"
export { tagResources } from "./tags"
export { WebappDeployViaRole } from "./webapp-deploy-via-role"

export {
  alarms,
  cdkPipelines,
  griid,
  ses,
  webapp,
  configureParameters,
  ecs,
  loadBalancer,
  rds,
  platform,
  cloudTrailSlackIntegration,
}

/**
 * Check if we are synthesizing a snapshot by setting IS_SNAPSHOT
 * environment variable to true.
 *
 * This allows for special conditional logic that should only
 * happen during snapshot creation.
 */
export const isSnapshot = process.env.IS_SNAPSHOT === "true"
