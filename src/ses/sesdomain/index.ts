import * as iam from "@aws-cdk/aws-iam"
import * as lambda from "@aws-cdk/aws-lambda"
import * as r53 from "@aws-cdk/aws-route53"
import * as cdk from "@aws-cdk/core"
import * as cr from "@aws-cdk/custom-resources"
import { sesDomainHandler } from "./handler"

interface Props {
  /**
   * The domain name to register in SES.
   */
  domainName: string
  /**
   * Hosted Zone to attach DNS records. If not given it must
   * be performed manually.
   */
  hostedZone?: r53.IHostedZone
}

export class SesDomain extends cdk.Construct {
  public route53RecordSets: cdk.IResolvable

  constructor(scope: cdk.Construct, id: string, props: Props) {
    super(scope, id)

    const resource = new cdk.CustomResource(this, "Resource", {
      serviceToken: SesDomainProvider.getOrCreate(this).serviceToken,
      properties: {
        DomainName: props.domainName,
        // Bump this if changing logic in the lambda that should be
        // re-evaluated.
        Serial: 1,
      },
    })

    this.route53RecordSets = resource.getAtt("Route53RecordSets")

    if (props.hostedZone) {
      new r53.CfnRecordSetGroup(this, "RecordSetGroup", {
        hostedZoneId: props.hostedZone.hostedZoneId,
        recordSets: this.route53RecordSets,
      })
    }
  }
}

class SesDomainProvider extends cdk.Construct {
  /**
   * Returns the singleton provider.
   */
  public static getOrCreate(scope: cdk.Construct) {
    const stack = cdk.Stack.of(scope)
    const id = "liflig-cdk.ses-domain.provider"
    return (
      (stack.node.tryFindChild(id) as SesDomainProvider) ||
      new SesDomainProvider(stack, id)
    )
  }

  private readonly provider: cr.Provider
  public readonly serviceToken: string

  constructor(scope: cdk.Construct, id: string) {
    super(scope, id)

    this.provider = new cr.Provider(this, "Provider", {
      onEventHandler: new lambda.Function(this, "Function", {
        code: new lambda.InlineCode(
          `exports.handler = ${sesDomainHandler.toString()};`,
        ),
        handler: "index.handler",
        runtime: lambda.Runtime.NODEJS_12_X,
        timeout: cdk.Duration.minutes(5),
        initialPolicy: [
          new iam.PolicyStatement({
            actions: [
              "ses:DeleteIdentity",
              "ses:GetIdentityDkimAttributes",
              "ses:GetIdentityMailFromDomainAttributes",
              "ses:GetIdentityVerificationAttributes",
              "ses:SetIdentityDkimEnabled",
              "ses:SetIdentityMailFromDomain",
              "ses:VerifyDomainDkim",
              "ses:VerifyDomainIdentity",
            ],
            resources: ["*"],
          }),
        ],
      }),
    })

    this.serviceToken = this.provider.serviceToken
  }
}
