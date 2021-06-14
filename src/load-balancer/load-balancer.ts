import * as certificatemanager from "@aws-cdk/aws-certificatemanager"
import * as ec2 from "@aws-cdk/aws-ec2"
import * as elb from "@aws-cdk/aws-elasticloadbalancingv2"
import { ListenerAction } from "@aws-cdk/aws-elasticloadbalancingv2"
import * as s3 from "@aws-cdk/aws-s3"
import * as cdk from "@aws-cdk/core"

export interface LoadBalancerProps {
  certificates: certificatemanager.ICertificate[]
  vpc: ec2.IVpc
  overrideLoadBalancerProps?: Partial<elb.ApplicationLoadBalancerProps>
}

export class LoadBalancer extends cdk.Construct {
  public readonly loadBalancer: elb.ApplicationLoadBalancer
  public readonly httpsListener: elb.ApplicationListener
  public readonly accessLogsBucket: s3.Bucket

  constructor(scope: cdk.Construct, id: string, props: LoadBalancerProps) {
    super(scope, id)

    this.loadBalancer = new elb.ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc: props.vpc,
      internetFacing: true,
      vpcSubnets: props.vpc.selectSubnets({
        subnetType: ec2.SubnetType.PUBLIC,
      }),
      ...props.overrideLoadBalancerProps,
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

    this.accessLogsBucket = new s3.Bucket(this, "AccessLogsBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(30),
        },
      ],
    })

    this.loadBalancer.logAccessLogs(this.accessLogsBucket)
  }
}
