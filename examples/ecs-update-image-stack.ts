import * as constructs from "constructs"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as cdk from "aws-cdk-lib"
import {
  EcsUpdateImage,
  EcsUpdateImageArtifactStatus,
  EcsUpdateImageTag,
} from "../src"

interface Props extends cdk.StackProps {
  artifactStatus: EcsUpdateImageArtifactStatus
}

export class EcsUpdateImageStack extends cdk.Stack {
  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id, props)

    const cluster = new ecs.Cluster(this, "Cluster")

    const ecrRepository = ecr.Repository.fromRepositoryAttributes(
      this,
      "Repository",
      {
        repositoryArn: "arn:aws:ecr:eu-west-1:112233445566:repository/my-repo",
        repositoryName: "my-repo",
      },
    )

    const tagContainer = new EcsUpdateImageTag(this, "Tag", {
      artifactStatus: props.artifactStatus,
      secretName: "/my-service/image-tag",
    })

    let taskDefinition: ecs.TaskDefinition | undefined = undefined
    let service: ecs.FargateService | undefined = undefined

    const ecrTag = tagContainer.getEcrTag()
    if (ecrTag != null) {
      // Note that lots of attributes you would normally specify
      // is left out to keep the "test" simple.

      taskDefinition = new ecs.TaskDefinition(this, "TaskDefinition", {
        compatibility: ecs.Compatibility.FARGATE,
        cpu: "256",
        memoryMiB: "512",
        networkMode: ecs.NetworkMode.AWS_VPC,
      })

      taskDefinition.addContainer("Container", {
        logging: ecs.LogDriver.awsLogs({
          streamPrefix: "ecs",
        }),
        image: ecs.ContainerImage.fromEcrRepository(ecrRepository, ecrTag),
      })

      service = new ecs.FargateService(this, "Service", {
        taskDefinition,
        cluster,
      })
    }

    new EcsUpdateImage(this, "EcsUpdateImage", {
      cluster,
      service,
      taskRole: taskDefinition?.taskRole,
      executionRole: undefined,
      callerRoleArn: "arn:aws:iam::112233445566:role/some-role",
      roleName: "my-service-deploy",
      startDeployFunctionName: "my-service-deploy-start",
      statusFunctionName: "my-service-deploy-status",
      tagContainer: tagContainer,
      ecrRepository,
    })
  }
}
