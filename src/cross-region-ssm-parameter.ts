import * as cdk from "@aws-cdk/core"
import * as cr from "@aws-cdk/custom-resources"

interface Props {
  region: string
  name: string
  value: string
}

function removeLeadingSlash(value: string): string {
  return value.slice(0, 1) == "/" ? value.slice(1) : value
}

/**
 * SSM Parameter stored in another region.
 */
export class CrossRegionSsmParameter extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string, props: Props) {
    super(scope, id)

    const physicalResourceId = cr.PhysicalResourceId.of(props.name)

    // TODO: Can we somehow propagate tags as well?
    new cr.AwsCustomResource(this, "Resoure", {
      onUpdate: {
        service: "SSM",
        action: "putParameter",
        parameters: {
          Name: props.name,
          Value: props.value,
          Type: "String",
          Overwrite: true,
        },
        region: props.region,
        physicalResourceId,
      },
      onDelete: {
        service: "SSM",
        action: "deleteParameter",
        parameters: {
          Name: props.name,
        },
        region: props.region,
        physicalResourceId,
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [
          cdk.Arn.format(
            {
              service: "ssm",
              resource: "parameter",
              region: props.region,
              resourceName: removeLeadingSlash(props.name),
            },
            cdk.Stack.of(this),
          ),
        ],
      }),
    })
  }
}
