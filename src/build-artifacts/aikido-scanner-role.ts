import * as cdk from "aws-cdk-lib"
import * as iam from "aws-cdk-lib/aws-iam"
import * as constructs from "constructs"
import { serviceRepositoriesArn } from "./service-repositories"

export interface Props {
  /**
   * The external ID that Aikido shows when connecting an ECR registry.
   */
  externalId: string
  /**
   * The Aikido role that assumes the scanner role.
   *
   * @default - Aikido's container image scanner role for its EU region
   */
  principalArn?: string
}

/**
 * Aikido's container image scanner role for its EU region, as published in
 * Aikido's ECR setup template.
 */
export const DEFAULT_PRINCIPAL_ARN =
  "arn:aws:iam::881830977366:role/service-role/lambda-container-image-scanner-role-pb0qotst"

export const ROLE_NAME = "AikidoSecurityEcrScanningRole"

// The pattern IAM accepts for sts:ExternalId.
const EXTERNAL_ID_PATTERN = /^[\w+=,.@:/-]{2,1224}$/

/**
 * Returns a list of validation error messages. An empty list means the props are valid.
 */
export const validateProps = (props: Props): string[] =>
  cdk.Token.isUnresolved(props.externalId) ||
  EXTERNAL_ID_PATTERN.test(props.externalId)
    ? []
    : [
        "Aikido external ID must be 2 to 1224 characters of letters, digits and +=,.@:/-_",
      ]

/**
 * Creates the IAM role that Aikido assumes to scan the service repositories
 * in this account.
 *
 * The role reads images only from service repositories. It may list every
 * repository, which Aikido needs to discover them.
 */
export class AikidoScannerRole extends constructs.Construct {
  public readonly role: iam.Role

  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)
    const errors = validateProps(props)
    if (errors.length > 0) {
      throw new Error(`Invalid props were supplied: ${errors.join("; ")}`)
    }

    this.role = new iam.Role(this, "Role", {
      roleName: ROLE_NAME,
      assumedBy: new iam.ArnPrincipal(
        props.principalArn ?? DEFAULT_PRINCIPAL_ARN,
      ),
      externalIds: [props.externalId],
    })
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:DescribeImages",
          "ecr:GetDownloadUrlForLayer",
          "ecr:ListImages",
          "ecr:ListTagsForResource",
        ],
        resources: [serviceRepositoriesArn(this)],
      }),
    )
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "ecr:DescribeRegistry",
          "ecr:DescribeRepositories",
          "ecr:GetAuthorizationToken",
        ],
        resources: ["*"],
      }),
    )
  }
}
