import * as iam from "@aws-cdk/aws-iam"
import * as lambda from "@aws-cdk/aws-lambda"
import * as cdk from "@aws-cdk/core"
import * as cr from "@aws-cdk/custom-resources"
import { sesVerifyEmailHandler } from "./handler"

interface Props {
  /**
   * The email address to add as a verified email in SES.
   */
  emailAddress: string
}

export class SesVerifyEmail extends cdk.Construct {
  public route53RecordSets: cdk.IResolvable

  constructor(scope: cdk.Construct, id: string, props: Props) {
    super(scope, id)

    new cdk.CustomResource(this, "Resource", {
      serviceToken: SesVerifyEmailProvider.getOrCreate(this).serviceToken,
      properties: {
        EmailAddress: props.emailAddress,
      },
    })
  }
}

class SesVerifyEmailProvider extends cdk.Construct {
  /**
   * Returns the singleton provider.
   */
  public static getOrCreate(scope: cdk.Construct) {
    const stack = cdk.Stack.of(scope)
    const id = "liflig-cdk.ses-verify-email.provider"
    return (
      (stack.node.tryFindChild(id) as SesVerifyEmailProvider) ||
      new SesVerifyEmailProvider(stack, id)
    )
  }

  private readonly provider: cr.Provider
  public readonly serviceToken: string

  constructor(scope: cdk.Construct, id: string) {
    super(scope, id)

    this.provider = new cr.Provider(this, "Provider", {
      onEventHandler: new lambda.Function(this, "Function", {
        code: new lambda.InlineCode(
          `exports.handler = ${sesVerifyEmailHandler.toString()};`,
        ),
        handler: "index.handler",
        runtime: lambda.Runtime.NODEJS_12_X,
        timeout: cdk.Duration.minutes(5),
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
