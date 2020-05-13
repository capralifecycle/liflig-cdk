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

    insideToolImage("node:12-alpine") {
      stage('Install dependencies') {
        sh 'npm ci'
      }

      stage('Lint') {
        sh 'npm run lint'
      }

      stage('Build') {
        sh 'npm run build'
      }

      stage('Verify CDK snapshots') {
        sh '''
          make snapshots
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
