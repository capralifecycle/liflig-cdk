import * as cloudfront from "@aws-cdk/aws-cloudfront"
import * as cdk from "@aws-cdk/core"

import { WebappCspOverrides } from "./webapp"

export interface WebappSecurityHeadersProps {
  cspOverrides?: WebappCspOverrides
}

function validateCspParam(param: string): string {
  if (param.indexOf('"') !== -1) {
    throw Error('CSP override contains invalid character "')
  }

  if (param.indexOf(";") !== -1) {
    throw Error("CSP override contains invalid character ;")
  }

  return param
}

function generateCsp(cspOverrides?: WebappCspOverrides) {
  const defaults = {
    baseUri: "'self'",
    defaultSrc: "'self'",
    fontSrc: "'self'",
    frameSrc: "'self'",
    imgSrc: "'self'",
    manifestSrc: "'self'",
    mediaSrc: "'self'",
    objectSrc: "'none'",
    scriptSrc: "'self'",
    styleSrc: "'self'",
    connectSrc: "'self'",
  }

  const baseUri = validateCspParam(
    cspOverrides?.overrideBaseUri || defaults.baseUri,
  )
  const defaultSrc = validateCspParam(
    cspOverrides?.overrideDefaultSrc || defaults.defaultSrc,
  )
  const fontSrc = validateCspParam(
    cspOverrides?.overrideFontSrc || defaults.fontSrc,
  )
  const frameSrc = validateCspParam(
    cspOverrides?.overrideFrameSrc || defaults.frameSrc,
  )
  const imgSrc = validateCspParam(
    cspOverrides?.overrideImgSrc || defaults.imgSrc,
  )
  const manifestSrc = validateCspParam(
    cspOverrides?.overrideManifestSrc || defaults.manifestSrc,
  )
  const mediaSrc = validateCspParam(
    cspOverrides?.overrideMediaSrc || defaults.mediaSrc,
  )
  const objectSrc = validateCspParam(
    cspOverrides?.overrideObjectSrc || defaults.objectSrc,
  )
  const scriptSrc = validateCspParam(
    cspOverrides?.overrideScriptSrc || defaults.scriptSrc,
  )
  const styleSrc = validateCspParam(
    cspOverrides?.overrideStyleSrc || defaults.styleSrc,
  )
  const connectSrc = validateCspParam(
    cspOverrides?.overrideConnectSrc || defaults.connectSrc,
  )

  let csp = ""
  csp += `base-uri ${baseUri};`
  csp += `default-src ${defaultSrc};`
  csp += `font-src ${fontSrc};`
  csp += `frame-src ${frameSrc};`
  csp += `img-src ${imgSrc};`
  csp += `manifest-src ${manifestSrc};`
  csp += `media-src ${mediaSrc};`
  csp += `object-src ${objectSrc};`
  csp += `script-src ${scriptSrc};`
  csp += `style-src ${styleSrc};`
  csp += `connect-src ${connectSrc};`

  return csp
}

export class WebappSecurityHeaders extends cdk.Construct {
  public readonly securityHeadersFunction: cloudfront.Function

  constructor(
    scope: cdk.Construct,
    id: string,
    props: WebappSecurityHeadersProps,
  ) {
    super(scope, id)

    const cspHeaderName = props.cspOverrides?.reportOnly
      ? "content-security-policy-report-only"
      : "content-security-policy"

    const csp = generateCsp(props.cspOverrides)

    const lambdaCode = `function handler(event) {
      var response = event.response;
      var headers = response.headers;
      headers['strict-transport-security'] = {value: 'max-age=63072000;'};
      headers['x-content-type-options'] = {value: 'nosniff'};
      headers['x-xss-protection'] = {value: '1; mode=block'};
      headers['${cspHeaderName}'] = {value: "${csp}"};
      return response;
    }`

    this.securityHeadersFunction = new cloudfront.Function(this, "Function", {
      code: cloudfront.FunctionCode.fromInline(lambdaCode),
    })
  }
}
