import json
import os
from pprint import pprint
from typing import TypedDict
from urllib.request import Request, urlopen
import base64
import gzip
from urllib.error import URLError, HTTPError
import time
import boto3

secrets_manager = boto3.client("secretsmanager")

SLACK_URL_SECRET_NAME = os.getenv("SLACK_URL_SECRET_NAME", None)
PROJECT_NAME = os.getenv("PROJECT_NAME", "undefined")
ENVIRONMENT_NAME = os.getenv("ENVIRONMENT_NAME", "undefined")


class CloudWatchLog(TypedDict):
    message: str
    stack_trace: str
    service: str


class CloudWatchEvent(TypedDict):
    logEvents: list[CloudWatchLog]
    logGroup: str
    logStream: str


def handler(event, _context):
    pprint("Dump: " + json.dumps(event))

    data = event["awslogs"]["data"]
    decoded_message: CloudWatchEvent = json.loads(
        gzip.decompress(base64.b64decode(data))
    )

    pprint("Data: " + json.dumps(decoded_message))

    current_timestamp = int(time.time())
    logged_timestamp = decoded_message["logEvents"][0].get(
        "timestamp", current_timestamp
    )
    # Timestamp needs to be in seconds and not millis, the time() function can possibly return both
    timestamp_in_seconds = (
        logged_timestamp
        if len(str(logged_timestamp)) < 12
        else str(logged_timestamp)[:-3]
    )
    log_group = decoded_message.get("logGroup", "undefined")

    try:
        if len(decoded_message["logEvents"]) > 0:
            log_events: list[CloudWatchLog] = [
                json.loads(log_event["message"])
                for log_event in decoded_message["logEvents"]
            ]
            slack_message = create_slack_message_from_cloudwatch_log(
                log_events, log_group, timestamp_in_seconds
            )
        else:
            slack_message = create_slack_message(
                "No log messaged received in slack error log handler",
                PROJECT_NAME,
                timestamp_in_seconds,
                ENVIRONMENT_NAME,
                f"No log messages received when the lambda handling errors for log group {log_group} was called.",
                None,
                log_group,
                [],
            )
    except json.JSONDecodeError:
        slack_message = create_slack_message(
            f"Error in {log_group}",
            PROJECT_NAME,
            timestamp_in_seconds,
            ENVIRONMENT_NAME,
            decoded_message["logEvents"][0]["message"][:750] + "...\n...",
            None,
            log_group,
            [
                f"{message[:100] + '...'}"
                for message in decoded_message["logEvents"][1:]
            ],
        )
    send_slack_notification(slack_message)


def get_masked_slack_webhook_url(slack_webhook_url: str):
    """
    Return a string that masks the final path segment of a Slack webhook URL.
    The URL is typically formatted as such: https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX
    """
    trimmed_url = slack_webhook_url.rstrip("/")
    [*url, final_path_segment] = trimmed_url.split("/")
    return "/".join(url + [len(final_path_segment) * "*"])


def get_secret(secret):
    try:
        return secrets_manager.get_secret_value(SecretId=secret)["SecretString"]
    except Exception as e:
        raise Exception(f"Error retrieving secret: {e}")


def create_slack_message_from_cloudwatch_log(
    events: list[CloudWatchLog], log_group, timestamp
):
    event = events[0]

    service = event.get("service", "Undefined")
    stack_trace = event.get("stack_trace", "No stack trace.")
    message = event.get("message", "No message.")

    other_messages = [
        other_event.get("message", "undefined") for other_event in events[1:]
    ]

    slack_message = create_slack_message(
        f"{service} error",
        PROJECT_NAME,
        timestamp,
        ENVIRONMENT_NAME,
        message,
        stack_trace,
        log_group,
        other_messages,
    )
    return slack_message


def send_slack_notification(slack_message: dict):
    slack_url = get_secret(SLACK_URL_SECRET_NAME)

    req = Request(slack_url, json.dumps(slack_message).encode("utf-8"))
    print(f"Posting message to Slack URL {get_masked_slack_webhook_url(slack_url)}")
    try:
        response = urlopen(req)
        response.read()
    except HTTPError as e:
        raise Exception(f"Request to slack failed: {e.code} {e.reason}")
    except URLError as e:
        raise Exception(f"Server connection to slack failed: {e.reason}")


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

    if stack_trace is not None:
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

    blocks.extend(
        [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"<https://eu-west-1.console.aws.amazon.com/cloudwatch/home?region=eu-west-1#logsV2:logs-insights$3FqueryDetail$3D~(end~0~start~-1800~timeType~'RELATIVE~tz~'LOCAL~unit~'seconds~editorString~'fields*20timestamp*2c*20message*0a*7c*20filter*20level*20*3d*20*22ERROR*22*0a*7c*20sort*20timestamp*20desc*0a*7c*20limit*20100~queryId~'21977150-6b0f-4abd-9c88-9767c4ba1919~source~(~'{log_group})~lang~'CWLI)|Logs insights>",
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
                            "elements": [
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
                            + [
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
                            ],
                        }
                    ],
                },
            ]
        )
    slack_template = {"blocks": blocks}
    return slack_template
