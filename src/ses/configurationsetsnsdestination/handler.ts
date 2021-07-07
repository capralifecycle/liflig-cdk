/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-var-requires */
import type * as _AWS from "aws-sdk"

interface ResourceProps {
  ConfigurationSetName: string
  EventDestinationName: string
  SnsTopicArn: string
  MatchingEventTypes: string[]
}

type OnEventHandler = (event: {
  PhysicalResourceId?: string
  RequestType: "Create" | "Update" | "Delete"
  ResourceProperties: ResourceProps
  OldResourceProperties?: ResourceProps
}) => Promise<{
  PhysicalResourceId?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Data?: Record<string, any>
}>

// This function is inline-compiled for the lambda.
// It must be self-contained.
export const configurationSetSnsDestinationHandler: OnEventHandler = async (
  event,
) => {
  const AWS = require("aws-sdk")

  const ses: AWS.SESV2 = new AWS.SESV2() as _AWS.SESV2

  const configurationSetName = event.ResourceProperties.ConfigurationSetName
  const eventDestinationName = event.ResourceProperties.EventDestinationName
  const snsTopicArn = event.ResourceProperties.SnsTopicArn
  const matchingEventTypes = event.ResourceProperties.MatchingEventTypes

  const eventDestination: _AWS.SESV2.Types.EventDestinationDefinition = {
    MatchingEventTypes: matchingEventTypes,
    Enabled: true,
    SnsDestination: {
      TopicArn: snsTopicArn,
    },
  }

  console.log(`EventDestination ${JSON.stringify(eventDestination)}`)

  switch (event.RequestType) {
    case "Delete":
      const deleteResponse = await ses
        .deleteConfigurationSetEventDestination({
          ConfigurationSetName: configurationSetName,
          EventDestinationName: eventDestinationName,
        })
        .promise()
      console.log(
        `ses.deleteConfigurationSetEventDestination: ${JSON.stringify(
          deleteResponse,
        )}`,
      )

      return {
        PhysicalResourceId: event.PhysicalResourceId,
      }

    case "Create":
      const createResponse = await ses
        .createConfigurationSetEventDestination({
          ConfigurationSetName: configurationSetName,
          EventDestinationName: eventDestinationName,
          EventDestination: eventDestination,
        })
        .promise()
      console.log(
        `ses.createConfigurationSetEventDestination: ${JSON.stringify(
          createResponse,
        )}`,
      )
      return {
        PhysicalResourceId: `ConfigurationSetSnsDestination-${configurationSetName}-${eventDestinationName}`,
      }

    case "Update":
      const previousEventDestinationName =
        event.OldResourceProperties!.EventDestinationName
      const previousConfigurationSetName =
        event.OldResourceProperties!.ConfigurationSetName

      if (
        configurationSetName !== previousConfigurationSetName ||
        eventDestinationName !== previousEventDestinationName
      ) {
        const createResponse = await ses
          .createConfigurationSetEventDestination({
            ConfigurationSetName: configurationSetName,
            EventDestinationName: eventDestinationName,
            EventDestination: eventDestination,
          })
          .promise()
        console.log(
          `ses.createConfigurationSetEventDestination: ${JSON.stringify(
            createResponse,
          )}`,
        )
      } else {
        const updateResponse = await ses
          .updateConfigurationSetEventDestination({
            ConfigurationSetName: configurationSetName,
            EventDestinationName: eventDestinationName,
            EventDestination: eventDestination,
          })
          .promise()
        console.log(
          `ses.UpdateConfigurationSetEventDestination: ${JSON.stringify(
            updateResponse,
          )}`,
        )
      }

      return {
        PhysicalResourceId: `ConfigurationSetSnsDestination-${configurationSetName}-${eventDestinationName}`,
      }
  }
}
