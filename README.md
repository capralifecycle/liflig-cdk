# Liflig CDK

This is a collection of reusable constructs and patterns for
CDK setups, for use within Liflig.

## State of repository and package

We do not expect others to depend on this, and as such will not be following semantic versioning strictly.
There will be breaking changes across both minor and patch releases, as we will be coordinating changes internally.

CDK has some major issues for 3rd party library authors which
are not yet resolved. Some relevant information:

- <https://github.com/aws/aws-cdk-rfcs/blob/master/text/0006-monolothic-packaging.md>

## Pre-commit checklist

1. Lint code

   ```bash
   npm run lint
   ```

1. Run tests and update snapshots

   ```bash
   npm run snapshots
   npm run test -- -u
   ```

   Investigate any changes before committing.

## Testing library changes before releasing

### Alternative 1: Install liflig-cdk from tarball

1. Assemble artifact, which emits a tarball

   ```bash
   npm pack
   ```

2. Install the library in an application from a tarball

   ```bash
   npm install /path/to/liflig-cdk/liflig-cdk-0.0.0-development.tgz
   ```

### Alternative 2: Install liflig-cdk from a Git branch

1. Navigate to the project where you want to test the changes

   ```bash
   cd /path/to/other/project
   ```

2. Install the library in an application from a Git branch

   ```bash
   npm install github:capralifecycle/liflig-cdk#remove-del-and-glob-packages
   ```

Note: `npm link` cannot be used, since it will lead to multiple
declarations of the same classes from CDK, breaking the `instanceof`
operator.

## Verifying Lambda function changes

When updating lambda function runtimes or handler code, we sometimes need to verify that the lambda runs correctly aside from being syntactically correct, such as ensuring imports in handler code are valid for the specified runtime, that required environment variables exist, and so on.

Some specific approaches to validating specific lambda functions in this project:

- `src/alarms/slack-alarm.ts:slackLambda`
  - Trigger: CloudWatch alarm state change
  - Inspect: Slack notification
  - Desc: The function has an associated SNS Topic, which is configured as the action for a CloudWatch Alarm. To verify the function, we manually put the alarm into the ALARM state using the AWS CLI (`aws cloudwatch set-alarm-state --state-value "ALARM" ...`), which posts to the SNS topic and triggers the function. We can then verify that the function executes correctly by checking the Slack channel for the alarm notification, as well as the function logs in CloudWatch.
- `src/cdk-pipelines/liflig-cdk-pipeline.ts:prepareCdkSourceFn`
  - Trigger: CodePipeline deployment
  - Inspect: CloudWatch logs
  - Desc: This function is triggered by CodePipeline during deployment. To verify the function, we can observe the CodePipeline execution, and inspect the CloudWatch logs of the executed `PrepareCdkSource` step.
- `src/cdk-pipelines/slack-notification.ts:reportFunction`
  - Trigger: CodePipeline deployment failure
  - Inspect: Slack notification, CloudWatch logs
  - Desc: This function is triggered by CodePipeline during deployment when the pipeline state changes (ok to failed, and so on). To verify the function, we can introduce a failure in the pipeline (for example, by misconfiguring a build step), and observe the Slack notification sent by the function, as well as the function logs in CloudWatch.

## Contributing

This project accepts contributions. To get started, see the [Contributing Guidelines](./CONTRIBUTING.md).
