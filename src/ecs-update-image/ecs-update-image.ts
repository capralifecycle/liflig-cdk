import * as constructs from "constructs"
import * as ecr from "aws-cdk-lib/aws-ecr"
import * as ecs from "aws-cdk-lib/aws-ecs"
import * as iam from "aws-cdk-lib/aws-iam"
import * as lambda from "aws-cdk-lib/aws-lambda"
import * as cdk from "aws-cdk-lib"
import { startDeployHandler } from "./start-deploy-handler"
import { statusHandler } from "./status-handler"
import { EcsUpdateImageTag } from "./tag"

interface Props {
  cluster: ecs.ICluster
  service?: ecs.IService
  taskRole?: iam.IRole
  executionRole?: iam.IRole
  /**
   * The role that will be granted permission to assume the deploy
   * role. This role must have permission to assume the deploy role.
   */
  callerRoleArn: string
  /**
   * The name that will be used for the deploy role. This is the role
   * that the caller will assume in order to have permission to invoke
   * the Lambda Functions.
   */
  roleName: string
  startDeployFunctionName: string
  statusFunctionName: string
  tagContainer: EcsUpdateImageTag
  ecrRepository: ecr.IRepository
}

/**
 * Dynamically update image of an ECS Service outside CDK.
 *
 * This construct sets up a Lambda Function that can be invoked
 * from the CD pipeline to update the ECS Service to a new image.
 *
 * To keep resources in sync, a Secret is used to keep track of
 * the current image, which is dynamically resolved in the CloudFormation
 * templates to avoid infrastructure changes to cause an older/different
 * image to be used.
 */
export class EcsUpdateImage extends constructs.Construct {
  constructor(scope: constructs.Construct, id: string, props: Props) {
    super(scope, id)

    const account = cdk.Stack.of(this).account
    const region = cdk.Stack.of(this).region

    const roleToBeAssumed = new iam.Role(this, "Role", {
      roleName: props.roleName,
      assumedBy: new iam.ArnPrincipal(props.callerRoleArn),
    })

    const startDeployFn = new lambda.Function(this, "StartDeployFunction", {
      functionName: props.startDeployFunctionName,
      code: new lambda.InlineCode(
        `exports.handler = ${startDeployHandler.toString()};`,
      ),
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      timeout: cdk.Duration.seconds(60),
      environment: {
        CLUSTER_NAME: props.cluster.clusterName,
        SERVICE_NAME: props.service == null ? "" : props.service.serviceName,
        REPOSITORY_URL: props.ecrRepository.repositoryUri,
        ECR_TAG_SECRET_ARN: props.tagContainer.secretArn,
      },
      reservedConcurrentExecutions: 1,
    })

    startDeployFn.grantInvoke(roleToBeAssumed)
    props.tagContainer.grantUpdate(startDeployFn)

    if (props.service != null) {
      startDeployFn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            "ecs:DeregisterTaskDefinition",
            "ecs:DescribeServices",
            "ecs:DescribeTaskDefinition",
            "ecs:DescribeTasks",
            "ecs:ListTasks",
            "ecs:ListTaskDefinitions",
            "ecs:RegisterTaskDefinition",
          ],
          resources: ["*"],
        }),
      )

      startDeployFn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["ecs:UpdateService"],
          resources: [
            `arn:aws:ecs:${region}:${account}:service/${props.cluster.clusterName}/${props.service.serviceName}`,
          ],
        }),
      )
    }

    if (props.taskRole != null) {
      props.taskRole.grantPassRole(startDeployFn.role!)
    }

    if (props.executionRole != null) {
      props.executionRole.grantPassRole(startDeployFn.role!)
    }

    const statusFn = new lambda.Function(this, "StatusFunction", {
      functionName: props.statusFunctionName,
      code: new lambda.InlineCode(
        `exports.handler = ${statusHandler.toString()};`,
      ),
      runtime: lambda.Runtime.NODEJS_16_X,
      handler: "index.handler",
      timeout: cdk.Duration.seconds(60),
      environment: {
        CLUSTER_NAME: props.cluster.clusterName,
        SERVICE_NAME: props.service == null ? "" : props.service.serviceName,
      },
    })

    statusFn.grantInvoke(roleToBeAssumed)

    statusFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "ecs:DeregisterTaskDefinition",
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
          "ecs:DescribeTasks",
          "ecs:ListTasks",
          "ecs:ListTaskDefinitions",
        ],
        resources: ["*"],
      }),
    )
  }
}
