import "@aws-cdk/assert/jest"
import { App, Stack, Construct } from "@aws-cdk/core"
import * as sns from "@aws-cdk/aws-sns"
import * as ssm from "@aws-cdk/aws-ssm"
import "jest-cdk-snapshot"
import {
  PlatformProducer,
  PlatformConsumer,
  PlatformConsumerProps,
  PlatformProducerProps,
} from "../platform"

interface ProducerProps extends PlatformProducerProps {
  platformName: string
  paramNamespace: string
  alarmTopic: sns.Topic
}

const alarmTopicArn = "alarm-topic-arn"

class ExamplePlatformProducer extends PlatformProducer {
  constructor(scope: Construct, id: string, props: ProducerProps) {
    super(scope, id, props)
    this.putParam(alarmTopicArn, props.alarmTopic.topicArn)
  }
}

interface ConsumerProps extends PlatformConsumerProps {
  platformName: string
  paramNamespace: string
}

class ExamplePlatformConsumer extends PlatformConsumer {
  constructor(scope: Construct, id: string, props: ConsumerProps) {
    super(scope, id, props)
  }

  public get alarmTopic(): sns.ITopic {
    return this._alarmTopic()
  }
  private _alarmTopic = this.lazy(() =>
    sns.Topic.fromTopicArn(this, "TopicArn", this.getParam(alarmTopicArn)),
  )
}

test("create platform producer and consumer", () => {
  const app = new App()
  const stack1 = new Stack(app, "Stack1")
  const stack2 = new Stack(app, "Stack2")

  const alarmTopic = new sns.Topic(stack1, "Topic", {
    topicName: "alarmtopic",
    displayName: "Alarm topic",
  })

  new ExamplePlatformProducer(stack1, "PlatformProducer", {
    platformName: "test",
    paramNamespace: "test",
    alarmTopic: alarmTopic,
  })

  const platform = new ExamplePlatformConsumer(stack2, "PlatformConsumer", {
    platformName: "test",
    paramNamespace: "test",
  })

  // only here to get the value of topicArn, somehow
  new ssm.StringParameter(stack2, "ExampleParam", {
    stringValue: platform.alarmTopic.topicArn,
  })

  expect(stack1).toMatchCdkSnapshot()
  expect(stack2).toMatchCdkSnapshot()
})
