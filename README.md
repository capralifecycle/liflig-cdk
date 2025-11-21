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

## Contributing

This project accepts contributions. To get started, see the [Contributing Guidelines](./CONTRIBUTING.md).
