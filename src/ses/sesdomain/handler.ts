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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Data?: Record<string, any>
}>

// Type to mach CloudFormation AWS::Route53::RecordSetGroup RecordSet
interface RecordSetProperty {
  Name: string
  Type: string
  ResourceRecords: string[]
  TTL: string
}

// This function is inline-compiled for the lambda.
// It must be self-contained.
export const sesDomainHandler: OnEventHandler = async (event) => {
  const AWS = require("aws-sdk")

  const ttl = "1800"

  const ses: AWS.SES = new AWS.SES() as _AWS.SES
  const sesv2: AWS.SESV2 = new AWS.SESV2() as _AWS.SESV2

  const domainName = event.ResourceProperties["DomainName"]
  const includeVerificationRecord =
    event.ResourceProperties["IncludeVerificationRecord"] == "true"

  const defaultConfigurationSetName =
    event.ResourceProperties["DefaultConfigurationSetName"]

  const spfRecordValue = event.ResourceProperties["SpfRecordValue"]

  if (!includeVerificationRecord) {
    console.log("Excluding verification TXT record")
  }

  function createRoute53RecordSets(
    verificationToken: string,
    dkimTokens: string[],
  ) {
    const records: RecordSetProperty[] = []

    if (includeVerificationRecord) {
      records.push({
        Name: `_amazonses.${domainName}.`,
        Type: "TXT",
        ResourceRecords: [`"${verificationToken}"`],
        TTL: ttl,
      })
    }

    for (const token of dkimTokens) {
      records.push({
        Name: `${token}._domainkey.${domainName}.`,
        Type: "CNAME",
        ResourceRecords: [`${token}.dkim.amazonses.com.`],
        TTL: ttl,
      })
    }

    if (spfRecordValue) {
      records.push({
        Name: domainName,
        Type: "TXT",
        ResourceRecords: [spfRecordValue],
        TTL: ttl,
      })
    }
    return records
  }

  switch (event.RequestType) {
    case "Delete":
      const response = await ses
        .deleteIdentity({ Identity: domainName })
        .promise()
      console.log(`ses.deleteIdentity: ${JSON.stringify(response)}`)

      return {
        PhysicalResourceId: event.PhysicalResourceId,
      }

    case "Create":
    case "Update":
      // Idempotent.
      const response1 = await ses
        .verifyDomainIdentity({
          Domain: domainName,
        })
        .promise()

      console.log(`ses.verifyDomainIdentity: ${JSON.stringify(response1)}`)
      const verificationToken = response1["VerificationToken"]

      // Idempotent.
      const response2 = await ses
        .verifyDomainDkim({ Domain: domainName })
        .promise()
      console.log(`ses.verifyDomainDkim: ${JSON.stringify(response2)}`)
      const dkimTokens = response2["DkimTokens"]

      // Idempotent.
      const response3 = await sesv2
        .putEmailIdentityConfigurationSetAttributes({
          EmailIdentity: domainName,
          // ConfigurationSetName can be set to undefined to remove
          // the default configuration set from the identity.
          ConfigurationSetName: defaultConfigurationSetName,
        })
        .promise()
      console.log(
        `sesv2.putEmailIdentityConfigurationSetAttributes ${JSON.stringify(
          response3,
        )}`,
      )

      return {
        PhysicalResourceId: `SesDomain${domainName}`,
        Data: {
          Route53RecordSets: createRoute53RecordSets(
            verificationToken,
            dkimTokens,
          ),
          VerificationToken: verificationToken,
        },
      }
  }
}
