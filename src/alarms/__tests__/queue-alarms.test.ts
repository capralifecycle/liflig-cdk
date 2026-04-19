import "@aws-cdk/assert/jest"
import * as cdk from "aws-cdk-lib"
import { App, Stack } from "aws-cdk-lib"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as sns from "aws-cdk-lib/aws-sns"
import "jest-cdk-snapshot"
import { QueueAlarms } from "../queue-alarms"

test("queue alarms default setup", () => {
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

  expect(stack).toMatchCdkSnapshot()
})

test("queue alarms custom overrides", () => {
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

  expect(stack).toMatchCdkSnapshot()
})
