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

      // TODO: semantic-release
    }
  }
}
