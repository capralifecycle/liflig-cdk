import * as ssm from "@aws-cdk/aws-ssm"
import * as cdk from "@aws-cdk/core"

function paramName(
  namespace: string,
  platformName: string,
  resourceName: string,
): string {
  return `/liflig-cdk/platform/${namespace}/${platformName}/${resourceName}`
}

export interface PlatformProducerProps {
  platformName: string
  paramNamespace: string
}

/**
 * Abstract class to be extended.
 *
 * Produces the resources that will be consumed in PlatformConsumer.
 * In other words; this must run before PlatformConsumer.
 *
 * Used for producing references to the core resources.
 */
export class PlatformProducer extends cdk.Construct {
  private platformName: string
  private paramNamespace: string

  constructor(scope: cdk.Construct, id: string, props: PlatformProducerProps) {
    super(scope, id)

    // For later extension.
    this.platformName = props.platformName

    this.paramNamespace = props.paramNamespace
  }

  protected putParam(name: string, value: string): ssm.StringParameter {
    return new ssm.StringParameter(this, name, {
      stringValue: value,
      parameterName: paramName(this.paramNamespace, this.platformName, name),
    })
  }
}

export interface PlatformConsumerProps {
  platformName: string
  paramNamespace: string
}
/**
 * Abstract class to be extended.
 *
 * Consumes the resources that have been produced by PlatformProducer.
 * In other words; this must run after PlatformProducer.
 *
 * Used for consuming the core resources, which PlatformProducer creates references to.
 */
export class PlatformConsumer extends cdk.Construct {
  private platformName: string
  private paramNamespace: string

  constructor(scope: cdk.Construct, id: string, props: PlatformConsumerProps) {
    super(scope, id)

    // For later extension.
    this.platformName = props.platformName

    this.paramNamespace = props.paramNamespace
  }

  protected lazy<T>(producer: () => T): () => T {
    let value: T | null = null

    return () => {
      if (value == null) {
        value = producer()
      }
      return value
    }
  }

  protected getParam(name: string): string {
    return ssm.StringParameter.valueForStringParameter(
      this,
      paramName(this.paramNamespace, this.platformName, name),
    )
  }
}
