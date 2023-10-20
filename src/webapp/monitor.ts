import * as cdk from "aws-cdk-lib"
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch"
import * as cognito from "aws-cdk-lib/aws-cognito"
import * as iam from "aws-cdk-lib/aws-iam"
import * as rum from "aws-cdk-lib/aws-rum"
import * as constructs from "constructs"

type CwRumTelemetries = ("http" | "performance" | "errors")[]

type EventsAlarm = {
  /**
   * An action to use for CloudWatch alarm state changes instead of the default action
   */
  action?: cloudwatch.IAlarmAction
  /**
   * The threshold defined as the number of CloudWatch RUM events that determines if the alarm should trigger or not.
   * @default 1000
   */
  threshold?: number
  /**
   * @default 1
   */
  evaluationPeriods?: number
  /**
   * @default cdk.Duration.minutes(1)
   */
  period?: cdk.Duration
  /**
   * @default false
   */
  enableOkAlarm?: boolean
}

type ErrorsAlarm = {
  /**
   * An action to use for CloudWatch alarm state changes instead of the default action
   */
  action?: cloudwatch.IAlarmAction
  /**
   * The threshold defined as the number of JavaScript errors recorded by CloudWatch RUM that determines if the alarm should trigger or not.
   * @default 0
   */
  threshold?: number
  /**
   * @default 1
   */
  evaluationPeriods?: number
  /**
   * @default cdk.Duration.minutes(1)
   */
  period?: cdk.Duration
  /**
   * @default false
   */
  enableOkAlarms: boolean
}

interface WebappMonitorProps {
  /**
   * The name of the CloudWatch RUM App Monitor.
   *
   * NOTE: This name needs to be unique within a given AWS region.
   */
  appMonitorName: string
  /**
   * The domain the web application to monitor is served on.
   *
   * Only web applications served on this domain can publish data to CloudWatch RUM.
   */
  webappDomainName: string
  /**
   * Which telemetries to allow CloudWatch RUM to collect.
   *
   * Currently these telemetries are supported:
   * - "http" report the http fetch calles made by browser to CW RUM
   * - "errors" report the js errors which occur, passed via rumConfig.recordError
   * - "performance" report the app performance
   *
   * @default: ["errors", "http", "performance"]
   */
  telemetries?: CwRumTelemetries
  /**
   * The default CloudWatch alarm action to use.
   *
   * By default, an alarm is created for a high number of events being sent to CloudWatch RUM. This alarm action is used for the default alarm,
   * and for other alarms if no other action is explicitly set when configuring or enabling alarms through this construct.
   *
   */
  defaultAlarmAction: cloudwatch.IAlarmAction
  /**
   * Allow CloudWatch RUM to record custom events.
   *
   * These events need to be defined in and sent from your web application.
   *
   * @default false
   */
  enableXRay?: boolean
  /**
   * Allow CloudWatch RUM to use cookies.
   *
   * CloudWatch RUM does not require cookies in order to record errors, but some features require cookies to be enabled.
   * @default false
   */
  enableCustomEvents?: boolean
  /**
   * Allow CloudWatch RUM to use cookies.
   *
   * CloudWatch RUM does not require cookies in order to record errors, but some features require cookies to be enabled.
   *
   * See: https://aws.amazon.com/blogs/mt/how-and-when-to-enable-session-cookies-with-amazon-cloudwatch-rum/
   *
   * NOTE: You'll likely need to introduce a cookie consent popup in your web application
   * before enabling cookies in your client-side configuration.
   *
   * @default true
   */
  allowCookies?: boolean
  /**
   * The rate of client-side CloudWatch RUM sessions to sample.
   *
   * Values are between 0 and 1, where 1 is 100% of sessions.
   *
   * NOTE: You'll likely want to set this to a number below 1 in production environments with
   * a lot of traffic.
   *
   * @default 1
   */
  sessionSampleRate?: number
  /**
   *
   * Whether to store a copy of CloudWatch RUM events in CloudWatch Logs.
   *
   * Enabling this can improve the ergonomics of finding relevant CloudWatch RUM events compared to
   * using the CloudWatch RUM console as it makes it possible to search using CloudWatch Logs Insights etc.
   *
   * @default false
   */
  exportLogs?: boolean
  /**
   * Override top-level properties for the rum.CfnAppMonitor construct
   *
   * @default - no overrides are used.
   */
  overrideAppMonitorProps?: Partial<rum.CfnAppMonitorProps>
  /**
   * Override App Monitor configuration properties for the rum.CfnAppMonitor construct
   *
   * @default - no overrides are used.
   */
  overrideAppMonitorConfiguration?: Partial<rum.CfnAppMonitor.AppMonitorConfigurationProperty>
}

/**
 *  A construct for creating a CloudWatch Real User Monitoring (RUM) App Monitor.
 *
 * An app monitor allows you to centrally collect and view client-side data (JavaScript and HTTP errors, performance metrics, etc.)
 * recorded from a web application.
 *
 * NOTE: You'll need to add a JavaScript snippet to your web application and configure CloudWatch RUM using
 * AWS's client-side SDK after deploying the construct to enable your web application to start collecting data.
 * The App Monitor controls which CloudWatch RUM functionality the web application can use, and in order to
 * leverage given functionality you'll need to configure it both in the App Monitor as well as in the
 * configuration of the client-side SDK used by your web application.
 *
 */
export class WebappMonitor extends constructs.Construct {
  readonly identityPool: cognito.CfnIdentityPool
  readonly guestRole: iam.IRole
  readonly appMonitor: rum.CfnAppMonitor
  private readonly _webappDomainName: string

  private readonly _defaultAlarmAction: cloudwatch.IAlarmAction

  private _eventsAlarm: cloudwatch.IAlarm
  private _eventsAlarmId = "EventsAlarm"

  constructor(
    scope: constructs.Construct,
    id: string,
    props: WebappMonitorProps,
  ) {
    super(scope, id)

    if (
      props.sessionSampleRate &&
      (props.sessionSampleRate < 0 || props.sessionSampleRate > 1)
    ) {
      throw new Error("sessionSampleRate needs to be a number between 0 and 1")
    }

    this._webappDomainName = props.webappDomainName

    const appMonitorName = props.appMonitorName

    this.identityPool = new cognito.CfnIdentityPool(this, "RumIdentityPool", {
      allowUnauthenticatedIdentities: true,
    })

    this.guestRole = new iam.Role(this, "RumRole", {
      assumedBy: new iam.WebIdentityPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud": this.identityPool.ref,
          },
          "ForAnyValue:StringEquals": {
            "cognito-identity.amazonaws.com:amr": "unauthenticated",
          },
        },
      ),
      inlinePolicies: {
        "allow-rum": new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["rum:PutRumEvents"],
              resources: [
                cdk.Stack.of(this).formatArn({
                  service: "rum",
                  resource: "appmonitor",
                  resourceName: appMonitorName,
                }),
              ],
            }),
          ],
        }),
      },
    })

    // attach role to identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, "RoleAttachment", {
      identityPoolId: this.identityPool.ref,
      roles: {
        unauthenticated: this.guestRole.roleArn,
      },
    })

    this.appMonitor = new rum.CfnAppMonitor(this, "AppMonitor", {
      name: appMonitorName,
      domain: props.webappDomainName,
      cwLogEnabled: props.exportLogs ?? false,
      appMonitorConfiguration: {
        enableXRay: props.enableXRay ?? false,
        allowCookies: props.allowCookies ?? true,
        telemetries: props.telemetries ?? ["errors", "http", "performance"],
        sessionSampleRate: props.sessionSampleRate ?? 1,
        identityPoolId: this.identityPool.ref,
        guestRoleArn: this.guestRole.roleArn,
        ...props.overrideAppMonitorConfiguration,
      },
      customEvents: {
        status: props.enableCustomEvents ? "ENABLED" : "DISABLED",
      },
      ...props.overrideAppMonitorProps,
    })

    this._defaultAlarmAction = props.defaultAlarmAction
    this._eventsAlarm = this._createEventsAlarm()
  }

  /**
   *
   * Configure an alarm used to notify on an unexpectedly high number of CloudWatch RUM events being recorded.
   *
   * This alarm is required when using this construct.
   *
   * @default - an alarm is created with sane defaults.
   *
   */
  configureEventsAlarm(props?: EventsAlarm) {
    this.node.tryRemoveChild(this._eventsAlarmId)
    this._eventsAlarm = this._createEventsAlarm(props)
  }

  private _createEventsAlarm(props?: EventsAlarm): cloudwatch.IAlarm {
    const eventsAlarm = new cloudwatch.Metric({
      metricName: "RumEventPayloadSize",
      namespace: "AWS/RUM",
      statistic: cloudwatch.Stats.SAMPLE_COUNT,
      period: props?.period ?? cdk.Duration.seconds(60),
      dimensionsMap: {
        application_name: this.appMonitor.name,
      },
    }).createAlarm(this, this._eventsAlarmId, {
      alarmDescription: `A high number of events are being sent to CloudWatch RUM for app monitor '${this.appMonitor.name}'. This may lead to high costs, so you'll likely want to investigate this.`,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      threshold: props?.threshold ?? 1000,
      evaluationPeriods: props?.evaluationPeriods ?? 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })

    // These alarms are mandatory as costs should be mandator to monitor
    eventsAlarm.addAlarmAction(props?.action ?? this._defaultAlarmAction)
    if (props?.enableOkAlarm ?? false) {
      eventsAlarm.addOkAction(props?.action ?? this._defaultAlarmAction)
    }

    return eventsAlarm
  }

  /**
   * Add an alarm that alerts on JavaScript errors
   * sent to CloudWatch RUM.
   */
  addErrorsAlarm(props?: ErrorsAlarm) {
    const errorsAlarm = new cloudwatch.Metric({
      metricName: "JsErrorCount",
      namespace: "AWS/RUM",
      statistic: cloudwatch.Stats.SAMPLE_COUNT,
      period: props?.period ?? cdk.Duration.seconds(60),
      dimensionsMap: {
        application_name: this.appMonitor.name,
      },
    }).createAlarm(this, "RumJsErrorsAlarm", {
      alarmDescription: `CloudWatch RUM has recorded JavaScript errors for app monitor '${this.appMonitor.name}' on domain '${this._webappDomainName}'`,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      threshold: props?.threshold ?? 0,
      evaluationPeriods: props?.evaluationPeriods ?? 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })

    errorsAlarm.addAlarmAction(props?.action ?? this._defaultAlarmAction)

    if (props?.enableOkAlarms ?? false) {
      errorsAlarm.addOkAction(props?.action ?? this._defaultAlarmAction)
    }
  }
}
