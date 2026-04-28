import * as cr from "aws-cdk-lib/custom-resources"
import * as constructs from "constructs"

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
      // Use SDK bundled with the Lambda runtime instead of installing the
      // latest at execution time. Avoids ~60s npm install on every invocation
      // and removes a runtime dependency on npmjs.com availability.
      // https://constructs.dev/packages/aws-cdk-lib/v/2.251.0?submodule=custom_resources&lang=typescript
      installLatestAwsSdk: false,
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
