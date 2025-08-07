import {
  CreateConfigurationSetEventDestinationCommand,
  DeleteConfigurationSetEventDestinationCommand,
  type EventDestinationDefinition,
  type EventType,
  SESv2Client,
  UpdateConfigurationSetEventDestinationCommand,
} from "@aws-sdk/client-sesv2"

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

export const handler: OnEventHandler = async (event) => {
  const sesv2Client = new SESv2Client()
  const configurationSetName = event.ResourceProperties.ConfigurationSetName
  const eventDestinationName = event.ResourceProperties.EventDestinationName
  const snsTopicArn = event.ResourceProperties.SnsTopicArn
  const matchingEventTypes = event.ResourceProperties.MatchingEventTypes.map(
    (eventType) => eventType as EventType,
  )

  const eventDestination: EventDestinationDefinition = {
    MatchingEventTypes: matchingEventTypes,
    Enabled: true,
    SnsDestination: {
      TopicArn: snsTopicArn,
    },
  }

  console.log(`EventDestination ${JSON.stringify(eventDestination)}`)

  switch (event.RequestType) {
    case "Delete": {
      const deleteResponse = await sesv2Client.send(
        new DeleteConfigurationSetEventDestinationCommand({
          ConfigurationSetName: configurationSetName,
          EventDestinationName: eventDestinationName,
        }),
      )
      console.log(
        `ses.deleteConfigurationSetEventDestination: ${JSON.stringify(
          deleteResponse,
        )}`,
      )

      return {
        PhysicalResourceId: event.PhysicalResourceId,
      }
    }

    case "Create": {
      const createResponse = await sesv2Client.send(
        new CreateConfigurationSetEventDestinationCommand({
          ConfigurationSetName: configurationSetName,
          EventDestinationName: eventDestinationName,
          EventDestination: eventDestination,
        }),
      )
      console.log(
        `ses.createConfigurationSetEventDestination: ${JSON.stringify(
          createResponse,
        )}`,
      )
      return {
        PhysicalResourceId: `ConfigurationSetSnsDestination-${configurationSetName}-${eventDestinationName}`,
      }
    }

    case "Update": {
      const previousEventDestinationName =
        event.OldResourceProperties!.EventDestinationName
      const previousConfigurationSetName =
        event.OldResourceProperties!.ConfigurationSetName

      if (
        configurationSetName !== previousConfigurationSetName ||
        eventDestinationName !== previousEventDestinationName
      ) {
        const createResponse = await sesv2Client.send(
          new CreateConfigurationSetEventDestinationCommand({
            ConfigurationSetName: configurationSetName,
            EventDestinationName: eventDestinationName,
            EventDestination: eventDestination,
          }),
        )
        console.log(
          `ses.createConfigurationSetEventDestination: ${JSON.stringify(
            createResponse,
          )}`,
        )
      } else {
        const updateResponse = await sesv2Client.send(
          new UpdateConfigurationSetEventDestinationCommand({
            ConfigurationSetName: configurationSetName,
            EventDestinationName: eventDestinationName,
            EventDestination: eventDestination,
          }),
        )
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
}
