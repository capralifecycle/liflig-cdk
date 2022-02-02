import * as constructs from "constructs"
import * as ec2 from "aws-cdk-lib/aws-ec2"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as iam from "aws-cdk-lib/aws-iam"
import * as logs from "aws-cdk-lib/aws-logs"
import * as s3 from "aws-cdk-lib/aws-s3"
import * as sfn from "aws-cdk-lib/aws-stepfunctions"
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks"
import * as cdk from "aws-cdk-lib"
import { cdkDeployRoleName } from "./conventions"

interface DeployEnvProps {
  accountId: string
  afterSuccessfulDeploy?: sfn.Chain
  artefactBucket: s3.IBucket
  envName: string
  vpc: ec2.IVpc
}

export class DeployEnv extends constructs.Construct {
  public chain: sfn.Chain

  constructor(scope: constructs.Construct, id: string, props: DeployEnvProps) {
    super(scope, id)

    const cluster = this.getOrCreateCluster(props.vpc)

    // We don't reuse the task definition across multiple pipelines
    // so that we can easier find the correct logs for each pipeline.

    const taskDefinition = new ecs.TaskDefinition(this, "TaskDefinition", {
      memoryMiB: "1024",
      cpu: "256",
      compatibility: ecs.Compatibility.FARGATE,
    })

    const containerDefinition = taskDefinition.addContainer("app", {
      image: ecs.ContainerImage.fromEcrRepository(
        ecr.Repository.fromRepositoryArn(
          this,
          "Repository",
          // See https://github.com/capralifecycle/liflig-cdk-deployer
          "arn:aws:ecr:eu-west-1:001112238813:repository/incub-common-liflig-cdk-deployer",
        ),
        "1-experimental.2",
      ),
      logging: ecs.LogDriver.awsLogs({
        logGroup: new logs.LogGroup(this, "LogGroup", {
          removalPolicy: cdk.RemovalPolicy.DESTROY,
          retention: logs.RetentionDays.ONE_MONTH,
        }),
        streamPrefix: "app",
      }),
    })

    const cdkRole = iam.Role.fromRoleArn(
      this,
      `CdkRole-${props.envName}`,
      `arn:aws:iam::${props.accountId}:role/${cdkDeployRoleName}`,
    )

    cdkRole.grant(taskDefinition.taskRole, "sts:AssumeRole")

    props.artefactBucket.grantRead(taskDefinition.taskRole)

    this.chain = sfn.Chain.start(
      new tasks.EcsRunTask(this, `Deploy ${props.envName}`, {
        resultPath: sfn.JsonPath.DISCARD,
        securityGroups: [this.getOrCreateTaskSecurityGroup(props.vpc)],
        integrationPattern: sfn.IntegrationPattern.RUN_JOB,
        cluster,
        assignPublicIp: true,
        launchTarget: new tasks.EcsFargateLaunchTarget(),
        taskDefinition,
        containerOverrides: [
          {
            containerDefinition,
            environment: [
              {
                name: "CDK_TARGET_ROLE_ARN",
                value: cdkRole.roleArn,
              },
              {
                name: "CDK_ENV_NAME",
                value: props.envName,
              },
              {
                name: "CDK_CLOUD_ASSEMBLY",
                value: sfn.JsonPath.stringAt("$.CloudAssembly"),
              },
              {
                name: "CDK_VARIABLES",
                value: sfn.JsonPath.stringAt("$.Variables"),
              },
            ],
          },
        ],
      }),
    )

    if (props.afterSuccessfulDeploy != null) {
      this.chain = this.chain.next(props.afterSuccessfulDeploy)
    }
  }

  // Reuse ECS cluster for multiple pipelines in same stack.
  private getOrCreateCluster(vpc: ec2.IVpc): ecs.Cluster {
    const stack = cdk.Stack.of(this)
    const uniqueId = "pipeline.04ad36b1.cluster"
    return (
      (stack.node.tryFindChild(uniqueId) as ecs.Cluster) ??
      new ecs.Cluster(stack, uniqueId, {
        vpc,
      })
    )
  }

  // Reuse security group for multiple pipelines in same stack.
  private getOrCreateTaskSecurityGroup(vpc: ec2.IVpc): ec2.SecurityGroup {
    const stack = cdk.Stack.of(this)
    const uniqueId = "pipeline.04ad36b1.security-group"
    return (
      (stack.node.tryFindChild(uniqueId) as ec2.SecurityGroup) ??
      new ec2.SecurityGroup(stack, uniqueId, {
        vpc,
      })
    )
  }
}
