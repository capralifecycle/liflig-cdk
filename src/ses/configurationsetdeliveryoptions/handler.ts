/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-var-requires */
import type * as _AWS from "aws-sdk"

interface ResourceProps {
  ConfigurationSetName: string
  TlsPolicy?: string
  SendingPoolName?: string
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
export const configurationSetDeliveryOptionsHandler: OnEventHandler = async (
  event,
) => {
  const AWS = require("aws-sdk")

  const ses: AWS.SESV2 = new AWS.SESV2() as _AWS.SESV2

  const configurationSetName = event.ResourceProperties.ConfigurationSetName
  const tlsPolicy = event.ResourceProperties.TlsPolicy
  const sendingPoolName = event.ResourceProperties.SendingPoolName

  switch (event.RequestType) {
    case "Delete":
      const clearConfigurationSetDeliveryOptionsResponse = await ses
        .putConfigurationSetDeliveryOptions({
          ConfigurationSetName: configurationSetName,
          TlsPolicy: undefined,
          SendingPoolName: undefined,
        })
        .promise()
      console.log(
        `ses.putConfigurationSetDeliveryOptions: ${JSON.stringify(
          clearConfigurationSetDeliveryOptionsResponse,
        )}`,
      )

      return {
        PhysicalResourceId: event.PhysicalResourceId,
      }

    case "Create":
    case "Update":
      const putConfigurationSetDeliveryOptionsResponse = await ses
        .putConfigurationSetDeliveryOptions({
          ConfigurationSetName: configurationSetName,
          TlsPolicy: tlsPolicy,
          SendingPoolName: sendingPoolName,
        })
        .promise()
      console.log(
        `ses.putConfigurationSetDeliveryOptions: ${JSON.stringify(
          putConfigurationSetDeliveryOptionsResponse,
        )}`,
      )

      return {
        PhysicalResourceId: `ConfigurationSetSnsDestination-${configurationSetName}`,
      }
  }
}
