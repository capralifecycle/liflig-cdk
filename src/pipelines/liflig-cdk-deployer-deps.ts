import * as constructs from "constructs"
import * as iam from "aws-cdk-lib/aws-iam"
import * as cdk from "aws-cdk-lib"
import { cdkDeployRoleName } from "./conventions"

export interface LifligCdkDeployerDepsProps {
  trustedAccountIds: string[]
}

/**
 * Resources needed so liflig-cdk-deployer can deploy to the account.
 *
 * This must exist in each target account that the pipeline should
 * be able to deploy into.
 */
export class LifligCdkDeployerDeps extends constructs.Construct {
  constructor(
    scope: constructs.Construct,
    id: string,
    props: LifligCdkDeployerDepsProps,
  ) {
    super(scope, id)

    const account = cdk.Stack.of(this).account

    // The role used when running "cdk deploy".
    const cdkRole = new iam.Role(this, "CdkRole", {
      roleName: cdkDeployRoleName,
      assumedBy: new iam.CompositePrincipal(
        ...props.trustedAccountIds.map((it) => new iam.AccountPrincipal(it)),
      ),
    })

    // Roles used by CDK CLI for the actual deployment.
    // (For use under new-style synthesize.)
    cdkRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["sts:AssumeRole"],
        resources: [
          `arn:aws:iam::${account}:role/*-deploy-role-*`,
          `arn:aws:iam::${account}:role/*-publishing-role-*`,
        ],
      }),
    )
  }
}
