import * as constructs from "constructs"
import * as acm from "aws-cdk-lib/aws-certificatemanager"
import * as cdk from "aws-cdk-lib"
import { webapp } from "../src"

export class WebappStack extends cdk.Stack {
  constructor(scope: constructs.Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props)

    const cloudfrontCertificate = acm.Certificate.fromCertificateArn(
      this,
      "Certificate",
      `arn:aws:acm:us-east-1:${this.account}:certificate/123456789012-1234-1234-1234-12345678`,
    )

    new webapp.Webapp(this, "Webapp", {
      domainNames: ["example.com"],
      cloudfrontCertificate,
    })
  }
}
