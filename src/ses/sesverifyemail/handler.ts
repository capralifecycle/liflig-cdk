import {
  DeleteIdentityCommand,
  SESClient,
  VerifyEmailIdentityCommand,
} from "@aws-sdk/client-ses"

type OnEventHandler = (event: {
  PhysicalResourceId?: string
  RequestType: "Create" | "Update" | "Delete"
  ResourceProperties: Record<string, string>
}) => Promise<{
  PhysicalResourceId?: string
}>

export const handler: OnEventHandler = async (event) => {
  const sesClient = new SESClient()
  const emailAddress = event.ResourceProperties["EmailAddress"]

  switch (event.RequestType) {
    case "Delete":
      await sesClient.send(
        new DeleteIdentityCommand({
          Identity: emailAddress,
        }),
      )

      return {
        PhysicalResourceId: event.PhysicalResourceId,
      }

    case "Create":
    case "Update":
      await sesClient.send(
        new VerifyEmailIdentityCommand({
          EmailAddress: emailAddress,
        }),
      )

      return {
        PhysicalResourceId: `SesVerifyEmail:${emailAddress}`,
      }
  }
}
