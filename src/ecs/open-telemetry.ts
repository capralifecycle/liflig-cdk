import * as constructs from "constructs"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as iam from "aws-cdk-lib/aws-iam"
import * as logs from "aws-cdk-lib/aws-logs"
import { RetentionDays } from "aws-cdk-lib/aws-logs"
import { RemovalPolicy } from "aws-cdk-lib"
import { FargateService } from "./fargate-service"

export interface OpenTelemetryCollectorsProps {
  service: FargateService

  /** @default 6 months **/
  logRetention?: RetentionDays

  /** @default "amazon/aws-otel-collector:v0.43.1" */
  dockerImage?: string
}

/**
 * Methods to enable collection of Open Telemetry (otel) data of a {@link FargateService}
 * using a docker container with an otel agent.
 *
 *
 * An example of a java auto-instrumentation agent in docker can be found
 * [in liflig-rest-baseline Dockerfile](https://github.com/capralifecycle/liflig-rest-service-baseline/blob/a29b5a472c982aa7ce04d09d0e7cfdc92a6cc977/docker/Dockerfile#L9-L29).
 *
 * The agent must be configured to output metrics to a collector.
 * That collector is what this construct provides.
 * Usually, the agent is specified in the Dockerfile or as a dependency/library,
 * and configured in the Dockerfile or in the application source code.
 *
 * Use this construct on a {@link FargateService} by constructing a new instance of {@link OpenTelemetryCollectors}
 * and calling the {@link addOpenTelemetryCollectorSidecar} method on it.
 *
 * ```ts
 * const service = FargateService(...);
 *
 * new OpenTelemetryCollectors(this, "OtelSidecar").addOpenTelemetryCollectorSidecar(service)
 * ```
 *
 * The sidecar exposes these ports to your service:
 * - udp 2000 : AWS XRay
 * - tcp 55680 : AWS CloudWatch EMF collection
 * - tcp 55681 : OpenTelemetry collection HTTP
 * - tcp 4317 : OpenTelemetry collection GRPC
 * - udp 8125 : StatsD
 *
 * ---
 *
 * You can also disable the Open Telemetry instrumentation agent
 * for Java-based services,
 * by setting the appropriate environment variable with {@link disableOpenTelemetryJavaAgent}:
 * ```ts
 * const service = FargateService(...);
 *
 * OpenTelemetryCollectors.disableOpenTelemetryJavaAgent(service)
 * ```
 *
 * @see OpenTelemetryCollectors.addOpenTelemetryCollectorSidecar
 */
export class OpenTelemetryCollectors extends constructs.Construct {
  constructor(
    scope: constructs.Construct,
    id: string,
    private readonly props: OpenTelemetryCollectorsProps,
  ) {
    super(scope, id)
  }

  /**
   * The open-telemetry java agent may run by default in the Docker image.
   * This method will tell the agent to disable itself.
   *
   * You might want to do this to avoid overhead or error logs from failed
   * connection attempts to the otel collector.
   */
  public disableOpenTelemetryJavaAgent() {
    OpenTelemetryCollectors.disableOpenTelemetryJavaAgent(this.props.service)
  }

  /**
   * The open-telemetry java agent may run by default in the Docker image.
   * This method will tell the agent to disable itself.
   *
   * You might want to do this to avoid overhead or error logs from failed
   * connection attempts to the otel collector.
   * @param service
   */
  public static disableOpenTelemetryJavaAgent(service: FargateService) {
    service.taskDefinition.defaultContainer?.addEnvironment(
      "OTEL_JAVAAGENT_ENABLED",
      "false",
    )
  }

  /**
   * Adds a sidecar with an AWS Distro OpenTelemetry Collector.
   * https://aws-otel.github.io/docs/setup/ecs
   *
   * You also need to add either the Java SDK for OTel or a java agent,
   * to capture telemetry and send to this collector.
   */
  public addOpenTelemetryCollectorSidecar() {
    new OpenTelemetryPolicies(this, "OpenTelemetryPolicies", {
      taskDefinition: this.props.service.taskDefinition,
    })

    this.props.service.taskDefinition.addExtension(
      new OpenTelemetryCollectorSidecar(
        this,
        this.props.logRetention,
        this.props.dockerImage,
      ),
    )
  }
}

/**
 * Adds a sidecar with an AWS Distro OpenTelemetry Collector.
 * https://aws-otel.github.io/docs/setup/ecs
 *
 * You also need to add either the Java SDK for OTel or a java agent,
 * to capture telemetry and send to this collector.
 */
class OpenTelemetryCollectorSidecar implements ecs.ITaskDefinitionExtension {
  constructor(
    private readonly construct: constructs.Construct,
    private readonly logRetention?: RetentionDays,
    private readonly dockerImage?: string,
  ) {}

  extend(taskDefinition: ecs.TaskDefinition): void {
    if (taskDefinition.networkMode !== ecs.NetworkMode.AWS_VPC) {
      throw new Error(
        "Task NetworkMode must be AWS_VPC: " + taskDefinition.networkMode,
      )
    }

    const commands = {
      metricsAndTraces: "--config=/etc/ecs/ecs-default-config.yaml",
      metricsAndTracesAndContainerResources:
        "--config=/etc/ecs/container-insights/otel-task-metrics-config.yaml",
    }

    const logGroup = new logs.LogGroup(this.construct, "CollectorLogGroup", {
      retention: this.logRetention ?? RetentionDays.SIX_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY,
    })

    const sidecarImage = this.dockerImage ?? "amazon/aws-otel-collector:v0.43.1"
    const sidecar = taskDefinition.addContainer("aws-opentelemetry-collector", {
      cpu: 32,
      memoryReservationMiB: 24,
      memoryLimitMiB: 256,
      image: ecs.ContainerImage.fromRegistry(sidecarImage),
      command: [commands.metricsAndTracesAndContainerResources], // This is not used when the AOT_CONFIG_CONTENT is set!
      environment: {
        // You can alternatively create an SSM parameter with the config, and pass it to the `secrets` option
        AOT_CONFIG_CONTENT: awsOtelCustomConfigYaml,
      },
      logging: ecs.LogDrivers.awsLogs({
        logGroup: logGroup,
        streamPrefix: "ecs",
      }),
    })

    // A dependency should be added to all containers that export metrics.
    // We are currently assuming that this is only the default container
    taskDefinition.defaultContainer?.addContainerDependencies({
      container: sidecar,
      condition: ecs.ContainerDependencyCondition.START,
    })

    /*
     * aws-otel-collector exposes these ports, and more:
     * - udp 2000 : AWS XRay
     * - tcp 55680 : AWS CloudWatch EMF collection
     * - tcp 55681 : OpenTelemetry collection HTTP
     * - tcp 4317 : OpenTelemetry collection GRPC
     * - udp 8125 : StatsD
     */
    taskDefinition.defaultContainer?.addEnvironment(
      "AWS_XRAY_DAEMON_ADDRESS",
      "http://localhost:2000",
    )
    taskDefinition.defaultContainer?.addEnvironment(
      "OTEL_EXPORTER_OTLP_ENDPOINT",
      "http://localhost:4317",
    )
    taskDefinition.defaultContainer?.addEnvironment(
      "OTEL_JAVAAGENT_ENABLED",
      "true",
    )

    if (!taskDefinition.isFargateCompatible) {
      // This extension is made for the FargateService, so this is a requirement.
      throw new Error(
        "This task definition can not be ran on fargate! " +
          taskDefinition.node.id,
      )
    }
  }
}

interface OpenTelemetryPoliciesProps {
  taskDefinition: ecs.TaskDefinition
}

class OpenTelemetryPolicies extends constructs.Construct {
  constructor(
    scope: constructs.Construct,
    id: string,
    props: OpenTelemetryPoliciesProps,
  ) {
    super(scope, id)

    const awsDistroOpenTelemetryPolicyStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ["*"],
      actions: [
        "logs:PutLogEvents",
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:DescribeLogStreams",
        "logs:DescribeLogGroups",
        "logs:PutRetentionPolicy",
        "xray:PutTraceSegments",
        "xray:PutTelemetryRecords",
        "xray:GetSamplingRules",
        "xray:GetSamplingTargets",
        "xray:GetSamplingStatisticSummaries",
        "cloudwatch:PutMetricData",
        "ec2:DescribeVolumes",
        "ec2:DescribeTags",
        "ssm:GetParameters",
      ],
    })

    props.taskDefinition.addToTaskRolePolicy(
      awsDistroOpenTelemetryPolicyStatement,
    )

    props.taskDefinition.addToExecutionRolePolicy(
      awsDistroOpenTelemetryPolicyStatement,
    )
    props.taskDefinition.executionRole?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchLogsFullAccess"),
    )
    props.taskDefinition.executionRole?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMReadOnlyAccess"),
    )
  }
}

/**
 * This is a modified version of `./etc/ecs/container-insights/otel-task-metrics-config.yaml`
 * where we add `resource_to_telemetry_conversion` so the otel resource `service.name`
 * can be added to the metric. This is useful because you can filter in metrics based on service,
 * instead of grouping e.g. all services' memory usage under the same metric.
 *
 * Search for `# THIS IS WHAT LIFLIG ADDED` to find our modifications.
 *
 * https://github.com/aws-observability/aws-otel-collector/blob/14833d4af543da709c77cf9dc6827351dbd529b1/config/ecs/container-insights/otel-task-metrics-config.yaml
 * Original copyright is Apache 2.0 to AWS.
 *
 * @see https://aws-otel.github.io/docs/setup/ecs/config-through-ssm
 */
const awsOtelCustomConfigYaml = `extensions:
  health_check:

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:55681
  awsxray:
    endpoint: 0.0.0.0:2000
    transport: udp
  statsd:
    endpoint: 0.0.0.0:8125
    aggregation_interval: 60s
  awsecscontainermetrics:

processors:
  batch/traces:
    timeout: 1s
    send_batch_size: 50
  batch/metrics:
    timeout: 60s
  filter:
    metrics:
      include:
        match_type: strict
        metric_names:
          - ecs.task.memory.reserved
          - ecs.task.memory.utilized
          - ecs.task.cpu.reserved
          - ecs.task.cpu.utilized
          - ecs.task.network.rate.rx
          - ecs.task.network.rate.tx
          - ecs.task.storage.read_bytes
          - ecs.task.storage.write_bytes
          - container.duration
  metricstransform:
    transforms:
      - include: ecs.task.memory.utilized
        action: update
        new_name: MemoryUtilized
      - include: ecs.task.memory.reserved
        action: update
        new_name: MemoryReserved
      - include: ecs.task.cpu.utilized
        action: update
        new_name: CpuUtilized
      - include: ecs.task.cpu.reserved
        action: update
        new_name: CpuReserved
      - include: ecs.task.network.rate.rx
        action: update
        new_name: NetworkRxBytes
      - include: ecs.task.network.rate.tx
        action: update
        new_name: NetworkTxBytes
      - include: ecs.task.storage.read_bytes
        action: update
        new_name: StorageReadBytes
      - include: ecs.task.storage.write_bytes
        action: update
        new_name: StorageWriteBytes

  resource:
    attributes:
      - key: ClusterName
        from_attribute: aws.ecs.cluster.name
        action: insert
      - key: aws.ecs.cluster.name
        action: delete
      - key: ServiceName
        from_attribute: aws.ecs.service.name
        action: insert
      - key: aws.ecs.service.name
        action: delete
      - key: TaskId
        from_attribute: aws.ecs.task.id
        action: insert
      - key: aws.ecs.task.id
        action: delete
      - key: TaskDefinitionFamily
        from_attribute: aws.ecs.task.family
        action: insert
      - key: aws.ecs.task.family
        action: delete
      - key: TaskARN
        from_attribute: aws.ecs.task.arn
        action: insert
      - key: aws.ecs.task.arn
        action: delete
      - key: DockerName
        from_attribute: aws.ecs.docker.name
        action: insert
      - key: aws.ecs.docker.name
        action: delete
      - key: TaskDefinitionRevision
        from_attribute: aws.ecs.task.version
        action: insert
      - key: aws.ecs.task.version
        action: delete
      - key: PullStartedAt
        from_attribute: aws.ecs.task.pull_started_at
        action: insert
      - key: aws.ecs.task.pull_started_at
        action: delete
      - key: PullStoppedAt
        from_attribute: aws.ecs.task.pull_stopped_at
        action: insert
      - key: aws.ecs.task.pull_stopped_at
        action: delete
      - key: AvailabilityZone
        from_attribute: cloud.zone
        action: insert
      - key: cloud.zone
        action: delete
      - key: LaunchType
        from_attribute: aws.ecs.task.launch_type
        action: insert
      - key: aws.ecs.task.launch_type
        action: delete
      - key: Region
        from_attribute: cloud.region
        action: insert
      - key: cloud.region
        action: delete
      - key: AccountId
        from_attribute: cloud.account.id
        action: insert
      - key: cloud.account.id
        action: delete
      - key: DockerId
        from_attribute: container.id
        action: insert
      - key: container.id
        action: delete
      - key: ContainerName
        from_attribute: container.name
        action: insert
      - key: container.name
        action: delete
      - key: Image
        from_attribute: container.image.name
        action: insert
      - key: container.image.name
        action: delete
      - key: ImageId
        from_attribute: aws.ecs.container.image.id
        action: insert
      - key: aws.ecs.container.image.id
        action: delete
      - key: ExitCode
        from_attribute: aws.ecs.container.exit_code
        action: insert
      - key: aws.ecs.container.exit_code
        action: delete
      - key: CreatedAt
        from_attribute: aws.ecs.container.created_at
        action: insert
      - key: aws.ecs.container.created_at
        action: delete
      - key: StartedAt
        from_attribute: aws.ecs.container.started_at
        action: insert
      - key: aws.ecs.container.started_at
        action: delete
      - key: FinishedAt
        from_attribute: aws.ecs.container.finished_at
        action: insert
      - key: aws.ecs.container.finished_at
        action: delete
      - key: ImageTag
        from_attribute: container.image.tag
        action: insert
      - key: container.image.tag
        action: delete

  # THIS IS WHAT LIFLIG ADDED
  resourcedetection:
    detectors:
      - env
      - ecs
      - ec2
  resource/application:
    attributes:
      - key: aws.ecs.task.family
        action: delete
      - key: host.id
        action: delete
      - key: aws.ecs.task.arn
        action: delete
      - key: aws.ecs.task.revision
        action: delete
      - key: aws.ecs.launchtype
        action: delete
      - key: aws.ecs.cluster.arn
        action: delete
      - key: cloud.provider
        action: delete
      - key: cloud.platform
        action: delete
      - key: cloud.account.id
        action: delete
      - key: cloud.region
        action: delete
      - key: cloud.availability_zone
        action: delete
      - key: aws.log.group.names
        action: delete
      - key: aws.log.group.arns
        action: delete
      - key: aws.log.stream.names
        action: delete
      - key: host.image.id
        action: delete
      - key: host.name
        action: delete
      - key: host.type
        action: delete
      - key: container.id
        action: delete
      - key: http.flavor
        action: delete
      - key: http.scheme
        action: delete
      - key: http.url
        action: delete
      - key: container.name
        action: delete
      - key: host.arch
        action: delete
      - key: http.route
        action: delete
      - key: net.peer.name
        action: delete
      - key: os.description
        action: delete
      - key: os.type
        action: delete
      - key: process.command_line
        action: delete
      - key: process.executable.path
        action: delete
      - key: process.pid
        action: delete
      - key: process.runtime.description
        action: delete
      - key: process.runtime.name
        action: delete
      - key: process.runtime.version
        action: delete
      - key: telemetry.auto.version
        action: delete
      - key: telemetry.sdk.language
        action: delete
      - key: telemetry.sdk.name
        action: delete
      - key: telemetry.sdk.version
        action: delete
  # END OF LIFLIG CHANGES

exporters:
  awsxray:
  awsemf/application:
    namespace: ECS/AWSOTel/Application
    log_group_name: '/aws/ecs/application/metrics'
    # THIS IS WHAT LIFLIG ADDED
    resource_to_telemetry_conversion:
      enabled: true
    # END OF LIFLIG CHANGES
  awsemf/performance:
    namespace: ECS/ContainerInsights
    log_group_name: '/aws/ecs/containerinsights/{ClusterName}/performance'
    log_stream_name: '{TaskId}'
    resource_to_telemetry_conversion:
      enabled: true
    dimension_rollup_option: NoDimensionRollup
    metric_declarations:
      - dimensions: [ [ ClusterName ], [ ClusterName, TaskDefinitionFamily ] ]
        metric_name_selectors:
          - MemoryUtilized
          - MemoryReserved
          - CpuUtilized
          - CpuReserved
          - NetworkRxBytes
          - NetworkTxBytes
          - StorageReadBytes
          - StorageWriteBytes
      - metric_name_selectors: [container.*]

service:
  pipelines:
    traces:
      receivers: [otlp,awsxray]
      processors: [batch/traces]
      exporters: [awsxray]
    metrics/application:
      receivers: [otlp, statsd]
      processors: [resourcedetection, resource/application, batch/metrics]
      exporters: [awsemf/application]
    metrics/performance:
      receivers: [awsecscontainermetrics ]
      processors: [filter, metricstransform, resource]
      exporters: [ awsemf/performance ]

  extensions: [health_check]

`
