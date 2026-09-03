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
    /**
     * The numeric ID of the GitHub repository, as used by the immutable
     * subject claim format.
     *
     * When omitted, any repository ID is trusted for this repository name.
     * Supply it to pin the trust policy to this exact repository, so that a
     * future repository reusing the name is not trusted.
     *
     * @example 845069697
     */
    repositoryId?: number
    /**
     * The numeric ID of the owner of the GitHub repository, as used by the
     * immutable subject claim format.
     *
     * When omitted, any owner ID is trusted for this owner name. Supply it to
     * pin the trust policy to this exact owner.
     *
     * @example 13219542
     */
    ownerId?: number
  }[]
  /**
   * An existing OpenID Connect Provider for GitHub Actions.
   */
  oidcProvider: iam.IOpenIdConnectProvider
}

/**
 * Utility function for validating the construct properties.
 *
 * Returns a list of validation error messages. An empty list means the props are valid.
 */
export const validateProps = (props: Props): string[] => {
  const errors: string[] = []
  if (props.trustedOwners.length === 0) {
    errors.push("At least 1 trusted owner must be supplied, but 0 were given")
  }
  if (props.repositories.length === 0) {
    errors.push("At least 1 repository must be supplied, but 0 were given")
  }
  props.trustedOwners.forEach((owner) => {
    if (!owner.match(/^[a-zA-Z0-9-]+$/)) {
      errors.push(`Trusted owner ${owner} contains invalid characters`)
    }
  })

  props.repositories.forEach((repository) => {
    if (!props.trustedOwners.includes(repository.owner)) {
      errors.push(
        `Owner ${repository.owner} of repository ${repository.name} not configured as a trusted owner`,
      )
    }
    Object.entries({
      ownerId: repository.ownerId,
      repositoryId: repository.repositoryId,
    }).forEach(([prop, id]) => {
      if (id !== undefined && !(Number.isInteger(id) && id > 0)) {
        errors.push(
          `${prop} ${id} of repository ${repository.name} must be a positive integer`,
        )
      }
    })
  })
  return errors
}

/**
 * The repository segment of a GitHub Actions OIDC subject claim.
 */
const repositoryClaim = (repository: Props["repositories"][number]) =>
  `${repository.owner}@${repository.ownerId ?? "*"}/${repository.name}@${repository.repositoryId ?? "*"}`

/**
 * Creates an IAM role that can be assumed by GitHub Actions workflows
 * in specific GitHub repositories and branches using OpenID Connect.
 */
export class GithubActionsRole extends constructs.Construct {
  public readonly role: iam.Role

  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)
    const errors = validateProps(props)
    if (errors.length > 0) {
      throw new Error(`Invalid props were supplied: ${errors.join("; ")}`)
    }

    const branch = props.trustedBranch ?? "master"
    const subjects = props.repositories.map(
      (repository) =>
        `repo:${repositoryClaim(repository)}:ref:refs/heads/${branch}`,
    )
    if (subjects.length === 0) {
      throw new Error(
        "The principal's trust policy needs to be configured with at least one IAM condition",
      )
    }

    // IAM combines multiple condition operators with a logical AND, so all
    // subjects must share one operator to be alternatives rather than
    // requirements.
    const containsWildcard = (subject: string) =>
      subject.includes("?") || subject.includes("*")
    const principalConditions = subjects.some(containsWildcard)
      ? { StringLike: { "token.actions.githubusercontent.com:sub": subjects } }
      : {
          StringEquals: { "token.actions.githubusercontent.com:sub": subjects },
        }

    const principal = new iam.FederatedPrincipal(
      props.oidcProvider.openIdConnectProviderArn,
      principalConditions,
      "sts:AssumeRoleWithWebIdentity",
    )
    this.role = new iam.Role(this, "Role", {
      roleName: props.roleName ?? "github-actions-role",
      assumedBy: principal,
    })
  }
}
