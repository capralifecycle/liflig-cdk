import * as ssm from "@aws-cdk/aws-ssm"
import * as cdk from "@aws-cdk/core"
import { SsmParameterReader } from "./ssm-parameter-reader"

type ReferenceToResource<T> = (
  scope: cdk.Construct,
  id: string,
  reference: string,
) => T

interface Props<T> {
  /**
   * The nonce must be updated in case the parameter changes,
   * forcing us to recheck the parameter.
   *
   * @default 1
   */
  nonce?: string
  parameterName: string
  resource: T
  resourceToReference(resource: T): string
  referenceToResource: ReferenceToResource<T>
}

/**
 * Register a SSM Parameter and provide helpers so that a resource can be
 * backed by a SSM Parameter for cross-region reference.
 *
 * If the resource is in the same region, the resource will be returned
 * like normally in CDK, causing an export/import if cross-stack.
 */
export class SsmParameterBackedResource<T> extends cdk.Construct {
  private readonly nonce: string
  readonly parameterName: string
  private readonly resource: T
  private readonly referenceToResource: ReferenceToResource<T>

  constructor(scope: cdk.Construct, id: string, props: Props<T>) {
    super(scope, id)
    this.nonce = props.nonce ?? "1"
    this.parameterName = props.parameterName
    this.resource = props.resource
    // eslint-disable-next-line @typescript-eslint/unbound-method
    this.referenceToResource = props.referenceToResource

    new ssm.CfnParameter(this, "Resource", {
      type: ssm.ParameterType.STRING,
      name: this.parameterName,
      value: props.resourceToReference(this.resource),
    })
  }

  /**
   * Get the resource by resolving the value from SSM Parameter Store
   * in case we are cross-region.
   */
  public get(scope: cdk.Construct, id: string): T {
    const producerRegion = cdk.Stack.of(this).region
    const consumerRegion = cdk.Stack.of(scope).region

    // Fast-path: Same region.
    if (producerRegion === consumerRegion) {
      return this.resource
    }

    scope.node.addDependency(this)

    const reference = new SsmParameterReader(scope, `${id}Parameter`, {
      parameterName: this.parameterName,
      region: cdk.Stack.of(this).region,
      nonce: this.nonce,
    }).getParameterValue()

    return this.referenceToResource(scope, id, reference)
  }
}
