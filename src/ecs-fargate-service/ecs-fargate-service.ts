import * as ec2 from "@aws-cdk/aws-ec2"
import * as ecs from "@aws-cdk/aws-ecs"
import * as elb from "@aws-cdk/aws-elasticloadbalancingv2"
import * as logs from "@aws-cdk/aws-logs"
import * as cdk from "@aws-cdk/core"
import { Duration } from "@aws-cdk/core"
import { ConfigureParameters } from "../configure-parameters"
import { Parameter } from "../configure-parameters/configure-parameters"

interface Props {
  serviceName: string
  vpc: ec2.IVpc
  cluster: ecs.ICluster
  desiredCount: number
  parameters?: Parameter[]
  ecsImage: ecs.ContainerImage
  cpu?: number
  memoryLimitMiB?: number
  /**
   * @default 2 weeks
   */
  logsRetention?: logs.RetentionDays
  /**
   * @default 15 seconds
   */
  deregistrationDelay?: cdk.Duration
  /**
   * @default 8080
   */
  containerPort?: number
  /**
   * @default 60 seconds
   */
  healthCheckGracePeriod?: cdk.Duration
  overrideHealthCheck?: Partial<elb.HealthCheck>
  stickinessCookieName?: string
  stickinessCookieDuration?: cdk.Duration
  secrets?: Record<string, ecs.Secret>
  environment?: Record<string, string>
}

export class EcsFargateService extends cdk.Construct {
  public readonly securityGroup: ec2.SecurityGroup
  public readonly taskDefinition: ecs.TaskDefinition
  public readonly targetGroup: elb.ApplicationTargetGroup
  public readonly logGroup: logs.LogGroup

  constructor(scope: cdk.Construct, id: string, props: Props) {
    super(scope, id)

    const parameters = new ConfigureParameters(this, {
      ssmPrefix: `/liflig-cdk/${cdk.Stack.of(this).stackName}/${
        this.node.addr
      }/parameters`,
      parameters: props.parameters ?? [],
    })

    this.logGroup = new logs.LogGroup(this, "LogGroup", {
      retention: props.logsRetention ?? logs.RetentionDays.TWO_WEEKS,
    })

    this.securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      vpc: props.vpc,
    })

    this.taskDefinition = new ecs.FargateTaskDefinition(
      this,
      "TaskDefinition",
      {
        cpu: props.cpu ?? 256,
        memoryLimitMiB: props.memoryLimitMiB ?? 512,
      },
    )

    parameters.grantRead(this.taskDefinition.taskRole)

    const environment: Record<string, string> = {
      SSM_PREFIX: parameters.ssmPrefix,
      // Not read by the application, only used to help with redeployments.
      PARAMS_HASH: parameters.hashValue,
    }

    if (props.environment) {
      for (const key in props.environment) {
        environment[key] = props.environment[key]
      }
    }

    const container = this.taskDefinition.addContainer("Container", {
      logging: ecs.LogDriver.awsLogs({
        logGroup: this.logGroup,
        streamPrefix: "ecs",
        datetimeFormat: "%Y-%m-%dT%H:%M:%S",
      }),
      image: props.ecsImage,
      secrets: props.secrets,
      environment: environment,
    })

    const port = props.containerPort ?? 8080

    container.addPortMappings({
      containerPort: port,
      hostPort: port,
    })

    const service = new ecs.FargateService(this, "Service", {
      serviceName: props.serviceName,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      taskDefinition: this.taskDefinition,
      cluster: props.cluster,
      minHealthyPercent: 100,
      healthCheckGracePeriod: props.healthCheckGracePeriod,
      desiredCount: props.desiredCount,
      assignPublicIp: true,
      securityGroup: this.securityGroup,
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
    })

    for (const param of parameters.parameters) {
      service.node.addDependency(param)
    }

    this.targetGroup = new elb.ApplicationTargetGroup(this, "TargetGroup", {
      protocol: elb.ApplicationProtocol.HTTP,
      port: port,
      vpc: props.vpc,
      targetType: elb.TargetType.IP,
      targets: [service],
      stickinessCookieName: props.stickinessCookieName,
      stickinessCookieDuration: props.stickinessCookieDuration,
      deregistrationDelay:
        props.deregistrationDelay ?? cdk.Duration.seconds(15),
    })

    this.targetGroup.configureHealthCheck({
      interval: Duration.seconds(10),
      path: "/health",
      healthyThresholdCount: 2,
      ...props.overrideHealthCheck,
    })
  }
}
