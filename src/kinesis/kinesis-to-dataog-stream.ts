import * as iam from "@aws-cdk/aws-iam"
import * as firehose from "@aws-cdk/aws-kinesisfirehose"
import * as logs from "@aws-cdk/aws-logs"
import * as s3 from "@aws-cdk/aws-s3"
import { BlockPublicAccess } from "@aws-cdk/aws-s3"
import * as secretsmanager from "@aws-cdk/aws-secretsmanager"
import * as cdk from "@aws-cdk/core"

export interface KinesisToDatadogStreamProps {
  env: {
    account: string
    region: string
  }
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
  logGroups: logs.LogGroup[]
}

export class KinesisToDatadogStream extends cdk.Construct {
  constructor(
    scope: cdk.Construct,
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

    const deliveryStreamLogStreamArn = `arn:aws:logs:${props.env.account}:log-group:/aws/kinesisfirehose/${deliveryStreamLogStream.logStreamName}:log-stream:*`

    const failedDataBucket = new s3.Bucket(this, "FailedDataBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    })

    const cloudWatchLogsRole = new iam.Role(this, "CloudWatchLogsRole", {
      assumedBy: new iam.ServicePrincipal(
        `logs.${props.env.region}.amazonaws.com`,
      ),
    })

    new iam.Policy(this, "CloudWatchLogsPolicy", {
      document: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            actions: [
              "firehose:PutRecord",
              "firehose:PutRecordBatch",
              "kinesis:PutRecord",
              "kinesis:PutRecordBatch",
            ],
            resources: [
              `arn:aws:firehose:${props.env.region}:${props.env.account}:*`,
            ],
          }),
          new iam.PolicyStatement({
            actions: ["iam:PassRole"],
            resources: [cloudWatchLogsRole.roleArn],
          }),
        ],
      }),
      roles: [cloudWatchLogsRole],
    })

    const firehoseLogsRole = new iam.Role(this, "FirehoseLogsRole", {
      assumedBy: new iam.ServicePrincipal("firehose.amazonaws.com"),
    })

    const cfnFirehoseLogsRole = firehoseLogsRole.node
      .defaultChild as iam.CfnRole
    const cfnFailedDataBucket = failedDataBucket.node
      .defaultChild as iam.CfnRole

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
    datadogDeliveryStream.addDependsOn(cfnFirehoseLogsRole)
    datadogDeliveryStream.addDependsOn(cfnFailedDataBucket)

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
            resources: [deliveryStreamLogStreamArn],
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
