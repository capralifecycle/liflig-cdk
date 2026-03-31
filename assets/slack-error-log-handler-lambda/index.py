"""
Slack error log handler Lambda
=============================
Lambda used as a CloudWatch Logs subscription destination. It
decodes base64+gzip subscription payloads, extracts structured JSON log
messages and posts a compact Slack message using a webhook URL
stored in Secrets Manager.
"""

import json
import os
from pprint import pprint
from typing import TypedDict, Optional
from urllib.request import Request, urlopen
import base64
import gzip
from typing import TypedDict, Optional
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
import time
import boto3

# Module-level cached Secrets Manager client. Stored as a global variable and
# lazily created by _get_secrets_client when a client is not injected.
_secrets_client = None

# Lazily-created cached Secrets Manager client. Don't create a boto3 client at
# import time (it may raise NoRegionError during test import or create network
# noise). Use _get_secrets_client() to obtain a client (injectable for tests).
def _get_secrets_client(secrets_client=None):
    """Return a Secrets Manager client.

    Caches the client lazily, so it isn’t created during import,
    but is reused across invocations within the same Lambda execution environment.

    Behavior:
    - If a `secrets_client` is provided, return it directly and do not mutate
      any cache. This is the injection path used by tests.
    - Otherwise, lazily create and cache a boto3 client and return it.
    """
    if secrets_client is not None:
        return secrets_client

    global _secrets_client
    if _secrets_client is None:
        _secrets_client = boto3.client("secretsmanager")

    return _secrets_client

SLACK_URL_SECRET_NAME = os.getenv("SLACK_URL_SECRET_NAME", None)
PROJECT_NAME = os.getenv("PROJECT_NAME", "undefined")
ENVIRONMENT_NAME = os.getenv("ENVIRONMENT_NAME", "undefined")
REGION = os.getenv("AWS_REGION", "eu-west-1")


class CloudWatchLog(TypedDict, total=False):
    """Single parsed log entry (message, stack_trace, service)."""

    message: str
    stack_trace: Optional[str]
    service: Optional[str]


class CloudWatchEvent(TypedDict):
    """Decoded CloudWatch Logs subscription payload."""

    logEvents: list[CloudWatchLog]
    logGroup: str
    logStream: str


def handler(event, _context):
    """Entrypoint that delegates to `process_event`."""
    return process_event(event, _context)


def process_event(
    event,
    _context,
    *,
    secrets_client=None,
    urlopen_func=None,
    time_func=time.time,
    slack_secret_name=SLACK_URL_SECRET_NAME,
    project_name=PROJECT_NAME,
    environment_name=ENVIRONMENT_NAME,
    region=REGION,
):
    """Decode a CloudWatch Logs event, build a Slack payload and post it.

    Network and secrets access are injectable for testing.
    """
    pprint("Dump: " + json.dumps(event))

    data = event["awslogs"]["data"]
    decoded_message: CloudWatchEvent = json.loads(
        gzip.decompress(base64.b64decode(data))
    )

    pprint("Data: " + json.dumps(decoded_message))

    timestamp_in_seconds = _resolve_timestamp(
        decoded_message.get("logEvents", []), time_func
    )

    log_group = decoded_message.get("logGroup", "undefined")

    # Use the provided region (default is module-level REGION)
    resolved_region = region

    try:
        if len(decoded_message["logEvents"]) > 0:
            log_events: list[CloudWatchLog] = [
                json.loads(log_event["message"])
                for log_event in decoded_message["logEvents"]
            ]
            slack_message = create_slack_message_from_cloudwatch_log(
                log_events,
                log_group,
                timestamp_in_seconds,
                project_name=project_name,
                environment_name=environment_name,
                region=resolved_region,
            )
        else:
            slack_message = create_slack_message(
                "No log message received in slack error log handler",
                project_name,
                timestamp_in_seconds,
                environment_name,
                f"No log messages received when the lambda handling errors for log group {log_group} was called.",
                None,
                log_group,
                [],
            )
    except json.JSONDecodeError:
        slack_message = create_slack_message(
            f"Error in {log_group}",
            project_name,
            timestamp_in_seconds,
            environment_name,
            decoded_message["logEvents"][0]["message"][:750] + "...\n...",
            None,
            log_group,
            [f"{evt['message'][:100]}..." for evt in decoded_message["logEvents"][1:]],
        )
    send_slack_notification(
        slack_message,
        secrets_client=secrets_client,
        urlopen_func=urlopen_func,
        slack_secret_name=slack_secret_name,
    )


def get_secret(secret, secrets_client=None):
    """Return a secret string from Secrets Manager."""
    client = _get_secrets_client(secrets_client)
    try:
        return client.get_secret_value(SecretId=secret)["SecretString"]
    except Exception as e:
        raise RuntimeError(f"Error retrieving secret '{secret}': {e}") from e


def send_slack_notification(
    slack_message: dict,
    *,
    secrets_client=None,
    urlopen_func=None,
    slack_secret_name=None,
):
    """Post the Slack payload using a webhook from Secrets Manager."""
    client = _get_secrets_client(secrets_client)
    if urlopen_func is None:
        urlopen_func = urlopen
    if slack_secret_name is None:
        slack_secret_name = SLACK_URL_SECRET_NAME

    slack_url = get_secret(slack_secret_name, secrets_client=client)

    # Use helper to post so error mapping is consistent
    _post_to_slack(slack_url, slack_message, urlopen_func=urlopen_func)


def _post_to_slack(url: str, payload: dict, *, urlopen_func):
    req = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        urlopen_func(req).read()
    except HTTPError as e:
        raise RuntimeError(f"Request to slack failed: {e.code} {e.reason}") from e
    except URLError as e:
        raise RuntimeError(f"Server connection to slack failed: {e.reason}") from e


def _resolve_timestamp(log_events, time_func):
    """Return a unix timestamp in seconds derived from the first log event.

    Falls back to the current time on malformed values.
    """
    current_timestamp = int(time_func())
    if not log_events:
        return current_timestamp
    raw = log_events[0].get("timestamp", current_timestamp)
    try:
        ts = int(raw)
    except Exception:
        return current_timestamp
    # CloudWatch may return milliseconds; normalise to seconds when value is large.
    return ts if ts < 1_000_000_000_000 else int(ts / 1000)


def get_masked_slack_webhook_url(slack_webhook_url: str) -> str:
    """Return a masked representation of the webhook URL suitable for logging.

    Keeps the leading part of the URL intact and replaces the final path
    segment with the same number of asterisks. Examples:

    - "https://example.com/abcd" -> "https://example.com/****"
    - "tokenonly" -> "*****"
    """
    if not slack_webhook_url:
        return ""
    trimmed = slack_webhook_url.rstrip("/")
    head, sep, tail = trimmed.rpartition("/")
    if sep == "":
        # no slash present; mask the whole value
        return "*" * len(tail)
    return head + sep + ("*" * len(tail))


def create_slack_message_from_cloudwatch_log(
    events: list[CloudWatchLog],
    log_group,
    timestamp,
    *,
    project_name: str = PROJECT_NAME,
    environment_name: str = ENVIRONMENT_NAME,
    region: Optional[str] = None,
):
    """Create a Slack message from parsed CloudWatch log events.

    `project_name` and `environment_name` default to the module-level
    env-vars but can be provided for testing or when the runtime should
    override them.
    """
    event = events[0]

    service = event.get("service", "Undefined")
    stack_trace = event.get("stack_trace")
    message = event.get("message", "No message.")

    other_messages = [
        other_event.get("message", "undefined") for other_event in events[1:]
    ]

    slack_message = create_slack_message(
        f"{service} error",
        project_name,
        timestamp,
        environment_name,
        message,
        stack_trace,
        log_group,
        other_messages,
        region=region,
    )
    return slack_message


def create_slack_message(
    title,
    project,
    timestamp,
    environment,
    message,
    stack_trace,
    log_group,
    extra_messages: list[str],
    *,
    region: Optional[str] = None,
):
    """Construct the Slack blocks payload used by the notification."""
    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"⚠️{title}⚠️",
                "emoji": True,
            },
        },
        {"type": "section", "text": {"type": "mrkdwn", "text": "*Message*:"}},
        {
            "type": "rich_text",
            "elements": [
                {
                    "type": "rich_text_preformatted",
                    "elements": [{"type": "text", "text": f"{message}"}],
                    "border": 0,
                }
            ],
        },
    ]

    if stack_trace:
        blocks.extend(
            [
                {
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": "*Stack trace*:"},
                },
                {
                    "type": "rich_text",
                    "elements": [
                        {
                            "type": "rich_text_preformatted",
                            "elements": [
                                {"type": "text", "text": f"{stack_trace[:750]}"}
                            ],
                            "border": 0,
                        }
                    ],
                },
            ]
        )

    use_region = region or REGION
    blocks.extend(
        [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"<https://{use_region}.console.aws.amazon.com/cloudwatch/home?region={use_region}#logsV2:logs-insights$3FqueryDetail$3D~(end~0~start~-1800~timeType~'RELATIVE~tz~'LOCAL~unit~'seconds~editorString~'fields*20timestamp*2c*20message*0a*7c*20filter*20level*20*3d*20*22ERROR*22*0a*7c*20sort*20timestamp*20desc*0a*7c*20limit*20100~queryId~'21977150-6b0f-4abd-9c88-9767c4ba1919~source~(~'{log_group})~lang~'CWLI)|Logs insights>",
                },
            },
            {"type": "divider"},
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": "*Logged:* "
                        + f"<!date^{timestamp}^"
                        + "{date_num} {time_secs}|Failed parsing timestamp>",
                    },
                    {"type": "mrkdwn", "text": f"*Project:* {project}"},
                    {"type": "mrkdwn", "text": f"*Environment:* {environment}"},
                ],
            },
        ]
    )

    if len(extra_messages) > 0:
        list_items = [
            {
                "type": "rich_text_section",
                "elements": [
                    {
                        "type": "text",
                        "text": message,
                        "style": {"italic": True},
                    }
                ],
            }
            for message in extra_messages[:3]
        ]

        if len(extra_messages) > 3:
            list_items.append(
                {
                    "type": "rich_text_section",
                    "elements": [
                        {
                            "type": "text",
                            "text": f"...and {len(extra_messages[3:])} other messages.",
                            "style": {"italic": True},
                        }
                    ],
                }
            )

        blocks.extend(
            [
                {"type": "divider"},
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*And {len(extra_messages)} other logs with messages:*",
                    },
                },
                {
                    "type": "rich_text",
                    "elements": [
                        {
                            "type": "rich_text_list",
                            "style": "bullet",
                            "indent": 0,
                            "elements": list_items,
                        }
                    ],
                },
            ]
        )
    slack_template = {"blocks": blocks}
    return slack_template
