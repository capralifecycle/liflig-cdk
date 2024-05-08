import json
import os
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

import boto3

secrets_manager = boto3.client("secretsmanager")
cloudwatch = boto3.client("cloudwatch")

SLACK_URL_SECRET_NAME = os.getenv("SLACK_URL_SECRET_NAME", None)
PROJECT_NAME = os.getenv("PROJECT_NAME", "undefined")
ENVIRONMENT_NAME = os.getenv("ENVIRONMENT_NAME", "undefined")


def handler(event, context):
    print("Event: " + json.dumps(event))
    message = json.loads(event["Records"][0]["Sns"]["Message"])
    topic_arn = event["Records"][0]["Sns"]["TopicArn"]
    region = topic_arn.split(":")[3]

    active_alarms = list_all_active_alarms(topic_arn)
    return send_slack_notification(message, region, active_alarms)


def list_all_active_alarms(topic_arn: str) -> list[str]:
    try:
        response: dict = cloudwatch.describe_alarms(AlarmTypes=["CompositeAlarm", "MetricAlarm"],
                                                    StateValue="ALARM",
                                                    ActionPrefix=topic_arn)
        all_alarms = response["CompositeAlarms"] + response["MetricAlarms"]
        names: list[str] = [alarm["AlarmName"] for alarm in all_alarms if alarm["ActionsEnabled"]]
        return names
    except Exception as e:
        print(f"Failed to list alarms: {e}")
        return []


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


def send_slack_notification(message: str, region: str, active_alarms: list[str]):
    alarm_emojis = {
        "ALARM": ":rotating_light:",
        "INSUFFICIENT_DATA": ":warning:",
        "OK": ":white_check_mark:",
    }
    if message["NewStateValue"] == "ALARM":
        color = "danger"
    else:
        color = "good"
    alarm_description = message["AlarmDescription"] or "Alarm is missing description"
    attachments = [
        {
            "color": color,
            "title_link": "https://console.aws.amazon.com/cloudwatch/home?region="
                          + region
                          + "#alarm:alarmFilter=ANY;name="
                          + message["AlarmName"],
            "fallback": f"{alarm_emojis.get(message['NewStateValue'], '')} {message['AlarmName']}: {alarm_description}",
            "fields": [
                {"title": "Alarm Name", "value": message["AlarmName"], "short": False},
                {
                    "title": "Alarm Description",
                    "value": alarm_description,
                    "short": False,
                },
                {"title": "Account", "value": message["AWSAccountId"], "short": True},
                {"title": "Region", "value": region, "short": True},
                {"title": "Project", "value": PROJECT_NAME, "short": True},
                {"title": "Environment", "value": ENVIRONMENT_NAME, "short": True},
                {
                    "title": "State Transition",
                    "value": message.get("OldStateValue", "Unknown")
                             + " -> "
                             + message["NewStateValue"],
                    "short": False,
                },
                {
                    "title": "Link to Alarm",
                    "value": "https://console.aws.amazon.com/cloudwatch/home?region="
                             + region
                             + "#alarm:alarmFilter=ANY;name="
                             + message["AlarmName"],
                    "short": False,
                },
                {
                    "title": "All active alarms " + (alarm_emojis["ALARM"] if len(active_alarms) else ""),
                    "value": "\n".join(["- " + alarm for alarm in active_alarms]) if len(active_alarms) else "None",
                    "short": False,
                }
            ],
        }
    ]

    slackMessage = {
        "attachments": attachments,
    }

    slack_url = get_secret(SLACK_URL_SECRET_NAME)

    req = Request(slack_url, json.dumps(slackMessage).encode("utf-8"))
    print(f"Posting message to Slack URL {get_masked_slack_webhook_url(slack_url)}")
    try:
        response = urlopen(req)
        response.read()
    except HTTPError as e:
        raise Exception(f"Request to slack failed: {e.code} {e.reason}")
    except URLError as e:
        raise Exception(f"Server connection to slack failed: {e.reason}")
