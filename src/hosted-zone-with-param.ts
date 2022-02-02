import * as constructs from "constructs"
import * as route53 from "aws-cdk-lib/aws-route53"
import * as ssm from "aws-cdk-lib/aws-ssm"
import * as cdk from "aws-cdk-lib"
import { SsmParameterReader } from "./ssm-parameter-reader"
import { getStageOrApp } from "./utils"

interface Props extends route53.HostedZoneProps {
  /**
   * We don't expect a hosted zone to be recreated while it is being
   * referenced in other stacks, but in case it is, this value can be
   * used to force consumers to refresh the value.
   *
   * @default 1
   */
  nonce?: string
}

/**
 * A Hosted Zone that writes its ID to SSM Parameter Store and provides
 * a helper to easily retrieve the Hosted Zone cross-region.
 */
export class HostedZoneWithParam extends constructs.Construct {
  private readonly nonce: string
  private readonly hostedZone: route53.HostedZone
  readonly name: string
  readonly idParamName: string

  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)

    this.nonce = props.nonce ?? "1"
    this.name = props.zoneName
    this.idParamName = `/cf/hosted-zone-id/${props.zoneName}-${
      props.vpcs ? "private" : "public"
    }`

    this.hostedZone = new route53.HostedZone(this, "Resource", props)

    new ssm.CfnParameter(this, "IdParam", {
      type: ssm.ParameterType.STRING,
      name: this.idParamName,
      value: this.hostedZone.hostedZoneId,
    })

    if (this.hostedZone.hostedZoneNameServers) {
      new cdk.CfnOutput(this, "Nameservers", {
        value: cdk.Fn.join(", ", this.hostedZone.hostedZoneNameServers),
      })
    }

    new cdk.CfnOutput(this, "Id", {
      value: this.hostedZone.hostedZoneId,
    })
  }

  /**
   * Get the Hosted Zone by resolving the zone id from SSM Parameter Store
   * in case we are cross-region.
   */
  public getHostedZone(
    scope: constructs.Construct,
    id: string,
  ): route53.IHostedZone {
    const hostedZoneRegion = cdk.Stack.of(this).region
    const consumerRegion = cdk.Stack.of(scope).region

    const sameStageOrApp = getStageOrApp(this) === getStageOrApp(scope)

    // Fast-path: Same region and parent stage/app.
    if (hostedZoneRegion === consumerRegion && sameStageOrApp) {
      return this.hostedZone
    }

    // Only add dependency if within same app/stage. If not it
    // is the caller responsibility to ensure deployment order.
    if (sameStageOrApp) {
      scope.node.addDependency(this)
    }

    const hostedZoneId = new SsmParameterReader(scope, `${id}Param`, {
      parameterName: this.idParamName,
      region: cdk.Stack.of(this).region,
      nonce: this.nonce,
    }).getParameterValue()
    return route53.HostedZone.fromHostedZoneAttributes(scope, id, {
      hostedZoneId,
      zoneName: this.name,
    })
  }
}
