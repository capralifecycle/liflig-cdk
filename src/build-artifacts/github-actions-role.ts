import * as iam from "aws-cdk-lib/aws-iam"
import * as constructs from "constructs"

export interface Props {
  /**
   * A list of trusted GitHub repository owners.
   *
   * This functions as a sort of whitelist to catch
   * potential typos in {@link repositories}.
   */
  trustedOwners: string[]
  /**
   * The name of the trusted branch.
   *
   * The wildcard characters '*' and '?' can be used to
   * represent any combination of characters and any single
   * character, respectively.
   *
   * @default "master"
   */
  trustedBranch?: string
  /**
   * The name of the role to create.
   *
   * @default "github-actions-role"
   */
  roleName?: string
  /**
   * The GitHub repositories that the principal trusts.
   */
  repositories: {
    /**
     * The name of the GitHub repository.
     *
     * The wildcard characters '*' and '?' can be used to
     * represent any combination of characters and any single
     * character, respectively.
     *
     * NOTE: Be careful when using wildcard characters as you
     * may grant access to repositories you did not intend.
     *
     * @example "my-repository"
     * @example "my-team-*"
     */
    name: string
    /**
     * The name of the owner of the GitHub repository.
     *
     * NOTE: The owner must explicitly be whitelisted in {@link trustedOwners}.
     */
    owner: string
  }[]
  /**
   * An existing OpenID Connect Provider for GitHub Actions.
   */
  oidcProvider: iam.IOpenIdConnectProvider
}

/**
 * Utility function for validating the construct properties.
 */
export const validateProps = (props: Props) => {
  let valid = true
  if (props.trustedOwners.length === 0) {
    console.error("At least 1 trusted owner must be supplied, but 0 were given")
    valid = false
  }
  if (props.repositories.length === 0) {
    console.error("At least 1 repository must be supplied, but 0 were given")
    valid = false
  }
  props.trustedOwners.forEach((owner) => {
    if (!owner.match(/^[a-zA-Z0-9-]+$/)) {
      console.error(`Trusted owner ${owner} contains invalid characters`)
      valid = false
    }
  })

  props.repositories.forEach((repository) => {
    if (!props.trustedOwners.includes(repository.owner)) {
      console.error(
        `Owner ${repository.owner} of repository ${repository.name} not configured as a trusted owner`,
      )
      valid = false
    }
  })
  return valid
}

/**
 * Creates an IAM role that can be assumed by GitHub Actions workflows
 * in specific GitHub repositories and branches using OpenID Connect.
 */
export class GithubActionsRole extends constructs.Construct {
  public readonly role: iam.Role

  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)
    if (!validateProps(props)) {
      throw new Error("Invalid props were supplied")
    }

    const subjects = props.repositories.map(
      (repository) =>
        `repo:${repository.owner}/${repository.name}:ref:refs/heads/${props.trustedBranch ?? "master"}`,
    )
    const fullyQualifiedSubjects = subjects.filter(
      (subject) => !(subject.includes("?") || subject.includes("*")),
    )

    const wildcardSubjects = subjects.filter(
      (subject) => subject.includes("?") || subject.includes("*"),
    )
    const principalConditions = {
      ...(fullyQualifiedSubjects.length && {
        StringEquals: {
          "token.actions.githubusercontent.com:sub": fullyQualifiedSubjects,
        },
      }),
      ...(wildcardSubjects.length && {
        StringLike: {
          "token.actions.githubusercontent.com:sub": wildcardSubjects,
        },
      }),
    }

    const principal = new iam.FederatedPrincipal(
      props.oidcProvider.openIdConnectProviderArn,
      principalConditions,
      "sts:AssumeRoleWithWebIdentity",
    )

    // Verify that the principal is configured with a trust relationship
    // that contains at least one IAM condition with a context key and values
    if (
      !Object.values(principalConditions).some((conditionElement) =>
        Object.entries(conditionElement).some(
          ([conditionKey, conditionValue]) =>
            conditionKey && conditionValue.length,
        ),
      )
    ) {
      throw new Error(
        "The principal's trust policy needs to be configured with at least one IAM condition",
      )
    }
    this.role = new iam.Role(this, "Role", {
      roleName: props.roleName ?? "github-actions-role",
      assumedBy: principal,
    })
  }
}
