import * as cdk from "aws-cdk-lib"
import { Duration } from "aws-cdk-lib"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as ecs from "aws-cdk-lib/aws-ecs"
import { CfnService } from "aws-cdk-lib/aws-ecs"
import * as elb from "aws-cdk-lib/aws-elasticloadbalancingv2"
import * as logs from "aws-cdk-lib/aws-logs"
import * as constructs from "constructs"
import { ConfigureParameters } from "../configure-parameters"
import { Parameter } from "../configure-parameters/configure-parameters"

export interface FargateServiceProps {
  serviceName: string
  vpc: ec2.IVpc
  cluster: ecs.ICluster
  desiredCount: number
  ecsImage: ecs.ContainerImage
  /**
   * @default 256
   */
  cpu?: number
  /**
   * @default 512
   */
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
  /**
   * Use this as workaround when adding the service to a load balancer after
   * it has been created. For avoiding 'Health check grace period is only valid for services configured to use load balancers'
   * Link to GitHub issue: https://github.com/aws/aws-cdk/issues/19842
   */
  skipHealthCheckGracePeriod?: boolean
  parameters?: Parameter[]
  overrideFargateServiceProps?: Partial<ecs.FargateServiceProps>
  overrideHealthCheck?: Partial<elb.HealthCheck>
  overrideTargetGroupProps?: Partial<elb.ApplicationTargetGroupProps>
  overrideContainerProps?: Partial<ecs.ContainerDefinitionOptions>
  secrets?: Record<string, ecs.Secret>
  environment?: Record<string, string>
  /**
   * @default false
   */
  skipTargetGroup?: boolean
  /**
   * @default false
   */
  enableCircuitBreaker?: boolean
}

export class FargateService extends constructs.Construct {
  public readonly fargateService: ecs.FargateService
  public readonly securityGroup: ec2.SecurityGroup
  public readonly taskDefinition: ecs.TaskDefinition
  public readonly targetGroup: elb.ApplicationTargetGroup | undefined
  public readonly logGroup: logs.LogGroup

  constructor(
    scope: constructs.Construct,
    id: string,
    props: FargateServiceProps,
  ) {
    super(scope, id)

    /**
     * Set this flag to disable this stack creating a completely new service and attempting replace when enabling circuit breakers
     * Mitigating the deployment error: 'a service with the name <...> already exists'
     * See: github.com/aws/aws-cdk/pull/22467
     */
    this.node.setContext(
      "@aws-cdk/aws-ecs:disableExplicitDeploymentControllerForCircuitBreaker",
      true,
    )

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

    const container = this.taskDefinition.addContainer("Container", {
      logging: ecs.LogDriver.awsLogs({
        logGroup: this.logGroup,
        streamPrefix: "ecs",
        datetimeFormat: "%Y-%m-%dT%H:%M:%S",
      }),
      image: props.ecsImage,
      secrets: props.secrets,
      environment: {
        SSM_PREFIX: parameters.ssmPrefix,
        // Not read by the application, only used to help with redeployments.
        PARAMS_HASH: parameters.hashValue,
        ...(props.environment ?? {}),
      },
      linuxParameters: new ecs.LinuxParameters(this, "LinuxParameters", {
        initProcessEnabled: true,
      }),
      ...props.overrideContainerProps,
    })

    const port = props.containerPort ?? 8080

    container.addPortMappings({
      containerPort: port,
      hostPort: port,
    })

    const enableCircuitBreaker = props.enableCircuitBreaker ?? false

    this.fargateService = new ecs.FargateService(this, "Service", {
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
      securityGroups: [this.securityGroup],
      platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
      enableExecuteCommand: true,
      circuitBreaker: enableCircuitBreaker
        ? {
            enable: true,
            rollback: true,
          }
        : undefined,
      ...props.overrideFargateServiceProps,
    })

    if (props.skipHealthCheckGracePeriod) {
      ;(
        this.fargateService.node.defaultChild as CfnService
      ).healthCheckGracePeriodSeconds = undefined
    }

    for (const param of parameters.parameters) {
      this.fargateService.node.addDependency(param)
    }

    if (!props.skipTargetGroup) {
      this.targetGroup = new elb.ApplicationTargetGroup(this, "TargetGroup", {
        protocol: elb.ApplicationProtocol.HTTP,
        port: port,
        vpc: props.vpc,
        targetType: elb.TargetType.IP,
        targets: [this.fargateService],
        deregistrationDelay:
          props.deregistrationDelay ?? cdk.Duration.seconds(15),
        ...props.overrideTargetGroupProps,
      })

      this.targetGroup.configureHealthCheck({
        interval: Duration.seconds(10),
        path: "/health",
        healthyThresholdCount: 2,
        ...props.overrideHealthCheck,
      })
    }
  }
}
