import type * as wafv2 from "aws-cdk-lib/aws-wafv2"

export interface CustomResponse {
  /** HTTP status code of the response, e.g. 403. */
  responseCode: number
  /**
   * Key of an entry in the web ACL's `customResponseBodies`.
   *
   * @default no body
   */
  customResponseBodyKey?: string
}

export interface BlockOptions {
  /**
   * @default WAF's standard 403 response
   */
  customResponse?: CustomResponse
}

function renderBlock(options?: BlockOptions) {
  const customResponse = options?.customResponse
  return customResponse
    ? {
        customResponse: {
          responseCode: customResponse.responseCode,
          customResponseBodyKey: customResponse.customResponseBodyKey,
        },
      }
    : {}
}

/** What a rule does with a request it matches. */
export class Action {
  static allow(): Action {
    return new Action("allow")
  }

  static block(options?: BlockOptions): Action {
    return new Action("block", options)
  }

  static count(): Action {
    return new Action("count")
  }

  static captcha(): Action {
    return new Action("captcha")
  }

  static challenge(): Action {
    return new Action("challenge")
  }

  private constructor(
    public readonly kind: "allow" | "block" | "count" | "captcha" | "challenge",
    private readonly blockOptions?: BlockOptions,
  ) {}

  render(): wafv2.CfnWebACL.RuleActionProperty {
    switch (this.kind) {
      case "allow":
        return { allow: {} }
      case "block":
        return { block: renderBlock(this.blockOptions) }
      case "count":
        return { count: {} }
      case "captcha":
        return { captcha: {} }
      case "challenge":
        return { challenge: {} }
    }
  }
}

/** What the web ACL does with a request that no rule decides. */
export class DefaultAction {
  static allow(): DefaultAction {
    return new DefaultAction(false)
  }

  static block(options?: BlockOptions): DefaultAction {
    return new DefaultAction(true, options)
  }

  private constructor(
    private readonly block: boolean,
    private readonly blockOptions?: BlockOptions,
  ) {}

  render(): wafv2.CfnWebACL.DefaultActionProperty {
    return this.block
      ? { block: renderBlock(this.blockOptions) }
      : { allow: {} }
  }
}
