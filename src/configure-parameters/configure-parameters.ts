import * as iam from "@aws-cdk/aws-iam"
import * as secretsmanager from "@aws-cdk/aws-secretsmanager"
import * as ssm from "@aws-cdk/aws-ssm"
import * as cdk from "@aws-cdk/core"
import * as crypto from "crypto"

/**
 * A plain text application parameter that will be stored
 * in AWS Parameter Store. Only used for non-sensitive values,
 * typically those commited directly in the IaC code.
 */
export interface PlainTextParameter {
  key: string
  value: string
}

/**
 * An AWS Secret that should hold a JSON object.
 *
 * This will provide a secret that liflig-properties can read. The final
 * parameter seen by the application will be the key given here and the
 * keys from the secret JSON object appended.
 */
export interface SecretParameter {
  key: string
  secret: secretsmanager.ISecret
}

/**
 * An AWS Secret that should hold a JSON object.
 *
 * This will provide a secret that liflig-properties can read. The final
 * parameter seen by the application will be the key given here and the
 * keys from the secret JSON object appended.
 */
export interface SecretByNameParameter {
  key: string
  secretName: string
}

export type Parameter =
  | PlainTextParameter
  | SecretParameter
  | SecretByNameParameter

interface Props {
  /**
   * Prefix used for parameter names.
   * Should start with '/' and end without '/'.
   */
  ssmPrefix: string
  parameters: Parameter[]
}

export class ConfigureParameters {
  public parameters: ssm.IParameter[]
  public ssmPrefix: string
  private secrets: secretsmanager.ISecret[]

  private configParameters: PlainTextParameter[]
  private secretParameters: SecretParameter[]

  constructor(scope: cdk.Construct, props: Props) {
    if (!props.ssmPrefix.startsWith("/") || props.ssmPrefix.endsWith("/")) {
      throw new Error("ssmPrefix should start with '/' and end without '/'")
    }

    this.ssmPrefix = props.ssmPrefix

    this.configParameters = []
    this.secretParameters = []

    for (const parameter of props.parameters) {
      if ("value" in parameter) {
        this.configParameters.push(parameter)
      } else if ("secret" in parameter) {
        this.secretParameters.push(parameter)
      } else if ("secretName" in parameter) {
        this.secretParameters.push({
          key: parameter.key,
          secret: secretsmanager.Secret.fromSecretNameV2(
            scope,
            `SecretRef${parameter.key}`,
            parameter.secretName,
          ),
        })
      }
    }

    const result: ssm.IParameter[] = []

    this.configParameters.forEach((it) => {
      const param = new ssm.StringParameter(scope, `Config${it.key}`, {
        type: ssm.ParameterType.STRING,
        stringValue: it.value,
        parameterName: `${this.ssmPrefix}/config/${it.key}`,
      })
      result.push(param)
    })

    this.secretParameters.forEach((it) => {
      const param = new ssm.StringParameter(scope, `Secret${it.key}`, {
        type: ssm.ParameterType.STRING,
        stringValue: it.secret.secretArn,
        parameterName: `${this.ssmPrefix}/secrets/${it.key}`,
      })
      result.push(param)
    })

    this.secrets = this.secretParameters.map((it) => it.secret)

    this.parameters = result
  }

  grantRead(grantable: iam.IGrantable): void {
    grantable.grantPrincipal.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ssm:GetParametersByPath"],
        resources: [
          `arn:aws:ssm:${cdk.Stack.of(grantable).region}:${
            cdk.Stack.of(grantable).account
          }:parameter${this.ssmPrefix}/*`,
        ],
      }),
    )

    for (const secret of this.secrets) {
      secret.grantRead(grantable)
    }
  }

  /**
   * Produce a checksum-value that can be used as a kind of
   * nonce to trigger redeployment on parameter changes.
   *
   * Note: If the parameter references a token no change will be visible,
   * and a manual redeployment might be needed.
   */
  get hashValue(): string {
    const hash = crypto.createHash("sha256")

    if (this.configParameters) {
      this.configParameters.forEach((it) => {
        hash.update("|")
        hash.update(it.key)
        hash.update("|")

        if (!cdk.Token.isUnresolved(it.value)) {
          hash.update(it.value)
        }
      })
    }

    if (this.secretParameters) {
      this.secretParameters.forEach((it) => {
        hash.update("|")
        hash.update(it.key)
        hash.update("|")

        if (!cdk.Token.isUnresolved(it.secret.secretArn)) {
          hash.update(it.secret.secretArn)
        }
      })
    }

    return hash.digest("hex")
  }
}
