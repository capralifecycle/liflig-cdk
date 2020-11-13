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

  const dmarc = '"v=DMARC1; p=none; pct=100; sp=none; aspf=r;"'
  const ttl = "1800"

  const ses: AWS.SES = new AWS.SES() as _AWS.SES

  const domainName = event.ResourceProperties["DomainName"]

  function createRoute53RecordSets(
    verificationToken: string,
    dkimTokens: string[],
  ) {
    const records: RecordSetProperty[] = []

    records.push({
      Name: `_amazonses.${domainName}.`,
      Type: "TXT",
      ResourceRecords: [`"${verificationToken}"`],
      TTL: ttl,
    })

    for (const token of dkimTokens) {
      records.push({
        Name: `${token}._domainkey.${domainName}.`,
        Type: "CNAME",
        ResourceRecords: [`${token}.dkim.amazonses.com.`],
        TTL: ttl,
      })
    }

    records.push({
      Name: `_dmarc.${domainName}.`,
      Type: "TXT",
      ResourceRecords: [dmarc],
      TTL: ttl,
    })

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
      const response1 = await ses
        .verifyDomainIdentity({
          Domain: domainName,
        })
        .promise()

      console.log(`ses.verifyDomainIdentity: ${JSON.stringify(response1)}`)
      const verificationToken = response1["VerificationToken"]

      const response2 = await ses
        .verifyDomainDkim({ Domain: domainName })
        .promise()
      console.log(`ses.verifyDomainDkim: ${JSON.stringify(response2)}`)
      const dkimTokens = response2["DkimTokens"]

      return {
        PhysicalResourceId: `SesDomain${domainName}`,
        Data: {
          Route53RecordSets: createRoute53RecordSets(
            verificationToken,
            dkimTokens,
          ),
        },
      }
  }
}
