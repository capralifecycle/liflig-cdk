import * as constructs from "constructs"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as iam from "aws-cdk-lib/aws-iam"
import * as logs from "aws-cdk-lib/aws-logs"
import { RetentionDays } from "aws-cdk-lib/aws-logs"
import { RemovalPolicy } from "aws-cdk-lib"
import { FargateService } from "./fargate-service"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import * as path from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface OpenTelemetryCollectorsProps {
  service: FargateService

  /** @default 6 months **/
  logRetention?: RetentionDays

  /** @default "amazon/aws-otel-collector:v0.43.1" */
  dockerImage?: string

  /** Should be kept as `undefined` unless you know what you are doing.
   * This is the YAML config for the OpenTelemetry collector sidecar.
   *
   * An example of a config can be found at https://github.com/aws-observability/aws-otel-collector/blob/0ae198c7e7b8c43bcc8715f54e52c879c04407b6/config/ecs/container-insights/otel-task-metrics-config.yaml
   *
   * @default a file in `assets` tuned to work for aws and strips known high-cardinality metrics (like those containing IP addresses and ports)
   */
  awsOtelConfig?: string

  /** Overrides for the sidecar container.
   * You do not need to specify this.
   *
   * Defaults:
   * - cpu: 32 units
   * - memory reservation: 24 MiB
   * - memory limit: 256 MiB
   */
  containerProps?: SidecarContainerProps
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
 *
 * ---
 *
 * You can also disable the OpenTelemetry instrumentation agent
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
   * You also need to add either the Java SDK for OTel or a Java agent,
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
        this.props.awsOtelConfig,
        this.props.containerProps,
      ),
    )
  }
}

export type SidecarContainerProps = Pick<
  ecs.ContainerDefinitionProps,
  "cpu" | "memoryReservationMiB" | "memoryLimitMiB"
>

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
    private readonly awsOtelConfig?: string,
    private readonly containerProps?: SidecarContainerProps,
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
      cpu: this.containerProps?.cpu ?? 32,
      memoryReservationMiB: this.containerProps?.memoryReservationMiB ?? 24,
      memoryLimitMiB: this.containerProps?.memoryLimitMiB ?? 256,
      image: ecs.ContainerImage.fromRegistry(sidecarImage),
      command: [commands.metricsAndTracesAndContainerResources], // This is not used when the AOT_CONFIG_CONTENT is set!
      environment: {
        // You can alternatively create an SSM parameter with the config, and pass it to the `secrets` option
        AOT_CONFIG_CONTENT: this.awsOtelConfig ?? awsOtelCustomConfigYaml,
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
     *
     * These are defined in the yaml config for the collector.
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

/**
 * Grants the sidecar permissions to create logs, metrics and XRay traces by extending the task roles.
 */
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
 * @see https://aws-otel.github.io/docs/setup/ecs/config-through-ssm
 * @see https://aws-otel.github.io/docs/getting-started/cloudwatch-metrics#cloudwatch-emf-exporter-awsemf
 */
const awsOtelCustomConfigYaml = readFileSync(
  path.resolve(
    __dirname,
    "..",
    "..",
    "assets",
    "open-telemetry",
    "otel-collector-task-metrics-config.yaml",
  ),
  "utf-8",
)
  .split("\n")
  .filter((line) => !/^\s*##/.test(line)) // Skip comments starting with ##
  .join("\n")
