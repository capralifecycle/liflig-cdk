import * as constructs from "constructs"
import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager"
import * as cloudfront from "aws-cdk-lib/aws-cloudfront"
import * as origins from "aws-cdk-lib/aws-cloudfront-origins"
import * as iam from "aws-cdk-lib/aws-iam"
import * as r53 from "aws-cdk-lib/aws-route53"
import * as r53t from "aws-cdk-lib/aws-route53-targets"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as webappDeploy from "@capraconsulting/webapp-deploy-lambda"
import {
  WebappSecurityHeaders,
  WebappSecurityHeadersProps,
} from "./security-headers"

export interface WebappProps {
  /**
   * ACM certificate that covers the specifeid domain names.
   *
   * This certificate must be created in the region us-east-1.
   *
   * @default - The CloudFront wildcard certificate (*.cloudfront.net) will be used.
   */
  cloudfrontCertificate?: certificatemanager.ICertificate
  /**
   * List of domain names the CloudFront distribution should use.
   *
   * @default - Generated name (e.g., d111111abcdef8.cloudfront.net)
   */
  domainNames?: string[]
  /**
   * AWS WAF web ACL to associate with the CloudFront distribution.
   *
   * To specify a web ACL created using the latest version of AWS WAF, use the ACL ARN, for example
   * `arn:aws:wafv2:us-east-1:123456789012:global/webacl/ExampleWebACL/473e64fd-f30b-4765-81a0-62ad96dd167a`.
   * To specify a web ACL created using AWS WAF Classic, use the ACL ID, for example `473e64fd-f30b-4765-81a0-62ad96dd167a`.
   *
   * @default - No AWS Web Application Firewall web access control list (web ACL).
   */
  webAclId?: string
  /**
   * The path to the page that will be served for users not allowed to access
   * the site when using WAF. E.g. "/4xx-errors/403-forbidden.html".
   *
   * Note that this wil catch any 403 errors from the origin(s), that might
   * cover any other behaviors is added.
   *
   * @default - No custom page for 403 errors.
   */
  webAclErrorPagePath?: string
  /**
   *  Enable, disable or configure security headers for the web application
   * @default - a set of strict security headers are configured by default
   */
  securityHeaders?: {
    /**
     * Enable adding common security headers to CloudFront responses
     *
     * If enabled, the default behavior is to add the following headers with fairly strict defaults. Most of the headers can be customized:
     * - Content-Security-Policy
     * - Referrer-Policy
     * - Strict-Transport-Security
     * - X-Content-Type-Options
     * - X-Frame-Options
     * - X-XSS-Protection
     *
     *
     * @default true
     */
    enabled?: boolean
    /**
     * Security headers overrides.
     *
     * Used to override certain default security header values if the webapp requires different settings than the defaults.
     *
     * NOTE: If you need to disable certain headers, you must explicitly set them to undefined
     *
     * @default - A set of strict security header values will be used
     */
    behaviorOverrides?: WebappSecurityHeadersProps
  }
  /**
   * Cloudfront behavior overrides.
   *
   * Used to override cloudfront behavior
   *
   * NOTE: ResponseHeadersPolicy defined here will overwrite BOTH the default security headers policy and
   * any values specified in securityHeaders.behaviorOverrides.
   */
  overrideCloudFrontBehaviourOptions?: Partial<cloudfront.BehaviorOptions>
}

/**
 * CloudFront for a Single-Page-Application.
 *
 * A bucket will be created and its prefix "web" is used to
 * serve files. Use the addDeployment method to automatically
 * deploy files as part the the CDK deployment.
 */
export class Webapp extends constructs.Construct {
  public readonly distribution: cloudfront.Distribution
  public readonly webappBucket: s3.Bucket
  public readonly webappOrigin: origins.S3Origin

  constructor(scope: constructs.Construct, id: string, props: WebappProps) {
    super(scope, id)

    if (props.webAclErrorPagePath != null && props.webAclId == null) {
      throw new Error("webAclErrorPagePath set but webAclId is missing")
    }

    this.webappBucket = new s3.Bucket(this, "Bucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
    })

    const originAccessIdentity = new cloudfront.OriginAccessIdentity(
      this,
      "OriginAccessIdentity",
    )

    this.webappBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: [this.webappBucket.arnForObjects("*")],
        actions: ["s3:GetObject"],
        principals: [originAccessIdentity.grantPrincipal],
      }),
    )

    this.webappBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        resources: [this.webappBucket.bucketArn],
        // Grant s3:ListBucket so that CloudFront receives 404 from
        // the origin rather than 403 when accessing files that
        // does not exist. We cannot fallback to index.html for 403
        // errors since it would also be served if using a WAF.
        // See https://aws.amazon.com/premiumsupport/knowledge-center/s3-website-cloudfront-error-403/#The_requested_objects_must_exist_in_the_bucket
        actions: ["s3:ListBucket"],
        principals: [originAccessIdentity.grantPrincipal],
      }),
    )

    this.webappOrigin = new origins.S3Origin(this.webappBucket, {
      // webapp-deploy-lambda will upload files to this folder
      // since it keeps some other administrative files outside.
      originPath: "/web",
      originAccessIdentity,
    })

    const errorResponses: cloudfront.ErrorResponse[] = [
      {
        httpStatus: 404,
        responseHttpStatus: 200,
        responsePagePath: "/index.html",
      },
    ]

    if (props.webAclErrorPagePath != null) {
      errorResponses.push({
        httpStatus: 403,
        responseHttpStatus: 403,
        responsePagePath: props.webAclErrorPagePath,
      })
    }

    let responseHeadersPolicy: cloudfront.IResponseHeadersPolicy | undefined

    if (
      (props.securityHeaders?.enabled ?? true) &&
      !props.overrideCloudFrontBehaviourOptions?.responseHeadersPolicy
        ?.responseHeadersPolicyId
    ) {
      const securityHeaders = new WebappSecurityHeaders(
        this,
        "SecurityHeaders",
        {
          ...props.securityHeaders?.behaviorOverrides,
        },
      )
      responseHeadersPolicy = securityHeaders.responseHeadersPolicy
    }

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: this.webappOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: responseHeadersPolicy,
        ...props.overrideCloudFrontBehaviourOptions,
      },
      defaultRootObject: "index.html",
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      certificate: props.cloudfrontCertificate,
      domainNames: props.domainNames,
      errorResponses,
      webAclId: props.webAclId,
    })
  }

  addDnsRecord(hostedZone: r53.IHostedZone, domainName: string): void {
    new r53.ARecord(this, `DnsRecord${domainName}`, {
      zone: hostedZone,
      recordName: `${domainName}.`,
      target: r53.RecordTarget.fromAlias(
        new r53t.CloudFrontTarget(this.distribution),
      ),
    })
  }

  /**
   * Add a deployment using webapp-deploy-lambda.
   *
   * See https://github.com/capraconsulting/webapp-deploy-lambda
   * for details about how this works.
   */
  addDeployment(
    /**
     * The deployment source.
     */
    source: webappDeploy.ISource,
    props?: {
      /**
       * Include source maps in the deployment.
       *
       * @default false
       */
      deploySourceMaps?: boolean
    },
  ): void {
    const deploySourceMaps = props?.deploySourceMaps ?? false

    new webappDeploy.WebappDeploy(this, "Deploy", {
      source: source,
      webBucket: this.webappBucket,
      distribution: this.distribution,
      excludePattern: deploySourceMaps ? undefined : "\\.map$",
    })
  }
}
