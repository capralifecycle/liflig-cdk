#!/usr/bin/env groovy

// See https://github.com/capralifecycle/jenkins-pipeline-library
@Library('cals') _

buildConfig([
  slack: [
    channel: '#cals-dev-info',
    teamDomain: 'cals-capra',
  ],
]) {
  dockerNode {
    checkout scm

    insideToolImage("node:18") {
      stage('Install dependencies and build') {
        sh 'npm ci'
      }

      stage('Lint and test') {
        sh 'npm run lint'
        sh 'npm run test'
      }

      stage('Verify CDK snapshots') {
        sh '''
          npm run snapshots
          git status
          git diff --exit-code
        '''
      }

      // We only run semantic-release on the release branches,
      // as we do not want credentials to be exposed to the job
      // on other branches or in PRs.
      if (env.BRANCH_NAME ==~ /^(master|\d+\.(\d+|x)(\.x)?)$/) {
        stage('Semantic release') {
          withSemanticReleaseEnv {
            sh 'npm run semantic-release'
          }
        }
      }
    }
  }
}
