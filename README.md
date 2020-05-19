# Liflig CDK

[![Build Status](https://jenkins.capra.tv/buildStatus/icon?job=cals-libs/liflig-cdk/master)](https://jenkins.capra.tv/job/cals-libs/job/liflig-cdk/job/master)

More details to come.

## State of repository and package

This is an early experiment of building reusable constructs and patterns for
CDK setups, for use within Liflig. We do not expect others to depend on this,
and as such will not be following semantic versioning strictly. There will be
breaking changes across both minor and patch releases, as we will be
coordinating changes internally.

CDK has some major issues for 3rd party library authors which
are not yet resolved. Some relevant information:

* https://github.com/aws/aws-cdk-rfcs/blob/master/text/0006-monolothic-packaging.md
