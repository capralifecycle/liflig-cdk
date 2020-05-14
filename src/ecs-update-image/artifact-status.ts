interface Props {
  artifactPushedAndTagUpdated: boolean
}

/**
 * The responsibility of this class is to be a Value Object to cause
 * more consistent usage and the importance of an artifact being published.
 *
 * Due to the way we build and deploy ECS services, the ECR image will
 * not be available during the first initial account/service deployment.
 *
 * This causes the following sequence:
 *
 * 1. The ECR repository must be provisioned.
 *
 * 2. The tag container must be provisioned in every target account.
 *    Before we can provision the ECS service this must be updated
 *    to reference an existing artifact.
 *
 * 3. The build system must produce and upload an artifact.
 *
 * 4. The tag container must be updated in every target account
 *    to contain the newly built image. This is easiest done by also
 *    provisioning the ECS update image construct as part of step 2,
 *    without including service and task definition details (which
 *    does not exist yet before we can resolve the ECR image).
 *    When the ECS update image construct is provisioned the deployment
 *    pipeline can start a deployment, which under this state will
 *    only store the updated tag but cause no ECS service update.
 *
 * 5. The ECS service can be provisioned, which will use the image
 *    reference in the tag container as the first deployment.
 *
 * 6. The next time a deploy is started, the ECS service will be updated.
 */
export class EcsUpdateImageArtifactStatus {
  readonly artifactPushedAndTagUpdated: boolean

  constructor(props: Props) {
    this.artifactPushedAndTagUpdated = props.artifactPushedAndTagUpdated
  }
}
