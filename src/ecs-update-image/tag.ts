import * as constructs from "constructs"
import * as iam from "aws-cdk-lib/aws-iam"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import { EcsUpdateImageArtifactStatus } from "./artifact-status"

interface Props {
  artifactStatus: EcsUpdateImageArtifactStatus
  secretName: string
}

/**
 * Container used for holding the current ECR tag for a ECS service.
 *
 * Since we are deploying our ECS services from both CloudFormation
 * (by having the TaskDefinition defined), as well as directly from
 * our CD pipeline by UpdateService call to ECS, we need to ensure
 * the referenced ECR image is kept in sync.
 *
 * To do this we use a container to hold the current ECR tag. This
 * is then looked up during deployment from CloudFormation, and
 * when deploying from CD pipeline it is updated before UpdateService
 * call.
 *
 * A secret is used as it can be dynamically resolved as part of the
 * CloudFormation template.
 *
 * We do not keep any default value for the container, as that might
 * lead us to later deploy a very old version of the build. It is
 * better if the deployment fails in this scenario. If this happens
 * the stack update will fail with:
 *
 *   Could not find a value associated with JSONKey in SecretString
 */
export class EcsUpdateImageTag extends constructs.Construct {
  private readonly secret: secretsmanager.Secret
  private readonly artifactStatus: EcsUpdateImageArtifactStatus
  readonly secretArn: string

  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)

    this.artifactStatus = props.artifactStatus

    this.secret = new secretsmanager.Secret(this, "Secret", {
      secretName: props.secretName,
      generateSecretString: {
        // Do not modify this, as it would cause the secret to regenerate.
        secretStringTemplate: "{}",
        generateStringKey: "unusedField",
      },
    })

    this.secretArn = this.secret.secretArn
  }

  public grantUpdate(grantee: iam.IGrantable): iam.Grant {
    return iam.Grant.addToPrincipal({
      grantee,
      actions: ["secretsmanager:UpdateSecret"],
      resourceArns: [this.secretArn],
    })
  }

  /**
   * A CloudFormation dynamic reference that will be resolved
   * during deployment.
   *
   * If we have not yet flagged the artifact as deployed,
   * we do not allow resolving the value. See the documentation
   * of {@link EcsUpdateImageArtifactStatus}.
   */
  public getEcrTag(): string | null {
    if (!this.artifactStatus.artifactPushedAndTagUpdated) {
      return null
    }
    return this.secret.secretValueFromJson("tag").toString()
  }
}
