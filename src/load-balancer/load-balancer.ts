import * as certificatemanager from "@aws-cdk/aws-certificatemanager"
import * as ec2 from "@aws-cdk/aws-ec2"
import * as elb from "@aws-cdk/aws-elasticloadbalancingv2"
import { ListenerAction } from "@aws-cdk/aws-elasticloadbalancingv2"
import * as cdk from "@aws-cdk/core"

interface Props {
  certificates: certificatemanager.ICertificate[]
  vpc: ec2.IVpc
}

export class LoadBalancer extends cdk.Construct {
  public readonly loadBalancer: elb.ApplicationLoadBalancer
  public readonly httpsListener: elb.ApplicationListener

  constructor(scope: cdk.Construct, id: string, props: Props) {
    super(scope, id)

    this.loadBalancer = new elb.ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc: props.vpc,
      internetFacing: true,
      vpcSubnets: props.vpc.selectSubnets({
        subnetType: ec2.SubnetType.PUBLIC,
      }),
    })

    this.loadBalancer
      .addListener("HttpListener", {
        port: 80,
      })
      .addAction("HttpsRedirect", {
        action: ListenerAction.redirect({
          port: "443",
          protocol: "HTTPS",
          permanent: true,
        }),
      })

    // The Load Balancer require a default target group.
    // We will not connect anything to the default target group.
    const defaultTargetGroup = new elb.ApplicationTargetGroup(
      this,
      "DefaultTargetGroup",
      {
        protocol: elb.ApplicationProtocol.HTTP,
        port: 80,
        vpc: props.vpc,
        targetType: elb.TargetType.INSTANCE,
      },
    )

    this.httpsListener = this.loadBalancer.addListener("HttpsListener", {
      sslPolicy: elb.SslPolicy.TLS12,
      protocol: elb.ApplicationProtocol.HTTPS,
      port: 443,
      certificates: props.certificates,
      defaultTargetGroups: [defaultTargetGroup],
    })
  }
}
