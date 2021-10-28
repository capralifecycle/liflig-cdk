import * as iam from "@aws-cdk/aws-iam"
import * as lambda from "@aws-cdk/aws-lambda"

import * as cdk from "@aws-cdk/core"
import * as cr from "@aws-cdk/custom-resources"
import { configurationSetDeliveryOptionsHandler } from "./handler"

export type TlsPolicy = "REQUIRE" | "OPTIONAL"

export interface ConfigurationSetDeliveryOptionsProps {
  /**
   * The SES configuration set name
   */
  configurationSetName: string
  /**
   * Sending pool name
   *
   * The name of the dedicated IP pool to associate with the configuration set.
   */
  sendingPoolName?: string
  /**
   * TLS Policy for the configuration set
   *
   * If set to REQUIRE, then AWS SES will only deliver mail if the connection
   * to the receiving mail server can be secured using TLS.
   */
  tlsPolicy?: TlsPolicy
}

export class ConfigurationSetDeliveryOptions extends cdk.Construct {
  constructor(
    scope: cdk.Construct,
    id: string,
    props: ConfigurationSetDeliveryOptionsProps,
  ) {
    super(scope, id)

    new cdk.CustomResource(this, "Resource", {
      serviceToken:
        ConfigurationSetDeliveryOptionsProvider.getOrCreate(this).serviceToken,
      properties: {
        ConfigurationSetName: props.configurationSetName,
        TlsPolicy: props.tlsPolicy,
        SendingPoolName: props.sendingPoolName,
        Serial: 1,
      },
    })
  }
}

class ConfigurationSetDeliveryOptionsProvider extends cdk.Construct {
  /**
   * Returns the singleton provider.
   */
  public static getOrCreate(scope: cdk.Construct) {
    const stack = cdk.Stack.of(scope)
    const id = "liflig-cdk.configuration-set-sns-delivery-options"
    return (
      (stack.node.tryFindChild(
        id,
      ) as ConfigurationSetDeliveryOptionsProvider) ||
      new ConfigurationSetDeliveryOptionsProvider(stack, id)
    )
  }

  private readonly provider: cr.Provider
  public readonly serviceToken: string

  constructor(scope: cdk.Construct, id: string) {
    super(scope, id)

    this.provider = new cr.Provider(this, "Provider", {
      onEventHandler: new lambda.Function(this, "Function", {
        code: new lambda.InlineCode(
          `exports.handler = ${configurationSetDeliveryOptionsHandler.toString()};`,
        ),
        handler: "index.handler",
        runtime: lambda.Runtime.NODEJS_12_X,
        timeout: cdk.Duration.minutes(5),
        initialPolicy: [
          new iam.PolicyStatement({
            actions: ["ses:PutConfigurationSetDeliveryOptions"],
            resources: ["*"],
          }),
        ],
      }),
    })

    this.serviceToken = this.provider.serviceToken
  }
}
