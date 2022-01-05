import * as elb from "@aws-cdk/aws-elasticloadbalancingv2"
import * as route53 from "@aws-cdk/aws-route53"
import * as route53Targets from "@aws-cdk/aws-route53-targets"
import * as cdk from "@aws-cdk/core"

export interface ListenerRuleProps {
  httpsListener: elb.IApplicationListener
  loadBalancer: elb.IApplicationLoadBalancer
  domainName: string
  listenerPriority: number
  targetGroup: elb.IApplicationTargetGroup
  /**
   * If 'hostedZone' is an A record for 'domainName' is created with
   * the 'loadBalancer' as target
   */
  hostedZone?: route53.IHostedZone
}

export class ListenerRule extends cdk.Construct {
  /**
   * The rule created in the ALB Listener.
   *
   * Use {@link elb.ApplicationListenerRule.addCondition} to add [other conditions](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-listeners.html#rule-condition-types)
   * than Host-header.
   */
  public readonly applicationListenerRule: elb.ApplicationListenerRule

  constructor(scope: cdk.Construct, id: string, props: ListenerRuleProps) {
    super(scope, id)

    this.applicationListenerRule = new elb.ApplicationListenerRule(
      this,
      "ListenerRule",
      {
        listener: props.httpsListener,
        priority: props.listenerPriority,
        conditions: [elb.ListenerCondition.hostHeaders([props.domainName])],
        targetGroups: [props.targetGroup],
      },
    )

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
