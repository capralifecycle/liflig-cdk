import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as ecs from "aws-cdk-lib/aws-ecs"
import "jest-cdk-snapshot"
import { RetentionDays } from "aws-cdk-lib/aws-logs"
import { FargateService, OpenTelemetryCollectors } from ".."

describe("OpenTelemetryCollectors", () => {
  const createService = () => {
    const app = new App()
    const supportStack = new Stack(app, "SupportStack", {
      env: {
        region: "eu-west-1",
      },
    })
    const stack = new Stack(app, "Stack", {
      env: {
        region: "eu-west-1",
      },
    })

    const vpc = new ec2.Vpc(supportStack, "Vpc")

    const service = new FargateService(stack, "Service", {
      serviceName: "example-service",
      vpc: vpc,
      cluster: new ecs.Cluster(supportStack, "Cluster", {
        vpc,
      }),
      desiredCount: 2,
      parameters: [],
      ecsImage: ecs.ContainerImage.fromEcrRepository(
        new ecr.Repository(supportStack, "Repository", {
          repositoryName: "example-repository",
        }),
        "exampleEcrTag",
      ),
    })

    return { service, stack }
  }

  test("creates OpenTelemetry collector sidecar", () => {
    const { service, stack } = createService()

    new OpenTelemetryCollectors(stack, "OpenTelemetryCollectors", {
      service: service,
    }).addOpenTelemetryCollectorSidecar()

    expect(stack).toMatchCdkSnapshot()
  })

  test("sets all options on OpenTelemetry collector sidecar", () => {
    const { service, stack } = createService()

    new OpenTelemetryCollectors(stack, "OpenTelemetryCollectors", {
      service: service,
      awsOtelConfig: "myCustomYaml: true",
      dockerImage: "example-image:latest",
      logRetention: RetentionDays.FIVE_DAYS,
      containerProps: {
        cpu: 128,
        memoryLimitMiB: 2048,
        memoryReservationMiB: 1024,
      },
    }).addOpenTelemetryCollectorSidecar()

    expect(stack).toMatchCdkSnapshot()
  })

  test("disables OpenTelemetry Java agent", () => {
    const { service, stack } = createService()

    OpenTelemetryCollectors.disableOpenTelemetryJavaAgent(service)
    expect(stack).toMatchCdkSnapshot()
  })
})
