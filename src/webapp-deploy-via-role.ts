import {
  WebappDeploy,
  type WebappDeployProps,
} from "@capraconsulting/webapp-deploy-lambda"
import * as cdk from "aws-cdk-lib"
import * as iam from "aws-cdk-lib/aws-iam"
import * as constructs from "constructs"

interface Props {
  /**
   * Reference to the IAM Role that will be granted permission to
   * assume the CI role. This role must have permission to assume
   * the CI role.
   */
  externalRoleArn: string
  /**
   * The name of the role that will be created.
   */
  roleName: string
  webappDeploy: WebappDeployProps
}

/**
 * Provide the construct described at
 * https://github.com/capraconsulting/webapp-deploy-lambda
 * in combination with a separate role to be used to
 * trigger the process.
 */
export class WebappDeployViaRole extends constructs.Construct {
  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)

    const roleToBeAssumedForDeploy = new iam.Role(this, "Role", {
      assumedBy: new iam.ArnPrincipal(props.externalRoleArn),
      roleName: props.roleName,
    })

    const webappDeploy = new WebappDeploy(this, "Resource", props.webappDeploy)

    webappDeploy.deployFn.grantInvoke(roleToBeAssumedForDeploy)

    new cdk.CfnOutput(this, "FunctionArnOutput", {
      value: webappDeploy.deployFn.functionArn,
    })
    new cdk.CfnOutput(this, "RoleArnOutput", {
      value: roleToBeAssumedForDeploy.roleArn,
    })
  }
}
