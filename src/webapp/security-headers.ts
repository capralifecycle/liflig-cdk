import * as cdk from "aws-cdk-lib"
import * as cloudfront from "aws-cdk-lib/aws-cloudfront"
import * as constructs from "constructs"

export type WebappSecurityHeadersProps = Partial<
  cloudfront.ResponseSecurityHeadersBehavior & {
    contentSecurityPolicy?: cloudfront.ResponseSecurityHeadersBehavior["contentSecurityPolicy"] & {
      /**
       * Whether to only monitor the effects of the content security policy without actually blocking anything.
       * @default false
       */
      reportOnly?: boolean
    }
  }
>

export interface ContentSecurityPolicyHeader {
  baseUri?: string
  childSrc?: string
  defaultSrc?: string
  fontSrc?: string
  frameSrc?: string
  formAction?: string
  frameAncestors?: string
  imgSrc?: string
  manifestSrc?: string
  mediaSrc?: string
  objectSrc?: string
  scriptSrc?: string
  styleSrc?: string
  connectSrc?: string
}

function validateCspParam(param: string): string {
  if (param.indexOf('"') !== -1) {
    throw Error('CSP override contains invalid character "')
  }

  if (param.indexOf(";") !== -1) {
    throw Error("CSP override contains invalid character ;")
  }

  if (param.indexOf("\\") !== -1) {
    throw Error("CSP override contains invalid character \\")
  }

  return param
}

/* Replace all whitespace in a string with a single space */
function trim(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

/**
 * Helper function that generates a string containing a Content Security Policy that can be
 * used in a security header.
 *
 * NOTE: The string can be further extended using string concatenation for directives that aren't currently supported by the function.
 */
export function generateContentSecurityPolicyHeader(
  headerOptions?: ContentSecurityPolicyHeader,
) {
  const defaultValues = {
    baseUri: "'self'",
    childSrc: "'self'",
    connectSrc: "'self' https:",
    defaultSrc: "'none'",
    fontSrc: "'self'",
    formAction: "'none'",
    frameAncestors: "'none'",
    frameSrc: "'self'",
    imgSrc: "'self' data:",
    manifestSrc: "'self'",
    mediaSrc: "'self'",
    objectSrc: "'none'",
    scriptSrc: "'self'",
    styleSrc: "'self'",
  }

  const options = {
    ...defaultValues,
    ...headerOptions,
  }

  // biome-ignore lint/suspicious/useIterableCallbackReturn: ignore newly added rule
  Object.values(options).forEach(
    (v) => typeof v === "string" && validateCspParam(v),
  )

  let headerValue = ""
  headerValue += `base-uri ${trim(options.baseUri)};`
  headerValue += `child-src ${trim(options.childSrc)};`
  headerValue += `connect-src ${trim(options.connectSrc)};`
  headerValue += `default-src ${trim(options.defaultSrc)};`
  headerValue += `font-src ${trim(options.fontSrc)};`
  headerValue += `frame-src ${trim(options.frameSrc)};`
  headerValue += `form-action ${trim(options.formAction)};`
  headerValue += `frame-ancestors ${trim(options.frameAncestors)};`
  headerValue += `img-src ${trim(options.imgSrc)};`
  headerValue += `manifest-src ${trim(options.manifestSrc)};`
  headerValue += `media-src ${trim(options.mediaSrc)};`
  headerValue += `object-src ${trim(options.objectSrc)};`
  headerValue += `script-src ${trim(options.scriptSrc)};`
  headerValue += `style-src ${trim(options.styleSrc)}`

  return trim(headerValue)
}
export class WebappSecurityHeaders extends constructs.Construct {
  public readonly responseHeadersPolicy: cloudfront.ResponseHeadersPolicy

  constructor(
    scope: constructs.Construct,
    id: string,
    props: WebappSecurityHeadersProps,
  ) {
    super(scope, id)

    const {
      contentSecurityPolicy: contentSecurityPolicyOverride,
      ...overrides
    } = props

    const contentSecurityPolicyCustomHeader = contentSecurityPolicyOverride || {
      reportOnly: false,
      contentSecurityPolicy: generateContentSecurityPolicyHeader(),
      override: true,
    }

    const defaultValues: Omit<
      cloudfront.ResponseSecurityHeadersBehavior,
      "contentSecurityPolicy"
    > = {
      contentTypeOptions: {
        override: true,
      },
      referrerPolicy: {
        override: true,
        referrerPolicy: cloudfront.HeadersReferrerPolicy.SAME_ORIGIN,
      },
      frameOptions: {
        frameOption: cloudfront.HeadersFrameOption.DENY,
        override: true,
      },
      strictTransportSecurity: {
        override: true,
        accessControlMaxAge: cdk.Duration.days(182.5),
        includeSubdomains: false,
        preload: false,
      },
      xssProtection: {
        override: true,
        protection: true,
        modeBlock: true,
      },
    }

    this.responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      "ResponseHeadersPolicy",
      {
        securityHeadersBehavior: {
          ...defaultValues,
          ...overrides,
          ...(!contentSecurityPolicyCustomHeader.reportOnly && {
            contentSecurityPolicy: {
              contentSecurityPolicy:
                contentSecurityPolicyCustomHeader.contentSecurityPolicy,
              override: contentSecurityPolicyCustomHeader.override,
            },
          }),
        },
        ...(contentSecurityPolicyCustomHeader.reportOnly && {
          customHeadersBehavior: {
            // Report only is not supported by securityHeadersBehavior in AWS and must be defined as custom header
            customHeaders: [
              {
                header: "Content-Security-Policy-Report-Only",
                value: contentSecurityPolicyCustomHeader.contentSecurityPolicy,
                override: contentSecurityPolicyCustomHeader.override,
              },
            ],
          },
        }),
      },
    )
  }
}
