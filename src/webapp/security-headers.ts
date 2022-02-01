import * as constructs from "constructs"
import * as cloudfront from "aws-cdk-lib/aws-cloudfront"

export interface FrameOptionsHeader {
  value?: "DENY" | "SAMEORIGIN"
}

export interface ReferrerPolicyHeader {
  value?: string
}

export interface StrictTransportSecurityHeader {
  maxAge?: number
  includeSubDomains?: boolean
  preload?: boolean
}

export interface ContentSecurityPolicyHeader {
  reportOnly?: boolean
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

export interface SecurityHeaders {
  contentSecurityPolicy?: ContentSecurityPolicyHeader
  strictTransportSecurity?: StrictTransportSecurityHeader
  referrerPolicy?: ReferrerPolicyHeader
  frameOptions?: FrameOptionsHeader
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

function generateContentSecurityPolicyHeader(
  headerOptions?: ContentSecurityPolicyHeader,
) {
  const defaultValues = {
    baseUri: "'self'",
    childSrc: "'none'",
    connectSrc: "'self'",
    defaultSrc: "'self'",
    fontSrc: "'self'",
    formAction: "'self'",
    frameAncestors: "'none'",
    frameSrc: "'self'",
    imgSrc: "'self'",
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
  headerValue += `img-src ${trim(options.imgSrc)};`
  headerValue += `manifest-src ${trim(options.manifestSrc)};`
  headerValue += `media-src ${trim(options.mediaSrc)};`
  headerValue += `object-src ${trim(options.objectSrc)};`
  headerValue += `script-src ${trim(options.scriptSrc)};`
  headerValue += `style-src ${trim(options.styleSrc)};`

  return trim(headerValue)
}

function generateStrictTransportSecurityHeader(
  headerOptions?: StrictTransportSecurityHeader,
) {
  const defaultValues = {
    maxAge: 63072000,
    includeSubDomains: false,
    preload: false,
  }
  const options = {
    ...defaultValues,
    ...headerOptions,
  }
  let headerValue = ""
  headerValue += `max-age=${options.maxAge};`
  headerValue += options.preload ? "preload;" : ""
  headerValue += options.includeSubDomains ? "includeSubDomains;" : ""
  return trim(headerValue)
}

function generateReferrerPolicyHeader(headerOptions?: ReferrerPolicyHeader) {
  const defaultValues = {
    value: "strict-origin-when-cross-origin",
  }
  const options = {
    ...defaultValues,
    ...headerOptions,
  }
  return options.value
}

function generateFrameOptionsHeader(headerOptions?: FrameOptionsHeader) {
  const defaultValues = {
    value: "DENY",
  }
  const options = {
    ...defaultValues,
    ...headerOptions,
  }
  return trim(options.value)
}

export class WebappSecurityHeaders extends constructs.Construct {
  public readonly securityHeadersFunction: cloudfront.Function

  constructor(scope: constructs.Construct, id: string, props: SecurityHeaders) {
    super(scope, id)

    const cspHeaderName = props.contentSecurityPolicy?.reportOnly
      ? "content-security-policy-report-only"
      : "content-security-policy"

    const contentSecurityPolicy = generateContentSecurityPolicyHeader(
      props.contentSecurityPolicy,
    )
    const strictTransportSecurity = generateStrictTransportSecurityHeader(
      props.strictTransportSecurity,
    )
    const referrerPolicy = generateReferrerPolicyHeader(props.referrerPolicy)
    const frameOptions = generateFrameOptionsHeader(props.frameOptions)

    const lambdaCode = `function handler(event) {
      var response = event.response;
      var headers = response.headers;
      headers['referrer-policy'] = {value: '${referrerPolicy}'};
      headers['strict-transport-security'] = {value: '${strictTransportSecurity}'};
      headers['x-content-type-options'] = {value: 'nosniff'};
      headers['x-frame-options'] = {value: '${frameOptions}'};
      headers['x-xss-protection'] = {value: '1; mode=block'};
      headers['${cspHeaderName}'] = {value: "${contentSecurityPolicy}"};
      return response;
    }`

    // Hardcoded logical ID due to bug: https://github.com/aws/aws-cdk/issues/15523
    const functionId = `Function${this.node.addr}`

    this.securityHeadersFunction = new cloudfront.Function(this, functionId, {
      functionName: functionId,
      code: cloudfront.FunctionCode.fromInline(lambdaCode),
    })
  }
}
