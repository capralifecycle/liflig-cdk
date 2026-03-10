import "@aws-cdk/assert/jest"
import { App, Stack } from "aws-cdk-lib"
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions"
import * as sns from "aws-cdk-lib/aws-sns"
import "jest-cdk-snapshot"
import { QueueAlarms } from "../queue-alarms"

test("creates messages-not-being-processed composite alarm with defaults", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack")
  const stack = new Stack(app, "Stack")

  const topic = new sns.Topic(supportStack, "Topic")
  const action = new cloudwatchActions.SnsAction(topic)

  const alarms = new QueueAlarms(stack, "QueueAlarms", {
    alarmAction: action,
    warningAction: action,
    queueName: "my-queue",
  })

  alarms.addMessagesNotBeingProcessedAlarm()

  expect(stack).toHaveResource("AWS::CloudWatch::CompositeAlarm")
  expect(stack).toHaveResourceLike("AWS::CloudWatch::Alarm", {
    MetricName: "ApproximateNumberOfMessagesVisible",
    Namespace: "AWS/SQS",
  })
  expect(stack).toHaveResourceLike("AWS::CloudWatch::Alarm", {
    MetricName: "NumberOfMessagesDeleted",
    Namespace: "AWS/SQS",
  })
  expect(stack).toMatchCdkSnapshot()
})

test("creates approximate-age alarm with defaults sent to warnings", () => {
  const app = new App()
  const supportStack = new Stack(app, "SupportStack2")
  const stack = new Stack(app, "Stack2")

  const topic = new sns.Topic(supportStack, "Topic2")
  const action = new cloudwatchActions.SnsAction(topic)

  const alarms = new QueueAlarms(stack, "QueueAlarms2", {
    alarmAction: action,
    warningAction: action,
    queueName: "my-queue-2",
  })

  alarms.addApproximateAgeOfOldestMessageAlarm()

  expect(stack).toHaveResourceLike("AWS::CloudWatch::Alarm", {
    MetricName: "ApproximateAgeOfOldestMessage",
    Namespace: "AWS/SQS",
  })

  expect(stack).toMatchCdkSnapshot()
})
