import json
import os
import boto3
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

SLACK_URL = os.getenv('SLACK_URL', None)
SLACK_CHANNEL = os.getenv('SLACK_CHANNEL', None)
PROJECT_NAME = os.getenv('PROJECT_NAME', 'undefined')
ENVIRONMENT_NAME = os.getenv('ENVIRONMENT_NAME', 'undefined')


def handler(event, context):
    print("Event: " + json.dumps(event))
    message = json.loads(event['Records'][0]['Sns']['Message'])
    region = event['Records'][0]['Sns']['TopicArn'].split(':')[3]

    return send_slack_notification(message, region)


def send_slack_notification(message, region):
    alarm_emojis = {
        "ALARM": ":rotating_light:",
        "INSUFFICIENT_DATA": ":warning:",
        "OK": ":white_check_mark:"
    }
    if (message['NewStateValue'] == "ALARM"):
        color = "danger"
    else:
        color = "good"
    alarm_description = message["AlarmDescription"] or "Alarm is missing description"
    attachments = [{
        'color': color,
        'title_link': "https://console.aws.amazon.com/cloudwatch/home?region=" + region + "#alarm:alarmFilter=ANY;name=" + message['AlarmName'],
        'fallback': f"{alarm_emojis.get(message['NewStateValue'], '')} {message['AlarmName']}: {alarm_description}",
        'fields': [
            {'title': 'Alarm Name',
             'value': message['AlarmName'], 'short': False},
            {'title': 'Alarm Description',
             'value': alarm_description, 'short': False},
            {'title': 'Account',
             'value': message['AWSAccountId'], 'short': True},
            {'title': 'Region', 'value': region, 'short': True},
            {'title': 'Project', 'value': PROJECT_NAME, 'short': True},
            {'title': 'Environment', 'value': ENVIRONMENT_NAME, 'short': True},
            {'title': 'State Transition',
             'value': message.get('OldStateValue', 'Unknown') + ' -> ' + message['NewStateValue'], 'short': False},
            {'title': 'Link to Alarm', 'value': "https://console.aws.amazon.com/cloudwatch/home?region=" +
             region + "#alarm:alarmFilter=ANY;name=" + message['AlarmName'], "short": False},
        ]

    }]

    slackMessage = {
        'channel': SLACK_CHANNEL,
        'attachments': attachments,
        'username': 'CloudWatch-Notifier',
        'icon_emoji': ':traffic_light:'
    }

    req = Request(SLACK_URL, json.dumps(slackMessage).encode('utf-8'))
    try:
        response = urlopen(req)
        response.read()
        return "Message posted to: " + slackMessage['channel']
    except HTTPError as e:
        raise Exception(f"Request to slack failed: {e.code} {e.reason}")
    except URLError as e:
        raise Exception(f"Server connection to slack failed: {e.reason}")
