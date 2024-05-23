/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-var-requires */

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
  const {
    SESv2Client,
    CreateConfigurationSetEventDestinationCommand,
    UpdateConfigurationSetEventDestinationCommand,
    DeleteConfigurationSetEventDestinationCommand,
  } = await import("@aws-sdk/client-sesv2")
  const sesv2Client = new SESv2Client()

  type EventDestinationDefinition =
    import("@aws-sdk/client-sesv2").EventDestinationDefinition
  type EventType = import("@aws-sdk/client-sesv2").EventType

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
    case "Delete":
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

    case "Create":
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

    case "Update":
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
