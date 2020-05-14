import * as codebuild from "@aws-cdk/aws-codebuild"
import * as iam from "@aws-cdk/aws-iam"
import * as lambda from "@aws-cdk/aws-lambda"
import * as s3 from "@aws-cdk/aws-s3"
import * as cdk from "@aws-cdk/core"
import { startDeployHandler } from "./start-deploy-handler"
import { statusHandler } from "./status-handler"

interface Props extends cdk.StackProps {
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
  /**
   * The bucket used for storing artifacts. This is used to grant
   * permission to the role to read artifact. If the bucket is in
   * another account, it must have a policy which allows the target
   * account to use IAM permissions from target account.
   */
  artifactsBucketName: string
  startDeployFunctionName: string
  statusFunctionName: string
  /**
   * This is the stack name used with `cdk bootstrap` and can e
   * found in cdk.json as "toolkitStackName".
   */
  cdkToolkitStackName: string
  /**
   * We pass the CDK context values as they contain feature flags
   * used by the CDK CLI.
   */
  cdkContext: Record<string, string | string[]>
}

/**
 * This construct is responsible for the privileges and logic of
 * automatically deploying stack resources in an account.
 * Its resources are used from a deployment pipeline.
 *
 * The deployment is performed by invoking the "start deploy"
 * lambda with details of what should be deployed. As this is
 * responsible for deploying infrastructure, the principal invoking
 * might be able to cause privilege escalation. The principal invoking
 * should be assumed to have full administrator access.
 *
 * The process deploying the infrastructure is locked down so this
 * is only possibly by deployment through CloudFormation, and as
 * such removes a lot of possible escalation paths (e.g. no role
 * can be created by direct API call).
 *
 * The "status" lambda can be used to poll for completion, and will
 * also return logs from the job upon completion.
 */
export class CdkDeploy extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string, props: Props) {
    super(scope, id)

    const account = cdk.Stack.of(this).account
    const region = cdk.Stack.of(this).region

    const artifactsBucket = s3.Bucket.fromBucketName(
      this,
      "ArtifactsBucket",
      props.artifactsBucketName,
    )

    const roleToBeAssumed = new iam.Role(this, "Role", {
      roleName: props.roleName,
      assumedBy: new iam.ArnPrincipal(props.callerRoleArn),
    })

    // Bucked used for input to CodeBuild.
    // We let CloudFormation manage the bucket name.
    const codebuildBucket = new s3.Bucket(this, "CodebuildSourceBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(5),
        },
      ],
    })

    // The role used for CloudFormation deployment.
    const cloudFormationRole = new iam.Role(this, "CloudFormationRole", {
      assumedBy: new iam.ServicePrincipal("cloudformation.amazonaws.com"),
      managedPolicies: [
        // TODO: Can we restrict this a bit more? E.g. look into how Griid has
        //  limited what the individual stack deployments have permissions to do.
        iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess"),
      ],
    })

    // Replace CodeBuild with ECS task?
    // See https://aws.amazon.com/blogs/devops/using-aws-codebuild-to-execute-administrative-tasks/
    const codebuildProject = new codebuild.Project(this, "CodebuildProject", {
      environment: {
        buildImage: codebuild.LinuxBuildImage.fromDockerRegistry("node:12"),
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        env: {
          variables: {
            CDK_DEPLOY_ROLE_ARN: cloudFormationRole.roleArn,
            CDK_TOOLKIT_STACK_NAME: props.cdkToolkitStackName,
          },
        },
        phases: {
          build: {
            commands: [
              "npm install -g aws-cdk",
              'cdk --app "$CODEBUILD_SRC_DIR_CLOUDASSEMBLY" --role-arn "$CDK_DEPLOY_ROLE_ARN" --toolkit-stack-name "$CDK_TOOLKIT_STACK_NAME" --require-approval never deploy --exclusively $(cat stack-names.txt)',
            ],
          },
        },
      }),
      timeout: cdk.Duration.hours(4),
    })

    // Grant access to CloudFormation.
    codebuildProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          // For diff.
          "cloudformation:DescribeStacks",
          "cloudformation:GetTemplate",
          // For deploy.
          "cloudformation:CreateChangeSet",
          "cloudformation:DescribeChangeSet",
          "cloudformation:ExecuteChangeSet",
          "cloudformation:DescribeStackEvents",
          "cloudformation:DeleteChangeSet",
        ],
        resources: ["*"],
      }),
    )

    // Grant access to the CDK Toolkit bucket.
    codebuildProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "s3:GetObject*",
          "s3:GetBucket*",
          "s3:List*",
          "s3:PutObject*",
          "s3:Abort*",
          "s3:DeleteObject*",
        ],
        resources: [
          `arn:aws:s3:::${props.cdkToolkitStackName}-stagingbucket-*`,
        ],
      }),
    )

    artifactsBucket.grantRead(codebuildProject)

    cloudFormationRole.grantPassRole(codebuildProject.role!)

    codebuildBucket.grantReadWrite(codebuildProject)

    const startDeployFn = new lambda.Function(this, "StartDeployFunction", {
      code: new lambda.InlineCode(
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        `exports.handler = ${startDeployHandler.toString()};`,
      ),
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: "index.handler",
      functionName: props.startDeployFunctionName,
      environment: {
        PROJECT_NAME: codebuildProject.projectName,
        BUCKET_NAME: codebuildBucket.bucketName,
        CDK_CONTEXT: JSON.stringify(props.cdkContext),
      },
      timeout: cdk.Duration.seconds(30),
    })

    startDeployFn.grantInvoke(roleToBeAssumed)
    codebuildBucket.grantReadWrite(startDeployFn)

    startDeployFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["codebuild:StartBuild", "codebuild:BatchGetBuilds"],
        resources: [codebuildProject.projectArn],
      }),
    )

    const statusFn = new lambda.Function(this, "StatusFunction", {
      code: new lambda.InlineCode(
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        `exports.handler = ${statusHandler.toString()};`,
      ),
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: "index.handler",
      functionName: props.statusFunctionName,
      environment: {
        PROJECT_NAME: codebuildProject.projectName,
      },
      timeout: cdk.Duration.seconds(30),
    })

    statusFn.grantInvoke(roleToBeAssumed)

    statusFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["codebuild:BatchGetBuilds"],
        resources: [codebuildProject.projectArn],
      }),
    )

    statusFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["logs:GetLogEvents"],
        resources: [
          `arn:aws:logs:${region}:${account}:log-group:/aws/codebuild/${codebuildProject.projectName}:log-stream:*`,
        ],
      }),
    )
  }
}
