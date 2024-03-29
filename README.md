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

1. Assemble artifact

   ```bash
   npm pack
   ```

   Install the library in an application

   ```bash
   npm install /path/to/liflig-cdk/liflig-cdk-0.0.0-development.tgz
   ```

Note: `npm link` cannot be used, since it will lead to multiple
declarations of the same classes from CDK, breaking the `instanceof`
operator.
