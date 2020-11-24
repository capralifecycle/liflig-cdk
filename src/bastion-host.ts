import * as ec2 from "@aws-cdk/aws-ec2"
import * as iam from "@aws-cdk/aws-iam"
import * as cdk from "@aws-cdk/core"

interface Props {
  vpc: ec2.IVpc
  securityGroup: ec2.ISecurityGroup
  subnetSelection?: ec2.SubnetSelection
}

/**
 * This creates a EC2 bastion host that can be used to connect
 * to database instances and other internal resources.
 *
 * The instance is supposed to have no open ingress ports, and users
 * are supposed to connect only through SSM Session Manager.
 *
 * The resources that the bastion host should be allowed to access
 * must have the bastion host security group as allowed ingress.
 *
 * For more internal details, see
 * https://confluence.capraconsulting.no/x/q8UBC
 */
export class BastionHost extends cdk.Construct {
  constructor(scope: cdk.Construct, id: string, props: Props) {
    super(scope, id)

    const region = cdk.Stack.of(this).region

    const instance = new ec2.Instance(this, "Instance", {
      vpc: props.vpc,
      vpcSubnets: props.subnetSelection,
      securityGroup: props.securityGroup,
      instanceName: "Bastion",
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.NANO,
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
    })

    instance.addUserData(
      `yum install -y https://amazon-ssm-${region}.s3.amazonaws.com/latest/linux_amd64/amazon-ssm-agent.rpm socat postgresql mariadb`,
    )

    // SSM support.
    instance.addToRolePolicy(
      // This mimics the AmazonEC2RoleforSSM policy
      // while granting least privileges needed.
      //
      // The default AmazonEC2RoleforSSM policy gives read/write access
      // to all objects in S3, all parameters in Parameter Store, amoung
      // more. We primarily use the SSM agent for limited remote control,
      // and the policy here covers that as the primary use case.
      //
      // See https://www.cflee.com/posts/aws-ssm-iam-policy-caveats/
      // See also https://docs.aws.amazon.com/systems-manager/latest/userguide/setup-instance-profile.html
      new iam.PolicyStatement({
        actions: [
          // https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-setting-up-messageAPIs.html
          // https://docs.aws.amazon.com/IAM/latest/UserGuide/list_awssystemsmanager.html
          "ssm:ListInstanceAssociations",
          "ssm:UpdateInstanceInformation",
          "ssm:GetDocument",
          "ssm:PutInventory",
          "ssm:UpdateInstanceAssociationStatus",
          // https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-setting-up-messageAPIs.html
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
          // https://docs.aws.amazon.com/IAM/latest/UserGuide/list_amazonmessagedeliveryservice.html
          "ec2messages:AcknowledgeMessage",
          "ec2messages:DeleteMessage",
          "ec2messages:FailMessage",
          "ec2messages:GetEndpoint",
          "ec2messages:GetMessages",
          "ec2messages:SendReply",
        ],
        // Seems this is needed for the given actions.
        resources: ["*"],
      }),
    )

    new cdk.CfnOutput(this, "BastionInstanceId", {
      value: instance.instanceId,
    })
  }
}
