import * as ssm from "@aws-cdk/aws-ssm"
import * as cdk from "@aws-cdk/core"

function paramName(
  namespace: string,
  envName: string,
  platformName: string,
  resourceName: string,
): string {
  return `/${namespace}/${envName}/platform/${platformName}/${resourceName}`
}

interface ProducerProps {
  paramNamespace?: string
  envName: string
}

const defaultParamNamespace = "liflig-cdk"

export class PlatformProducer extends cdk.Construct {
  private paramNamespace: string
  private envName: string
  private platformName: string

  constructor(scope: cdk.Construct, id: string, props: ProducerProps) {
    super(scope, id)

    // For later extension.
    this.platformName = "default"

    this.paramNamespace = props.paramNamespace ?? defaultParamNamespace
    this.envName = props.envName
  }

  protected putParam(name: string, value: string): ssm.StringParameter {
    return new ssm.StringParameter(this, name, {
      stringValue: value,
      parameterName: paramName(
        this.paramNamespace,
        this.envName,
        this.platformName,
        name,
      ),
    })
  }
}

interface ConsumerProps {
  paramNamespace?: string
  envName: string
}

export class PlatformConsumer extends cdk.Construct {
  private platformName: string
  private paramNamespace: string
  private envName: string

  constructor(scope: cdk.Construct, id: string, props: ConsumerProps) {
    super(scope, id)

    // For later extension.
    this.platformName = "default"

    this.paramNamespace = props.paramNamespace ?? defaultParamNamespace
    this.envName = props.envName
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
      paramName(this.paramNamespace, this.envName, this.platformName, name),
    )
  }
}
