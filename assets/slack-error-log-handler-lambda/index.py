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
from urllib.error import URLError, HTTPError
import time
import boto3

# Don't create a boto3 client at import time (it may raise NoRegionError
# during test import). Create clients lazily inside functions when needed.
secrets_manager = None

SLACK_URL_SECRET_NAME = os.getenv("SLACK_URL_SECRET_NAME", None)
PROJECT_NAME = os.getenv("PROJECT_NAME", "undefined")
ENVIRONMENT_NAME = os.getenv("ENVIRONMENT_NAME", "undefined")
REGION = os.getenv("AWS_REGION", "eu-west-1")


class CloudWatchLog(TypedDict):
    """Single parsed log entry (message, stack_trace, service).

    `stack_trace` may be absent; when missing we treat it as `None`.
    """

    message: str
    stack_trace: Optional[str]
    service: str


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
    urlopen_func=urlopen,
    time_func=time.time,
    slack_secret_name=SLACK_URL_SECRET_NAME,
    project_name=PROJECT_NAME,
    environment_name=ENVIRONMENT_NAME,
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

    current_timestamp = int(time_func())
    logged_timestamp = decoded_message["logEvents"][0].get(
        "timestamp", current_timestamp
    )
    # Normalize timestamp to seconds (logged_timestamp may be millis).
    try:
        logged_ts_int = int(logged_timestamp)
    except Exception:
        logged_ts_int = current_timestamp
    timestamp_in_seconds = (
        logged_ts_int if logged_ts_int < 1_000_000_000_000 else int(logged_ts_int / 1000)
    )

    log_group = decoded_message.get("logGroup", "undefined")

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
            [
                f"{message[:100] + '...'}"
                for message in decoded_message["logEvents"][1:]
            ],
        )
    send_slack_notification(
        slack_message,
        secrets_client=secrets_client,
        urlopen_func=urlopen_func,
        slack_secret_name=slack_secret_name,
    )


def get_secret(secret, secrets_client=None):
    """Return a secret string from Secrets Manager."""
    if secrets_client is None:
        # Lazily create the client so importing this module in test
        # environments that don't have AWS region configured doesn't fail.
        secrets_client = boto3.client("secretsmanager")
    try:
        return secrets_client.get_secret_value(SecretId=secret)["SecretString"]
    except Exception as e:
        raise Exception(f"Error retrieving secret: {e}")


def send_slack_notification(
    slack_message: dict,
    *,
    secrets_client=None,
    urlopen_func=None,
    slack_secret_name=None,
):
    """Post the Slack payload using a webhook from Secrets Manager."""
    if secrets_client is None:
        secrets_client = boto3.client("secretsmanager")
    if urlopen_func is None:
        urlopen_func = urlopen
    if slack_secret_name is None:
        slack_secret_name = SLACK_URL_SECRET_NAME

    slack_url = get_secret(slack_secret_name, secrets_client=secrets_client)

    req = Request(
        slack_url,
        data=json.dumps(slack_message).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        response = urlopen_func(req)
        response.read()
    except HTTPError as e:
        raise Exception(f"Request to slack failed: {e.code} {e.reason}")
    except URLError as e:
        raise Exception(f"Server connection to slack failed: {e.reason}")


def get_masked_slack_webhook_url(slack_webhook_url: str):
    """Return a masked representation of the webhook URL suitable for logging."""
    trimmed_url = slack_webhook_url.rstrip("/")
    [*url, final_path_segment] = trimmed_url.split("/")
    return "/".join(url + [len(final_path_segment) * "*"])


def create_slack_message_from_cloudwatch_log(
    events: list[CloudWatchLog],
    log_group,
    timestamp,
    *,
    project_name: str = PROJECT_NAME,
    environment_name: str = ENVIRONMENT_NAME,
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
                    "text": {"type": "mrkdwn", "text": "*Stack trace*:"
                    },
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

    blocks.extend(
        [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"<https://{REGION}.console.aws.amazon.com/cloudwatch/home?region={REGION}#logsV2:logs-insights$3FqueryDetail$3D~(end~0~start~-1800~timeType~'RELATIVE~tz~'LOCAL~unit~'seconds~editorString~'fields*20timestamp*2c*20message*0a*7c*20filter*20level*20*3d*20*22ERROR*22*0a*7c*20sort*20timestamp*20desc*0a*7c*20limit*20100~queryId~'21977150-6b0f-4abd-9c88-9767c4ba1919~source~(~'{log_group})~lang~'CWLI)|Logs insights>",
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
