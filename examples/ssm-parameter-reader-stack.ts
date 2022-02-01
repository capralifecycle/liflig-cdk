import * as constructs from "constructs"
import * as cdk from "aws-cdk-lib"
import { SsmParameterReader } from "../src"

export class SsmParameterReaderStack extends cdk.Stack {
  constructor(scope: constructs.Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props)

    new SsmParameterReader(this, "ParamReader", {
      parameterName: "/some/parameter",
      region: "eu-west-1",
      nonce: "123",
    })
  }
}
