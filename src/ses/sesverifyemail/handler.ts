/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-var-requires */

type OnEventHandler = (event: {
  PhysicalResourceId?: string
  RequestType: "Create" | "Update" | "Delete"
  ResourceProperties: Record<string, string>
}) => Promise<{
  PhysicalResourceId?: string
}>

// This function is inline-compiled for the lambda.
// It must be self-contained.
export const sesVerifyEmailHandler: OnEventHandler = async (event) => {
  const { SESClient, DeleteIdentityCommand, VerifyEmailIdentityCommand } =
    await import("@aws-sdk/client-ses")

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
