import * as elb from "@aws-cdk/aws-elasticloadbalancingv2"
import * as route53 from "@aws-cdk/aws-route53"
import * as route53Targets from "@aws-cdk/aws-route53-targets"
import * as cdk from "@aws-cdk/core"

export interface EcsServiceDnsProps {
  httpsListener: elb.IApplicationListener
  loadBalancer: elb.IApplicationLoadBalancer
  domainName: string
  listenerPriority: number
  targetGroup: elb.IApplicationTargetGroup
  hostedZone?: route53.IHostedZone
}

export class EcsServiceDns extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string, props: EcsServiceDnsProps) {
    super(scope, id)

    new elb.ApplicationListenerRule(this, "ListenerRule", {
      listener: props.httpsListener,
      priority: props.listenerPriority,
      hostHeader: props.domainName,
      targetGroups: [props.targetGroup],
    })

    if (props.hostedZone != null) {
      new route53.ARecord(this, "ARecord", {
        zone: props.hostedZone,
        recordName: `${props.domainName}.`,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.LoadBalancerTarget(props.loadBalancer),
        ),
      })
    }
  }
}
