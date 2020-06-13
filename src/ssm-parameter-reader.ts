import * as cdk from "@aws-cdk/core"
import * as cr from "@aws-cdk/custom-resources"

interface Props {
  parameterName: string
  region: string
  /**
   * Value that must be updated to check if the parameter has a new value.
   *
   * @default Date.now().toString()
   */
  nonce?: string
}

function removeLeadingSlash(value: string): string {
  return value.slice(0, 1) == "/" ? value.slice(1) : value
}

/**
 * Get value of a SSM parameter dynamically during deployment
 * with support to read cross-region.
 */
export class SsmParameterReader extends cr.AwsCustomResource {
  constructor(scope: cdk.Construct, id: string, props: Props) {
    super(scope, id, {
      onUpdate: {
        service: "SSM",
        action: "getParameter",
        parameters: {
          Name: props.parameterName,
        },
        region: props.region,
        // Update physical id to fetch the latest version.
        physicalResourceId: cr.PhysicalResourceId.of(
          props.nonce ?? Date.now().toString(),
        ),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [
          cdk.Arn.format(
            {
              service: "ssm",
              region: props.region,
              resource: "parameter",
              resourceName: removeLeadingSlash(props.parameterName),
            },
            cdk.Stack.of(scope),
          ),
        ],
      }),
    })
  }

  public getParameterValue(): string {
    return this.getResponseField("Parameter.Value")
  }
}
