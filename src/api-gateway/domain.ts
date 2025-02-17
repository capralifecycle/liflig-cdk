import * as constructs from "constructs"
import * as cdk from "aws-cdk-lib"
import * as apigw from "aws-cdk-lib/aws-apigatewayv2"
import * as route53 from "aws-cdk-lib/aws-route53"
import * as route53Targets from "aws-cdk-lib/aws-route53-targets"
import * as acm from "aws-cdk-lib/aws-certificatemanager"

export type ApiGatewayDnsProps = {
  /**
   * Only the subdomain prefix, which should be the name of the service.
   * Example: Subdomain `product` would give the end result of an API-GW with
   * `product.platform.example.no`.
   */
  subdomain: string

  /**
   * Hosted Zone for the external facing domain.
   * This is where routes will be created, to redirect consumers to the API-GW.
   * For example a HZ for `platform.example.no`.
   */
  hostedZone: route53.IHostedZone

  /**
   * The Time To Live (TTL) for the public DNS A record that will expose the API-GW.
   * This is how long DNS servers will cache the record.
   *
   * A long TTL (hours) is beneficial to DNS servers, but makes developers (you) wait longer when
   * doing changes.
   *
   * @default 5 minutes
   */
  ttl?: cdk.Duration
}

/**
 * Creates a custom domain for the API-Gateway, a Route53 record and an HTTPS cert.
 *
 * @author Kristian Rekstad <kre@capraconsulting.no>
 */
export class ApiGatewayDomain extends constructs.Construct {
  /** The Fully Qualified Domain Name (FQDN) like `product.platform.example.no`. */
  public readonly fullDomainName: string

  public readonly apiGwDomainName: apigw.DomainName

  constructor(
    scope: constructs.Construct,
    id: string,
    props: ApiGatewayDnsProps,
  ) {
    super(scope, id)
    this.fullDomainName = `${props.subdomain}.${props.hostedZone.zoneName}`

    // Can also use wildcard certs instead! Cheaper
    /** Allows external users to connect with HTTPS. */
    const customDomainCert = new acm.Certificate(this, "HttpsCertificate", {
      domainName: this.fullDomainName,
      validation: acm.CertificateValidation.fromDns(props.hostedZone),
    })

    // Note that API-GW can also support wildcard domains! https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-custom-domain-names.html#http-wildcard-custom-domain-names
    // But this will not work when AWS account X has CustomDomain `staging.platform.example.no` and account Y has CustomDomain `*.platform.example.no`.
    // Not sure how sub-subdomains are affected: `myservice.staging.platform.example.no` and `*.platform.example.no`.
    this.apiGwDomainName = new apigw.DomainName(
      this,
      "DomainName-" + props.subdomain,
      {
        domainName: this.fullDomainName,
        certificate: customDomainCert,
        endpointType: apigw.EndpointType.REGIONAL,
        securityPolicy: apigw.SecurityPolicy.TLS_1_2,
      },
    )

    // This makes the API-GW publicly available on the custom domain name.
    new route53.ARecord(this, "Route53ARecordApigwAlias", {
      recordName: props.subdomain,
      zone: props.hostedZone,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.ApiGatewayv2DomainProperties(
          this.apiGwDomainName.regionalDomainName,
          this.apiGwDomainName.regionalHostedZoneId,
        ),
      ),
      ttl: props.ttl ?? cdk.Duration.minutes(5), // Low TTL makes it easier to do changes
    })
  }
}
