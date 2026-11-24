import type * as wafv2 from "aws-cdk-lib/aws-wafv2"

/*
 * Checks of a rendered web ACL against the limits that AWS WAF enforces at
 * deploy time, so that a mistake fails at synth with all problems listed
 * instead of failing the deployment one problem at a time.
 *
 * Values are checked after `stack.resolve`, so they are plain data, except for
 * CloudFormation intrinsics, which are skipped.
 *
 * Limits are from the AWS WAF API reference and
 * https://docs.aws.amazon.com/waf/latest/developerguide/limits.html
 */

const MAX_RATE_BASED_RULES = 10
const MAX_REFERENCE_STATEMENTS = 50
const MAX_CUSTOM_RESPONSE_BODIES = 50
const MAX_CUSTOM_RESPONSE_BODY_BYTES = 4 * 1024
const MAX_CUSTOM_RESPONSE_BODIES_BYTES = 50 * 1024
const MAX_TOKEN_DOMAINS = 10
const MAX_TEXT_TRANSFORMATIONS = 10
const MAX_SEARCH_STRING_BYTES = 200
const MAX_COUNTRY_CODES = 50
const MAX_LABEL_NAMESPACES = 5
const MAX_LABEL_COMPONENT_LENGTH = 128
const MAX_LABEL_MATCH_KEY_LENGTH = 1024

const KEY_PATTERN = /^[\w-]{1,128}$/
const LABEL_PATTERN = /^[0-9A-Za-z_\-:]+$/
const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/
const WORD_PATTERN = /^\w+$/
const RESERVED_LABEL_WORDS = [
  "aws",
  "waf",
  "managed",
  "rulegroup",
  "webacl",
  "regexpatternset",
  "ipset",
]

const REFERENCE_STATEMENTS = [
  "ipSetReferenceStatement",
  "regexPatternSetReferenceStatement",
  "ruleGroupReferenceStatement",
] as const

/** Statements whose `textTransformations` must have 1 to 10 entries. */
const TRANSFORMING_STATEMENTS = [
  "byteMatchStatement",
  "regexMatchStatement",
  "regexPatternSetReferenceStatement",
  "sizeConstraintStatement",
  "sqliMatchStatement",
  "xssMatchStatement",
] as const

type Json = any

/** Whether a resolved value is a CloudFormation intrinsic such as `Ref`. */
function isIntrinsic(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false
  }
  const keys = Object.keys(value)
  return keys.length === 1 && (keys[0] === "Ref" || keys[0].startsWith("Fn::"))
}

/** Whether a resolved value can be inspected: present and not an intrinsic. */
function known(value: unknown): boolean {
  return value !== undefined && value !== null && !isIntrinsic(value)
}

function knownArray(value: unknown): value is Json[] {
  return known(value) && Array.isArray(value)
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, "utf8")
}

interface Counts {
  rateBased: number
  references: number
}

class Problems {
  readonly messages: string[] = []
  readonly usedBodyKeys: { where: string; key: string }[] = []
  readonly counts: Counts = { rateBased: 0, references: 0 }

  add(where: string, message: string): void {
    this.messages.push(`${where}: ${message}`)
  }
}

function checkTextTransformations(
  where: string,
  transformations: unknown,
  problems: Problems,
): void {
  if (!knownArray(transformations)) return
  if (
    transformations.length < 1 ||
    transformations.length > MAX_TEXT_TRANSFORMATIONS
  ) {
    problems.add(
      where,
      `must have 1 to ${MAX_TEXT_TRANSFORMATIONS} text transformations, got ${transformations.length}`,
    )
  }
  const priorities = new Set<number>()
  for (const transformation of transformations) {
    const priority = transformation?.priority
    if (!known(priority)) continue
    if (!Number.isInteger(priority) || priority < 0) {
      problems.add(
        where,
        `text transformation priority must be an integer of 0 or more, got ${priority}`,
      )
    } else if (priorities.has(priority)) {
      problems.add(
        where,
        `text transformation priorities must be different, ${priority} is used more than once`,
      )
    }
    priorities.add(priority)
  }
}

function checkByteMatch(where: string, s: Json, problems: Problems): void {
  const searchString = s.searchString
  if (!known(searchString) || typeof searchString !== "string") return
  const bytes = utf8Length(searchString)
  if (bytes < 1 || bytes > MAX_SEARCH_STRING_BYTES) {
    problems.add(
      where,
      `searchString must be 1 to ${MAX_SEARCH_STRING_BYTES} bytes, got ${bytes}`,
    )
  }
  if (
    s.positionalConstraint === "CONTAINS_WORD" &&
    !WORD_PATTERN.test(searchString)
  ) {
    problems.add(
      where,
      `searchString '${searchString}' must only have letters, digits and '_' with CONTAINS_WORD`,
    )
  }
}

function checkGeoMatch(where: string, s: Json, problems: Problems): void {
  const codes = s.countryCodes
  if (!knownArray(codes)) return
  if (codes.length < 1 || codes.length > MAX_COUNTRY_CODES) {
    problems.add(
      where,
      `must have 1 to ${MAX_COUNTRY_CODES} country codes, got ${codes.length}`,
    )
  }
  for (const code of codes) {
    if (typeof code === "string" && !COUNTRY_CODE_PATTERN.test(code)) {
      problems.add(
        where,
        `'${code}' is not a two-letter uppercase ISO 3166 country code`,
      )
    }
  }
}

function checkLabelMatch(where: string, s: Json, problems: Problems): void {
  const key = s.key
  if (!known(key) || typeof key !== "string") return
  if (
    key.length < 1 ||
    key.length > MAX_LABEL_MATCH_KEY_LENGTH ||
    !LABEL_PATTERN.test(key)
  ) {
    problems.add(
      where,
      `label key '${key}' must be 1 to ${MAX_LABEL_MATCH_KEY_LENGTH} characters of letters, digits, '_', '-' and ':'`,
    )
  }
}

function checkStatement(
  where: string,
  statement: unknown,
  problems: Problems,
): void {
  if (!known(statement)) return
  const s = statement as Json

  for (const kind of ["andStatement", "orStatement"] as const) {
    const children = s[kind]?.statements
    if (!knownArray(children)) continue
    if (children.length < 2) {
      problems.add(
        `${where}.${kind}`,
        `must have at least 2 statements, got ${children.length}`,
      )
    }
    children.forEach((child, i) => {
      checkStatement(`${where}.${kind}.statements[${i}]`, child, problems)
    })
  }
  if (known(s.notStatement)) {
    checkStatement(
      `${where}.notStatement.statement`,
      s.notStatement.statement,
      problems,
    )
  }

  for (const kind of TRANSFORMING_STATEMENTS) {
    if (known(s[kind])) {
      checkTextTransformations(
        `${where}.${kind}`,
        s[kind].textTransformations,
        problems,
      )
    }
  }
  if (known(s.byteMatchStatement)) {
    checkByteMatch(
      `${where}.byteMatchStatement`,
      s.byteMatchStatement,
      problems,
    )
  }
  if (known(s.geoMatchStatement)) {
    checkGeoMatch(`${where}.geoMatchStatement`, s.geoMatchStatement, problems)
  }
  if (known(s.labelMatchStatement)) {
    checkLabelMatch(
      `${where}.labelMatchStatement`,
      s.labelMatchStatement,
      problems,
    )
  }

  for (const kind of REFERENCE_STATEMENTS) {
    if (s[kind] !== undefined) problems.counts.references += 1
  }
  if (s.rateBasedStatement !== undefined) {
    problems.counts.rateBased += 1
  }
  for (const kind of ["rateBasedStatement", "managedRuleGroupStatement"]) {
    if (known(s[kind])) {
      checkStatement(
        `${where}.${kind}.scopeDownStatement`,
        s[kind].scopeDownStatement,
        problems,
      )
    }
  }
  if (known(s.managedRuleGroupStatement)) {
    const overrides = s.managedRuleGroupStatement.ruleActionOverrides
    if (knownArray(overrides)) {
      overrides.forEach((override, i) => {
        checkAction(
          `${where}.managedRuleGroupStatement.ruleActionOverrides[${i}].actionToUse`,
          override?.actionToUse,
          problems,
        )
      })
    }
  }
}

/** Checks the custom response of a block action, of a rule or the default. */
function checkAction(where: string, action: unknown, problems: Problems): void {
  if (!known(action)) return
  const customResponse = (action as Json).block?.customResponse
  if (!known(customResponse)) return
  const at = `${where}.block.customResponse`
  const { responseCode, customResponseBodyKey } = customResponse
  if (
    known(responseCode) &&
    !(
      Number.isInteger(responseCode) &&
      responseCode >= 200 &&
      responseCode <= 599
    )
  ) {
    problems.add(at, `responseCode must be 200 to 599, got ${responseCode}`)
  }
  if (known(customResponseBodyKey)) {
    if (!KEY_PATTERN.test(customResponseBodyKey)) {
      problems.add(
        at,
        `customResponseBodyKey '${customResponseBodyKey}' must be 1 to 128 characters of letters, digits, '_' and '-'`,
      )
    }
    problems.usedBodyKeys.push({ where: at, key: customResponseBodyKey })
  }
}

function checkRuleLabels(
  where: string,
  labels: unknown,
  problems: Problems,
): void {
  if (!knownArray(labels)) return
  for (const label of labels) {
    const name = label?.name
    if (!known(name) || typeof name !== "string") continue
    const at = `${where} label '${name}'`
    if (!LABEL_PATTERN.test(name)) {
      problems.add(at, "must only have letters, digits, '_', '-' and ':'")
      continue
    }
    const components = name.split(":")
    if (components.length > MAX_LABEL_NAMESPACES + 1) {
      problems.add(
        at,
        `can have at most ${MAX_LABEL_NAMESPACES} namespaces, got ${components.length - 1}`,
      )
    }
    for (const component of components) {
      if (
        component.length < 1 ||
        component.length > MAX_LABEL_COMPONENT_LENGTH
      ) {
        problems.add(
          at,
          `each namespace and name must be 1 to ${MAX_LABEL_COMPONENT_LENGTH} characters`,
        )
      } else if (RESERVED_LABEL_WORDS.includes(component.toLowerCase())) {
        problems.add(
          at,
          `'${component}' is reserved by WAF and cannot be used in a label`,
        )
      }
    }
  }
}

function checkCustomResponseBodies(
  bodies: unknown,
  problems: Problems,
): Set<string> | undefined {
  if (bodies === undefined || bodies === null) return new Set()
  if (!known(bodies)) return undefined
  const entries = Object.entries(bodies as Record<string, Json>)
  if (entries.length > MAX_CUSTOM_RESPONSE_BODIES) {
    problems.add(
      "customResponseBodies",
      `can have at most ${MAX_CUSTOM_RESPONSE_BODIES} bodies, got ${entries.length}`,
    )
  }
  let total = 0
  for (const [key, body] of entries) {
    const at = `customResponseBodies.${key}`
    if (!KEY_PATTERN.test(key)) {
      problems.add(
        at,
        "key must be 1 to 128 characters of letters, digits, '_' and '-'",
      )
    }
    const content = body?.content
    if (!known(content) || typeof content !== "string") continue
    const bytes = utf8Length(content)
    total += bytes
    if (bytes < 1 || bytes > MAX_CUSTOM_RESPONSE_BODY_BYTES) {
      problems.add(
        at,
        `content must be 1 to ${MAX_CUSTOM_RESPONSE_BODY_BYTES} bytes, got ${bytes}`,
      )
    }
  }
  if (total > MAX_CUSTOM_RESPONSE_BODIES_BYTES) {
    problems.add(
      "customResponseBodies",
      `content can be at most ${MAX_CUSTOM_RESPONSE_BODIES_BYTES} bytes in total, got ${total}`,
    )
  }
  // Keys of entries that are intrinsics are still known.
  return new Set(entries.map(([key]) => key))
}

/**
 * Problems with the props of a web ACL that WAF would reject at deploy time,
 * as messages that say where each one is. Empty if there are none.
 *
 * @param props the props of the web ACL, after `stack.resolve`
 */
export function webAclProblems(props: wafv2.CfnWebACLProps): string[] {
  const problems = new Problems()
  const p = props as Json

  checkAction("defaultAction", p.defaultAction, problems)

  if (knownArray(p.rules)) {
    for (const rule of p.rules) {
      if (!known(rule)) continue
      const where = `rule '${rule.name}'`
      checkStatement(`${where} statement`, rule.statement, problems)
      checkAction(`${where} action`, rule.action, problems)
      checkRuleLabels(where, rule.ruleLabels, problems)
    }
  }

  if (problems.counts.rateBased > MAX_RATE_BASED_RULES) {
    problems.add(
      "rules",
      `a web ACL can have at most ${MAX_RATE_BASED_RULES} rate-based rules, got ${problems.counts.rateBased}`,
    )
  }
  if (problems.counts.references > MAX_REFERENCE_STATEMENTS) {
    problems.add(
      "rules",
      `a web ACL can have at most ${MAX_REFERENCE_STATEMENTS} IP set, regex pattern set and rule group reference statements, got ${problems.counts.references}`,
    )
  }

  const bodyKeys = checkCustomResponseBodies(p.customResponseBodies, problems)
  if (bodyKeys) {
    for (const { where, key } of problems.usedBodyKeys) {
      if (!bodyKeys.has(key)) {
        problems.add(
          where,
          `customResponseBodyKey '${key}' is not a key of the web ACL's customResponseBodies`,
        )
      }
    }
  }

  if (knownArray(p.tokenDomains) && p.tokenDomains.length > MAX_TOKEN_DOMAINS) {
    problems.add(
      "tokenDomains",
      `can have at most ${MAX_TOKEN_DOMAINS} domains, got ${p.tokenDomains.length}`,
    )
  }

  return problems.messages
}

/**
 * Thrown when a `WebAcl` is created with props that AWS WAF would reject at
 * deploy time. The message lists every problem; they are also available one
 * by one in `problems`.
 */
export class WafValidationError extends Error {
  override readonly name = "WafValidationError"

  constructor(
    /** Path of the construct that failed, e.g. `Stack/WebAcl`. */
    public readonly constructPath: string,
    /** Each problem, saying where in the web ACL it is. */
    public readonly problems: readonly string[],
  ) {
    super(
      `WebAcl initialization failed due to the following validation error(s) in ${constructPath}:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    )
  }
}
