import * as constructs from "constructs"
import * as cdk from "aws-cdk-lib"
import * as cr from "aws-cdk-lib/custom-resources"

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
  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id, {
      onUpdate: {
        service: "SSM",
        action: "getParameter",
        parameters: {
          Name: props.parameterName,
        },
        region: props.region,
        // Update physical id to fetch the latest version.
        physicalResourceId: cr.PhysicalResourceId.of(props.parameterName),
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

    const r = this.node.findChild("Resource").node
      .defaultChild as cdk.CfnResource
    r.cfnOptions.metadata = r.cfnOptions.metadata || {}
    r.cfnOptions.metadata.Nonce = props.nonce ?? Date.now().toString()
  }

  public getParameterValue(): string {
    return this.getResponseField("Parameter.Value")
  }
}
