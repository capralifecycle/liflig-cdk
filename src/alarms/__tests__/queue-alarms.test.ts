import { test } from "node:test"
import { cdkTemplate, configureCdkSnapshots } from "@liflig/cdk-snapshot/node"
import * as cdk from "aws-cdk-lib"
import { App, Stack } from "aws-cdk-lib"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as sns from "aws-cdk-lib/aws-sns"
import { QueueAlarms } from "../queue-alarms"

configureCdkSnapshots()

test("queue alarms default setup", (t) => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack")
  const stack = new Stack(app, "Stack")

  const topic = new sns.Topic(supportStack, "Topic")
  const alarmAction = new cloudwatchActions.SnsAction(topic)

  const alarms = new QueueAlarms(stack, "QueueAlarms", {
    queueName: "my-queue",
    alarmAction: alarmAction,
    warningAction: alarmAction,
  })

  alarms.addMessagesNotBeingProcessedAlarm()
  alarms.addApproximateAgeOfOldestMessageAlarm()
  alarms.addTooManyMessagesExistAlarm({ messageAmountLimit: 1 })

  t.assert.snapshot(cdkTemplate(stack))
})

test("queue alarms custom overrides", (t) => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack")
  const stack = new Stack(app, "Stack")

  const topic = new sns.Topic(supportStack, "Topic")
  const alarmAction = new cloudwatchActions.SnsAction(topic)
  const warningAction = new cloudwatchActions.SnsAction(topic)

  const alarms = new QueueAlarms(stack, "QueueAlarms", {
    queueName: "my-queue",
    alarmAction: alarmAction,
    warningAction: warningAction,
  })

  alarms.addMessagesNotBeingProcessedAlarm({
    period: cdk.Duration.seconds(60),
    evaluationPeriodsMessagesVisible: 1,
    thresholdMessagesVisible: 1,
    evaluationPeriodsMessagesDeleted: 1,
    thresholdMessagesDeleted: 0,
  })

  alarms.addApproximateAgeOfOldestMessageAlarm({
    period: cdk.Duration.seconds(60),
    evaluationPeriods: 1,
    thresholdSeconds: 60,
  })

  alarms.addTooManyMessagesExistAlarm({
    messageAmountLimit: 500,
    period: cdk.Duration.seconds(120),
    evaluationPeriods: 2,
    enableOkAlarm: false,
    alarmDescription: "Custom alarm for too many messages",
  })

  t.assert.snapshot(cdkTemplate(stack))
})
