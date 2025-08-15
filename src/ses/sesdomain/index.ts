import { createRequire } from "node:module"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as cdk from "aws-cdk-lib"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs"
import * as r53 from "aws-cdk-lib/aws-route53"
import * as cr from "aws-cdk-lib/custom-resources"
import * as constructs from "constructs"

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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
  /**
   * Include or exclude verification TXT record.
   *
   * CNAME records for DKIM tokens will still be created.
   *
   * Route 53 will not allow multiple TXT records with the same name.
   * This option allows to "opt-out" of the records and leaving
   * the caller responsible of handling it.
   *
   * @default true
   */
  includeVerificationRecord?: boolean
  /**
   * Default configuration set for emails sent from this domain.
   */
  defaultConfigurationSetName?: string
  /**
   * Configuration for an SPF record.
   *
   * @default - an SPF record with a default value is created.
   */
  spfRecord?: {
    /**
     * Whether to create the record or not.
     *
     * @default true
     */
    include?: boolean
    /**
     * The value of the SPF record.
     *
     * NOTE: The value will be enclosed in double quotes for you.
     *
     * @default "v=spf1 include:amazonses.com ~all"
     */
    value?: string
  }
}

export class SesDomain extends constructs.Construct {
  public route53RecordSets: cdk.IResolvable
  public verificationToken: string

  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)

    const resource = new cdk.CustomResource(this, "Resource", {
      serviceToken: SesDomainProvider.getOrCreate(this).serviceToken,
      properties: {
        DomainName: props.domainName,
        IncludeVerificationRecord: (
          props.includeVerificationRecord ?? true
        ).toString(),
        DefaultConfigurationSetName: props.defaultConfigurationSetName,
        // Bump this if changing logic in the lambda that should be
        // re-evaluated.
        Serial: 1,
      },
    })

    const staticRecordSets: r53.CfnRecordSetGroup.RecordSetProperty[] =
      (props.spfRecord?.include ?? true)
        ? [
            {
              name: props.domainName,
              type: r53.RecordType.TXT,
              ttl: "60",
              resourceRecords: [
                JSON.stringify(
                  props.spfRecord?.value || "v=spf1 include:amazonses.com ~all",
                ),
              ],
            },
          ]
        : []

    this.route53RecordSets = resource.getAtt("Route53RecordSets")
    this.verificationToken = resource.getAttString("VerificationToken")

    if (props.hostedZone) {
      new r53.CfnRecordSetGroup(this, "RecordSetGroup", {
        hostedZoneId: props.hostedZone.hostedZoneId,
        recordSets: this.route53RecordSets,
      })
      if (staticRecordSets.length) {
        new r53.CfnRecordSetGroup(this, "StaticRecordSetGroup", {
          hostedZoneId: props.hostedZone.hostedZoneId,
          recordSets: staticRecordSets,
        })
      }
    }
  }
}

class SesDomainProvider extends constructs.Construct {
  /**
   * Returns the singleton provider.
   */
  public static getOrCreate(scope: constructs.Construct) {
    const stack = cdk.Stack.of(scope)
    const id = "liflig-cdk.ses-domain.provider"
    return (
      (stack.node.tryFindChild(id) as SesDomainProvider) ||
      new SesDomainProvider(stack, id)
    )
  }

  private readonly provider: cr.Provider
  public readonly serviceToken: string

  constructor(scope: constructs.Construct, id: string) {
    super(scope, id)

    this.provider = new cr.Provider(this, "Provider", {
      onEventHandler: new NodejsFunction(this, "Function", {
        entry: require.resolve(`${__dirname}/handler`),
        runtime: lambda.Runtime.NODEJS_22_X,
        timeout: cdk.Duration.minutes(5),
        awsSdkConnectionReuse: false,
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
              "ses:PutEmailIdentityConfigurationSetAttributes",
            ],
            resources: ["*"],
          }),
        ],
      }),
    })

    this.serviceToken = this.provider.serviceToken
  }
}
