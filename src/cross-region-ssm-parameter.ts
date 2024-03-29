import * as constructs from "constructs"
import * as cr from "aws-cdk-lib/custom-resources"

interface Props {
  region: string
  name: string
  value: string
}

/**
 * SSM Parameter stored in another region.
 */
export class CrossRegionSsmParameter extends constructs.Construct {
  constructor(scope: constructs.Construct, id: string, props: Props) {
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
        // We grant the Custom Resource access to write to any
        // parameter, as this is needed to be able to rename
        // a parameter later.
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    })
  }
}
