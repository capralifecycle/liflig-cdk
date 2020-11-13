/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-var-requires */
import type * as _AWS from "aws-sdk"

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
  const AWS = require("aws-sdk")

  const ses: AWS.SES = new AWS.SES() as _AWS.SES

  const emailAddress = event.ResourceProperties["EmailAddress"]

  switch (event.RequestType) {
    case "Delete":
      await ses.deleteIdentity({ Identity: emailAddress }).promise()

      return {
        PhysicalResourceId: event.PhysicalResourceId,
      }

    case "Create":
    case "Update":
      await ses.verifyEmailIdentity({ EmailAddress: emailAddress }).promise()

      return {
        PhysicalResourceId: `SesVerifyEmail:${emailAddress}`,
      }
  }
}
