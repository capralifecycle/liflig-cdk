# Contributing

These guidelines are intended to help contributors understand the considerations that must be made when integrating changes into the library.

Changes will be reviewed by the maintainers of the library, but individual contributors must ensure that the proposed changes are in line with the guidelines in this document.

## Communication

When contributing to this library, please strongly consider first discussing the change you wish to make with the maintainers via the Slack channel [#dev-infra](https://liflig.slack.com/archives/C02T4KTPYS2), as there may be reasons why the change is not already present in the library.

Pull requests are evaluated in the context of other ongoing deliveries. For high priority changes, this must be communicated clearly.

When a new pull request is opened, please inform the maintainers via the Slack channel [#dev-infra](https://liflig.slack.com/archives/C02T4KTPYS2).

## Contribution guidelines

### Context

When proposing changes, a brief description of the context of the change is expected, such as the problem that the change solves, or the reason for the change.

### Generality

Being a shared library, changes should be made with the intention of being useful to a broad audience, and not tailored to a specific use case, domain or customer.

### Scope of impact

Ensure there is a clear understanding of whom this change will affect, if any, and how.

If the change requires action from existing library consumers, ensure there is a strategy of how the change will be rolled out.

### Testing

Ensure there is a strategy for how the change will be tested going forward to keep the code maintainable.

Being solely manually tested or tested in a non-reproducible manner is not sufficient, as this will incur a maintenance cost in the future.

### Security & stability

Follow the Principle of Least Privilege when designing your own IAM Policies.

Avoid introducing unstable, immature or custom resources if possible, as these may be subject to change and require considerable rework.

### Code guidelines

- Follow the existing code conventions of the library
- When defining default values for constructs, such as `minCapacity` or `maxCapacity`, ensure that the reasoning for the choice of values are documented
- Prefer general and flexible code to highly specific and inflexible code, as the latter are more likely to require rework and continual maintenance.
