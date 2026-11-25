# Build artifacts

`BuildArtifacts` creates what CI needs in the build account: an S3 bucket, ECR repositories, and the IAM roles that GitHub Actions assumes to write to them.

## Service repositories

- One ECR repository per service, named `services/<name>`, where `<name>` is the GitHub repository that builds the image. ECR only accepts lowercase letters and digits, separated by a single `.`, `_` or `-`.
- Tags are immutable. Pushing a tag that already exists fails, so every build, including a re-run, needs a new tag.
- AWS keeps a repository that is removed from `serviceRepositories` or whose stack is deleted. Adding it back fails until the existing repository is imported with `cdk import` or deleted.
- Construct IDs come from the name, so the order of the list does not matter.
- Lifecycle rules, in priority order:
  1. Untagged images expire after 10 days. Children of an image index are untagged, but ECR keeps them while the index exists.
  2. The 10 most recent images with a tag starting with `nd-` are kept. CI uses this prefix for images built from a non-default branch. Nothing enforces it: the limited role can push any tag from any branch.
  3. The 50 most recent tagged images are kept. ECR counts the `nd-` images kept by rule 2 among the 50, but never expires them through this rule.
- Rule 3 also expires an image that is still running. If 50 newer tagged images are pushed while an environment stays on an older one, for example because its pipeline is blocked, ECS can no longer start new tasks from that image.
- Every account in `targetAccountIds` may pull from every service repository. IAM in that account decides which roles may pull.
- The GitHub Actions roles may pull from and push to every repository under `services/`.

```ts
new BuildArtifacts(this, "BuildArtifacts", {
  bucketName: "my-bucket",
  targetAccountIds: ["222222222222"],
  githubActions: {
    repositories: [{ name: "*", owner: "my-org" }],
  },
  serviceRepositories: [
    { name: "my-service", owner: "my-org" },
    { name: "other-service", owner: "my-org" },
  ],
})
```

CI pushes to `<build account>.dkr.ecr.<region>.amazonaws.com/services/<name>`.

To run the image in another account, import the repository by the build account ID. `ecr.Repository.fromRepositoryName` resolves to the importing stack's own account, so it cannot be used here.

```ts
const repository = BuildArtifacts.importServiceRepository(this, "Repository", {
  account: "111111111111",
  name: "my-service",
})
ecs.ContainerImage.fromEcrRepository(repository, tag)
```

`fromEcrRepository` grants the task execution role pull on the repository.

## Aikido

Set `aikido` to let Aikido scan the service repositories. It requires `serviceRepositories`.

```ts
new BuildArtifacts(this, "BuildArtifacts", {
  // ...
  aikido: { externalId: "<external ID of your Aikido workspace>" },
})
```

- Creates the IAM role `AikidoSecurityEcrScanningRole`. The `AikidoRoleArn` output holds the ARN to enter in Aikido when connecting the registry. IAM role names are unique per account, so only one stack per account can set `aikido`.
- The external ID belongs to the Aikido workspace. Every account that connects to the same workspace uses the same one. Aikido's connection dialog for an ECR registry includes it in the Terraform file it offers for download.
- The role trusts Aikido's EU container image scanner role. Set `principalArn` for another Aikido region.
- The role pulls images only from `services/*`. It may list and describe the images in every repository, because Aikido does that for all repositories in the registry before applying its scan scope. Limit the scan scope in Aikido to `services/*` so that other repositories, such as the CDK assets repository, do not count against the container limit.
- Each service repository gets the tag `aik:repository=https://github.com/<owner>/<name>`, which links its images to the code repository in Aikido. `owner` defaults to `capralifecycle`.

## Migrating from the shared repository

`ecrRepositoryName` and `ecrRepositoryLifecycleRules` are deprecated. Each step below can be reverted until the last two.

1. Add `serviceRepositories` next to `ecrRepositoryName` and deploy the build account.
2. Push every image to both repositories, with the same tag.
3. Switch each service to `BuildArtifacts.importServiceRepository`. Until the switch has deployed to every environment, keep the task execution role's pull grant on the shared repository, so that a rollback can still pull the old image:

   ```ts
   const sharedRepository = ecr.Repository.fromRepositoryAttributes(this, "SharedRepository", {
     repositoryName: "my-shared-repo",
     repositoryArn: `arn:aws:ecr:eu-west-1:111111111111:repository/my-shared-repo`,
   })
   sharedRepository.grantPull(service.taskDefinition.obtainExecutionRole())
   ```

4. Stop pushing to the shared repository.
5. Remove `ecrRepositoryName` and the extra grants. AWS keeps the shared repository and its images. Delete it once no task definition that may still run references it.
