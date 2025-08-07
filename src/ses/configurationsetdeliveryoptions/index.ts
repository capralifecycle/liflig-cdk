import * as iam from "aws-cdk-lib/aws-iam"
import * as cr from "aws-cdk-lib/custom-resources"
import * as constructs from "constructs"

export type TlsPolicy = "Require" | "Optional"

export interface ConfigurationSetDeliveryOptionsProps {
  /**
   * The name of an existing SES configuration set to update delivery options on
   */
  configurationSetName: string
  /**
   * The TLS policy for outgoing emails
   *
   * Setting this to "Require" will make mail delivery fail if SES cannot
   * establish a TLS-encrypted connection to the receiving mail server.
   */
  tlsPolicy: TlsPolicy
}

/**
 * Set Delivery Options for a SES Configuration Set.
 *
 * Currently the only delivery option that can be set is the TLS Policy, which
 * can be set to either "Require" or "Optional". If set to "Require" SES
 * will refuse to deliver mail to mail servers it cannot connect to using
 * an encrypted connection.
 */
export class ConfigurationSetDeliveryOptions extends constructs.Construct {
  constructor(
    scope: constructs.Construct,
    id: string,
    props: ConfigurationSetDeliveryOptionsProps,
  ) {
    super(scope, id)

    new cr.AwsCustomResource(this, "Resource", {
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ["ses:PutConfigurationSetDeliveryOptions"],
          resources: ["*"],
        }),
      ]),
      // Handles both onCreate and onUpdate
      onUpdate: {
        service: "SES",
        action: "putConfigurationSetDeliveryOptions",
        parameters: {
          ConfigurationSetName: props.configurationSetName,
          DeliveryOptions: {
            TlsPolicy: props.tlsPolicy,
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(
          props.configurationSetName,
        ),
      },
      onDelete: {
        service: "SES",
        action: "putConfigurationSetDeliveryOptions",
        parameters: {
          ConfigurationSetName: props.configurationSetName,
        },
      },
    })
  }
}
