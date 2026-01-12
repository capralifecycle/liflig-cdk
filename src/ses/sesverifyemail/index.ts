import { createRequire } from "node:module"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as cdk from "aws-cdk-lib"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs"
import * as cr from "aws-cdk-lib/custom-resources"
import * as constructs from "constructs"

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface Props {
  /**
   * The email address to add as a verified email in SES.
   */
  emailAddress: string
}

export class SesVerifyEmail extends constructs.Construct {
  public route53RecordSets: cdk.IResolvable

  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)

    new cdk.CustomResource(this, "Resource", {
      serviceToken: SesVerifyEmailProvider.getOrCreate(this).serviceToken,
      properties: {
        EmailAddress: props.emailAddress,
      },
    })
  }
}

class SesVerifyEmailProvider extends constructs.Construct {
  /**
   * Returns the singleton provider.
   */
  public static getOrCreate(scope: constructs.Construct) {
    const stack = cdk.Stack.of(scope)
    const id = "liflig-cdk.ses-verify-email.provider"
    return (
      (stack.node.tryFindChild(id) as SesVerifyEmailProvider) ||
      new SesVerifyEmailProvider(stack, id)
    )
  }

  private readonly provider: cr.Provider
  public readonly serviceToken: string

  constructor(scope: constructs.Construct, id: string) {
    super(scope, id)

    this.provider = new cr.Provider(this, "Provider", {
      onEventHandler: new NodejsFunction(this, "Function", {
        entry: require.resolve(`${__dirname}/handler`),
        runtime: lambda.Runtime.NODEJS_24_X,
        timeout: cdk.Duration.minutes(5),
        awsSdkConnectionReuse: false,
        initialPolicy: [
          new iam.PolicyStatement({
            actions: ["ses:DeleteIdentity", "ses:VerifyEmailIdentity"],
            resources: ["*"],
          }),
        ],
      }),
    })

    this.serviceToken = this.provider.serviceToken
  }
}
