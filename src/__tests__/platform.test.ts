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
  alarmTopic: sns.Topic
}

const alarmTopicArn = "alarm-topic-arn"

class ExamplePlatformProducer extends PlatformProducer {
  constructor(scope: Construct, id: string, props: ProducerProps) {
    super(scope, id, props)
    this.putParam(alarmTopicArn, props.alarmTopic.topicArn)
  }
}

class ExamplePlatformConsumer extends PlatformConsumer {
  constructor(scope: Construct, id: string, props: PlatformConsumerProps) {
    super(scope, id, props)
  }

  public get alarmTopic(): sns.ITopic {
    return this._alarmTopic()
  }
  private _alarmTopic = this.lazy(() =>
    sns.Topic.fromTopicArn(this, "TopicArn", this.getParam(alarmTopicArn)),
  )
}

test("produce example plaform", () => {
  const app = new App()
  const stack = new Stack(app, "ProducerStack")

  const alarmTopic = new sns.Topic(stack, "Topic", {
    topicName: "alarmtopic",
    displayName: "Alarm topic",
  })

  new ExamplePlatformProducer(stack, "PlatformProducer", {
    platformNamespace: "test",
    platformName: "test",
    alarmTopic: alarmTopic,
  })

  expect(stack).toMatchCdkSnapshot()
})

test("consume example platform", () => {
  const app = new App()
  const stack = new Stack(app, "ConsumerStack")

  const platform = new ExamplePlatformConsumer(stack, "PlatformConsumer", {
    platformNamespace: "test",
    platformName: "test",
  })

  // only here to get the value of topicArn, somehow
  new ssm.StringParameter(stack, "ExampleParam", {
    stringValue: platform.alarmTopic.topicArn,
  })

  expect(stack).toMatchCdkSnapshot()
})
