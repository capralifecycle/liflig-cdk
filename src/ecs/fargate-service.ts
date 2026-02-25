import * as cdk from "aws-cdk-lib"
import { Duration } from "aws-cdk-lib"
import type * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import type { CfnService } from "aws-cdk-lib/aws-ecs"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as elb from "aws-cdk-lib/aws-elasticloadbalancingv2"
import * as logs from "aws-cdk-lib/aws-logs"
import * as constructs from "constructs"
import { ServiceAlarms } from "../alarms"
import type { Parameter } from "../configure-parameters"
import { ConfigureParameters } from "../configure-parameters"

export type ServiceAlarmsConfig =
  | { enabled: false }
  | {
      alarmAction: cloudwatch.IAlarmAction
      warningAction: cloudwatch.IAlarmAction
      loadBalancerFullName: string
      jsonErrorAlarm?: {
        enabled?: boolean
        alarmDescription?: string
        enableOkAction?: boolean
        action?: cloudwatch.IAlarmAction
      }
      targetHealthAlarm?: {
        enabled?: boolean
        action?: cloudwatch.IAlarmAction
        period?: cdk.Duration
        evaluationPeriods?: number
        threshold?: number
        description?: string
      }
      tooMany5xxResponsesFromTargetsAlarm?: {
        enabled?: boolean
        action?: cloudwatch.IAlarmAction
        period?: cdk.Duration
        evaluationPeriods?: number
        threshold?: number
        description?: string
      }
      targetResponseTimeAlarm?: {
        enabled?: boolean
        action?: cloudwatch.IAlarmAction
        period?: cdk.Duration
        evaluationPeriods?: number
        threshold?: cdk.Duration
        description?: string
      }
    }

export interface FargateServiceProps {
  serviceName: string
  vpc: ec2.IVpc
  cluster: ecs.ICluster
  desiredCount: number
  ecsImage: ecs.ContainerImage
  portMappings?: ecs.PortMapping[]
  containerHealthCheck?: ecs.HealthCheck
  /**
   * @default 256
   */
  cpu?: number
  /**
   * @default undefined
   */
  runtimePlatform?: ecs.RuntimePlatform
  /**
   * @default 512
   */
  memoryLimitMiB?: number
  /**
   * @default 2 weeks
   */
  logsRetention?: logs.RetentionDays
  /**
   * @default AwsLogDriverMode.BLOCKING
   */
  logDriverMode?: ecs.AwsLogDriverMode
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
  /**
   *  Either
   *  - `{ enabled: false }` to disable all alarms.
   *  - object with required `alarmAction`, `warningAction`, and `loadBalancerFullName`.
   *
   *  When enabled, the construct will:
   *  - Add a log-based JSON error alarm (enabled by default).
   *  - Add target-group related alarms (target health, 5xx responses, response time) when a target group is present.
   */
  alarms: ServiceAlarmsConfig
}

export class FargateService extends constructs.Construct {
  public readonly fargateService: ecs.FargateService
  public readonly securityGroup: ec2.SecurityGroup
  public readonly taskDefinition: ecs.TaskDefinition
  public readonly targetGroup: elb.ApplicationTargetGroup | undefined
  public readonly logGroup: logs.LogGroup
  public readonly serviceAlarms: ServiceAlarms

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
        runtimePlatform: props.runtimePlatform,
      },
    )

    parameters.grantRead(this.taskDefinition.taskRole)

    const port = props.containerPort ?? 8080
    this.taskDefinition.addContainer("Container", {
      logging: ecs.LogDriver.awsLogs({
        logGroup: this.logGroup,
        streamPrefix: "ecs",
        datetimeFormat: "%Y-%m-%dT%H:%M:%S",
        mode: props.logDriverMode ?? ecs.AwsLogDriverMode.BLOCKING,
      }),
      image: props.ecsImage,
      secrets: props.secrets,
      healthCheck: props.containerHealthCheck,
      portMappings: props.portMappings ?? [
        {
          containerPort: port,
          hostPort: port,
        },
      ],
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

    // Require explicit alarmAction and warningAction when enabled.
    if (props.alarms && "alarmAction" in props.alarms) {
      const alarms = props.alarms

      this.serviceAlarms = new ServiceAlarms(this, "Alarms", {
        serviceName: props.serviceName,
        alarmAction: alarms.alarmAction,
        warningAction: alarms.warningAction,
      })

      const jsonErrorOverrides = alarms.jsonErrorAlarm
      if (jsonErrorOverrides?.enabled ?? true) {
        this.serviceAlarms.addJsonErrorAlarm({
          logGroup: this.logGroup,
          alarmDescription: jsonErrorOverrides?.alarmDescription,
          enableOkAction: jsonErrorOverrides?.enableOkAction,
          action: jsonErrorOverrides?.action,
        })
      }

      if (!props.skipTargetGroup) {
        this.serviceAlarms.addTargetGroupAlarms({
          targetGroupFullName: this.targetGroup!.targetGroupFullName,
          loadBalancerFullName: alarms.loadBalancerFullName,
          targetHealthAlarm: alarms.targetHealthAlarm,
          tooMany5xxResponsesFromTargetsAlarm:
            alarms.tooMany5xxResponsesFromTargetsAlarm,
          targetResponseTimeAlarm: alarms.targetResponseTimeAlarm,
        })
      }
    }
  }
}
