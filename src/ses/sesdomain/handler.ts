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
  const {
    SESClient,
    VerifyDomainIdentityCommand,
    VerifyDomainDkimCommand,
    DeleteIdentityCommand,
  } = await import("@aws-sdk/client-ses")
  const { SESv2Client, PutEmailIdentityConfigurationSetAttributesCommand } =
    await import("@aws-sdk/client-sesv2")

  const sesClient = new SESClient({})
  const sesv2Client = new SESv2Client({})

  const ttl = "1800"

  const domainName = event.ResourceProperties["DomainName"]
  const includeVerificationRecord =
    event.ResourceProperties["IncludeVerificationRecord"] == "true"

  const defaultConfigurationSetName =
    event.ResourceProperties["DefaultConfigurationSetName"]

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
    return records
  }

  switch (event.RequestType) {
    case "Delete":
      const deleteIdentityResp = await sesClient.send(
        new DeleteIdentityCommand({
          Identity: domainName,
        }),
      )
      console.log(`ses.deleteIdentity: ${JSON.stringify(deleteIdentityResp)}`)

      return {
        PhysicalResourceId: event.PhysicalResourceId,
      }

    case "Create":
    case "Update":
      // Idempotent.
      const verifyDomainIdentityResp = await sesClient.send(
        new VerifyDomainIdentityCommand({
          Domain: domainName,
        }),
      )
      console.log(
        `ses.verifyDomainIdentity: ${JSON.stringify(verifyDomainIdentityResp)}`,
      )
      const verificationToken = verifyDomainIdentityResp.VerificationToken
      if (!verificationToken) {
        throw new Error("Verification token not returned")
      }

      // Idempotent.
      const verifyDomainDkimResp = await sesClient.send(
        new VerifyDomainDkimCommand({
          Domain: domainName,
        }),
      )
      console.log(
        `ses.verifyDomainDkim: ${JSON.stringify(verifyDomainDkimResp)}`,
      )
      const dkimTokens = verifyDomainDkimResp.DkimTokens ?? []
      if (!dkimTokens) {
        throw new Error("DKIM tokens not returned")
      }

      // Idempotent.
      const putEmailIdentityConfigResp = await sesv2Client.send(
        new PutEmailIdentityConfigurationSetAttributesCommand({
          EmailIdentity: domainName,
          ConfigurationSetName: defaultConfigurationSetName,
        }),
      )
      console.log(
        `sesv2.putEmailIdentityConfigurationSetAttributes ${JSON.stringify(
          putEmailIdentityConfigResp,
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
