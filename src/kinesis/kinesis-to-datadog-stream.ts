import * as cdk from "aws-cdk-lib"
import * as iam from "aws-cdk-lib/aws-iam"
import * as firehose from "aws-cdk-lib/aws-kinesisfirehose"
import * as logs from "aws-cdk-lib/aws-logs"
import * as s3 from "aws-cdk-lib/aws-s3"
import { BlockPublicAccess } from "aws-cdk-lib/aws-s3"
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager"
import * as constructs from "constructs"

export interface KinesisToDatadogStreamProps {
  /**
   *
   * The name of the SecretsManager secret where your Datadog API key is saved.
   *
   * The secret must be a JSON object on the format { "value": "SECRET" }
   *
   */
  datadogApiKeySecretName: string
  /**
   *
   * The CloudWatch log groups from you are streaming to Datadog
   *
   */
  logGroups: logs.ILogGroup[]
}

/**
 *
 * Forwards logs from log-groups in CloudWatch to a Datadog account.
 * The logs are delivered through a Firehose delivery stream, which is being subscribed to the log-groups in CloudWatch.
 *
 * @author Stein-Aage
 */
export class KinesisToDatadogStream extends constructs.Construct {
  constructor(
    scope: constructs.Construct,
    id: string,
    props: KinesisToDatadogStreamProps,
  ) {
    super(scope, id)

    const deliveryStreamLogGroup = new logs.LogGroup(
      this,
      "DeliveryStreamLogGroup",
    )

    const deliveryStreamLogStream = new logs.LogStream(
      this,
      "DeliveryStreamLogStream",
      {
        logGroup: deliveryStreamLogGroup,
      },
    )

    const failedDataBucket = new s3.Bucket(this, "FailedDataBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    })

    const cloudWatchLogsRole = new iam.Role(this, "CloudWatchLogsRole", {
      assumedBy: new iam.ServicePrincipal(
        `logs.${cdk.Stack.of(this).region}.amazonaws.com`,
      ),
    })

    const firehoseLogsRole = new iam.Role(this, "FirehoseLogsRole", {
      assumedBy: new iam.ServicePrincipal("firehose.amazonaws.com"),
    })

    const datadogDeliveryStream = new firehose.CfnDeliveryStream(
      this,
      "DeliveryStream",
      {
        deliveryStreamType: "DirectPut",
        httpEndpointDestinationConfiguration: {
          roleArn: firehoseLogsRole.roleArn,
          endpointConfiguration: {
            url: "https://aws-kinesis-http-intake.logs.datadoghq.eu/v1/input",
            accessKey: secretsmanager.Secret.fromSecretNameV2(
              scope,
              "DatadogApiKey",
              props.datadogApiKeySecretName,
            )
              .secretValueFromJson("value")
              .toString(),
            name: "datadog-logs-endpoint",
          },
          requestConfiguration: {
            contentEncoding: "GZIP",
          },
          cloudWatchLoggingOptions: {
            enabled: true,
            logGroupName: deliveryStreamLogGroup.logGroupName,
            logStreamName: deliveryStreamLogStream.logStreamName,
          },
          bufferingHints: {
            intervalInSeconds: 60,
            sizeInMBs: 4,
          },
          retryOptions: {
            durationInSeconds: 60,
          },
          s3BackupMode: "FailedDataOnly",
          s3Configuration: {
            bucketArn: failedDataBucket.bucketArn,
            compressionFormat: "UNCOMPRESSED",
            roleArn: firehoseLogsRole.roleArn,
          },
        },
      },
    )

    new iam.Policy(this, "CloudWatchLogsPolicy", {
      document: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            actions: ["firehose:PutRecord", "firehose:PutRecordBatch"],
            resources: [datadogDeliveryStream.attrArn],
          }),
        ],
      }),
      roles: [cloudWatchLogsRole],
    })

    new iam.Policy(this, "FirehoseLogsPolicy", {
      document: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            actions: [
              "s3:AbortMultipartUpload",
              "s3:GetBucketLocation",
              "s3:GetObject",
              "s3:ListBucket",
              "s3:ListBucketMultipartUploads",
              "s3:PutObject",
            ],
            resources: [
              failedDataBucket.bucketArn,
              `${failedDataBucket.bucketArn}/*`,
            ],
          }),
          new iam.PolicyStatement({
            actions: ["logs:PutLogEvents"],
            resources: [
              `arn:aws:logs:${cdk.Stack.of(this).region}:${
                cdk.Stack.of(this).account
              }:log-group:${deliveryStreamLogGroup.logGroupName}:log-stream:${
                deliveryStreamLogStream.logStreamName
              }`,
            ],
          }),
          new iam.PolicyStatement({
            actions: [
              "kinesis:DescribeStream",
              "kinesis:GetShardIterator",
              "kinesis:GetRecords",
            ],
            resources: [datadogDeliveryStream.attrArn],
          }),
        ],
      }),
      roles: [firehoseLogsRole],
    })

    props.logGroups.forEach((logGroup, index) => {
      new logs.CfnSubscriptionFilter(this, `SubscriptionFilter${index}`, {
        logGroupName: logGroup.logGroupName,
        destinationArn: datadogDeliveryStream.attrArn,
        filterPattern: logs.FilterPattern.allEvents().logPatternString,
        roleArn: cloudWatchLogsRole.roleArn,
      })
    })
  }
}
