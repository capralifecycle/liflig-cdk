#!/usr/bin/env python

"""
Transform CloudTrail events to payloads formatted for Slack's API, and send them
directly to Slack or through an SQS FIFO queue for deduplication.

The code below contains entrypoints for two Lambda functions (prefixed with `handler_`).
"""

import os
import logging
import json
import urllib.request
import re
import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def augment_strings_with_friendly_names(strings, friendly_names):
    """A helper method for augmenting various values (e.g., AWS account ID) in
    a list of strings with a more friendly name"""
    # We avoid replacing values that are directly prefixed and/or suffixed with ':'
    # as it is most likely an ARN or similiar. We don't want to replace account IDs
    # inside ARNs as this would look messy.This is a quite basic heuristic, but it should allow
    # us to easily replace most relevant values (e.g., principal ID, account ID, etc.) with
    # friendly names without a complicated regex.
    pattern = re.compile(
        "|".join([f"(?<!:)({re.escape(key)})(?!:)" for key in friendly_names])
    )
    return [
        pattern.sub(
            lambda m: m[0] + f" ({friendly_names[m.string[m.start() : m.end()]]})", s
        )
        for s in strings
    ]


def get_slack_payload_for_assume_role_event(event, friendly_names):
    """Parse a CloudTrail event related to the API call sts:AssumeRole,
    and return a Slack-formatted attachment"""
    event_detail = event["detail"]
    recipient_account_id = event_detail["recipientAccountId"]
    request_parameters = event_detail.get("requestParameters", {}) or {}

    timestamp = event_detail["eventTime"]
    user_identity = event_detail["userIdentity"]
    principal_id = user_identity["principalId"]
    principal_account_id = user_identity["accountId"]
    source_identity = request_parameters.get("sourceIdentity", "")
    source_ip = event_detail.get("sourceIPAddress", "")
    role_arn = request_parameters.get("roleArn", "")

    fallback = f"Sensitive role accessed in '{recipient_account_id}'"
    pretext_messages = [
        f":warning: Sensitive role in `{recipient_account_id}` assumed by"
    ]
    if principal_id.startswith("AIDA"):
        pretext_messages.append("IAM user")
    elif principal_id.startswith("AROA"):
        # The other part of the principal ID for a role is the name of the session
        principal_id = principal_id.split(":")[0]
        pretext_messages.append("IAM role")
    else:
        pretext_messages.append("principal")
    pretext_messages.append(f"in `{principal_account_id}`")
    pretext = " ".join(pretext_messages)

    text = [
        f"*Role ARN:* `{role_arn}`",
        f"*Principal Account ID:* `{principal_account_id}`",
        f"*Principal ID:* `{principal_id}`",
        f"*Source IP:* `{source_ip}`",
        f"*Source Identity:* `{source_identity}`" if source_identity else "",
        f"*Timestamp:* `{timestamp}`",
    ]
    text = "\n".join(line for line in text if line)

    try:
        pretext, fallback, text = augment_strings_with_friendly_names(
            [pretext, fallback, text], friendly_names
        )
    except:
        logger.exception("Failed to augment strings with friendly names")
    return {
        "attachments": [
            {
                "pretext": pretext,
                "color": "warning",
                "text": text,
                "fallback": fallback,
                "mrkdwn_in": ["pretext", "text"],
            }
        ]
    }


def get_fallback_slack_payload_for_event(
    event, friendly_names, fallback_parse_behavior=""
):
    """Parse a generic CloudTrail event related to an API call
    and return a Slack-formatted attachment"""
    event_detail = event["detail"]
    event_name = event_detail["eventName"]
    event_type = event_detail["eventType"]
    event_time = event_detail["eventTime"]
    recipient_account_id = event_detail["recipientAccountId"]
    pretext = f":warning: CloudTrail event in account `{recipient_account_id}`"
    fallback = f"CloudTrail event in account '{recipient_account_id}'"
    if fallback_parse_behavior == "DUMP_EVENT":
        text = "\n".join(
            ["*Event:*", "```", json.dumps(event, sort_keys=True, indent=2), "```"]
        )
    else:
        error_message = event_detail.get("errorMessage", "")
        # This may be None, in which case we force it to an empty dict instead
        response_element = (event_detail.get("responseElements", {}) or {}).get(
            event_name, ""
        )
        user_identity = event_detail["userIdentity"]
        principal_id = user_identity.get("principalId", "")
        principal_type = user_identity.get("type", "")
        principal_account_id = user_identity.get("accountId", "")
        principal_arn = user_identity.get("arn", "")
        source_ip = event_detail.get("sourceIPAddress", "")
        resources = event_detail.get("resources", []) or []
        text = [
            f"*Event Type:* `{event_type}`",
            f"*Event Name:* `{event_name}`",
            f"*Event Time:* `{event_time}`",
            f"*Error Message:* `{error_message}`" if error_message else "",
            f"*Response Code:* `{response_element}`" if response_element else "",
            f"*Principal Type:* `{principal_type}`" if principal_type else "",
            f"*Principal Account ID:* `{principal_account_id}`"
            if principal_account_id
            else "",
            f"*Principal ARN:* `{principal_arn}`" if principal_arn else "",
            f"*Principal ID:* `{principal_id}`" if principal_id else "",
            f"*Source IP:* `{source_ip}`" if source_ip else "",
            f"*Resources:*\n```{json.dumps(resources, indent=2, sort_keys=True)}\n```"
            if len(resources)
            else "",
        ]
        # Filter out empty strings
        text = "\n".join(line for line in text if line)

    try:
        pretext, fallback, text = augment_strings_with_friendly_names(
            [pretext, fallback, text], friendly_names
        )
    except:
        logger.exception("Failed to augment strings with friendly names")

    return {
        "attachments": [
            {
                "pretext": pretext,
                "color": "warning",
                "text": text,
                "fallback": fallback,
                "mrkdwn_in": ["pretext", "text"],
            }
        ]
    }


def get_augmented_friendly_names(event, friendly_names):
    """Return an augmented dictionary containing the alias of the current
    AWS account as a friendly name for the current account ID if relevant"""
    augmented_friendly_names = {**friendly_names}
    try:
        event_account_id = event["account"]
        event_detail = event["detail"]
        recipient_account_id = event_detail["recipientAccountId"]
        if (
            not friendly_names.get(event_account_id, "")
            and event_account_id == recipient_account_id
        ):
            logger.info(
                "No friendly name was supplied for current account '%s', so looking up account alias",
                event_account_id,
            )
            iam = boto3.client("iam")
            aliases = iam.list_account_aliases()["AccountAliases"]
            if len(aliases):
                augmented_friendly_names[event_account_id] = aliases[0]
    except:
        logger.exception("Failed to look up alias of current AWS account")

    return augmented_friendly_names


def post_to_slack(slack_payload, slack_webhook_url):
    """Post a payload to Slack's webhook API"""
    encoded_slack_payload = json.dumps(slack_payload).encode("utf-8")
    try:
        slack_request = urllib.request.Request(
            slack_webhook_url,
            data=encoded_slack_payload,
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(slack_request)
    except:
        logger.exception("Failed to post to Slack")
        raise


def handler_event_transformer(event, context):
    """Lambda handler for the event transformer Lambda"""
    logger.info("Triggered with event: %s", json.dumps(event, indent=2))

    friendly_names = json.loads(os.environ["FRIENDLY_NAMES"])
    slack_webhook_url = os.environ["SLACK_WEBHOOK_URL"]
    slack_channel = os.environ["SLACK_CHANNEL"]
    sqs_queue_url = os.environ.get("SQS_QUEUE_URL", "")
    fallback_parse_behavior = os.environ.get("FALLBACK_PARSE_BEHAVIOR", "")
    deduplicate_events = os.environ.get("DEDUPLICATE_EVENTS", "false") == "true"

    friendly_names = get_augmented_friendly_names(event, friendly_names)

    if not event["detail-type"].endswith("via CloudTrail"):
        logger.warn("Invalid event received")
        return

    slack_payload = {}
    try:
        if event["detail"]["eventName"] == "AssumeRole":
            slack_payload = get_slack_payload_for_assume_role_event(
                event, friendly_names
            )
    except:
        logger.exception("Failed to parse event using predefined schema")
    if not slack_payload:
        logger.warn("Using a fallback schema to parse event")
        slack_payload = get_fallback_slack_payload_for_event(
            event,
            friendly_names,
            fallback_parse_behavior=fallback_parse_behavior,
        )
    slack_payload = {**slack_payload, "channel": slack_channel}

    if deduplicate_events and sqs_queue_url:
        logger.info("Sending message to SQS for deduplication")
        deduplication_id = (
            event["detail"].get("requestID", "")
            or event["detail"].get("eventID", "")
            or event["id"]
        )
        body = {
            "slackWebhookUrl": slack_webhook_url,
            "slackPayload": slack_payload,
        }

        sqs = boto3.client("sqs")
        sqs.send_message(
            QueueUrl=sqs_queue_url,
            MessageBody=json.dumps(body),
            MessageDeduplicationId=deduplication_id,
            MessageGroupId=deduplication_id,
        )
    else:
        logger.info("Sending message directly to Slack")
        post_to_slack(slack_payload, slack_webhook_url)


def handler_slack_forwarder(event, context):
    """Lambda handler for the Slack forwarder Lambda"""
    logger.info("Triggered with event: %s", json.dumps(event, indent=2))
    records = event["Records"]
    for record in records:
        body = json.loads(record["body"])
        slack_channel = body.get("slackChannel", "")
        slack_webhook_url = body.get("slackWebhookUrl", "")
        slack_payload = {
            **body["slackPayload"],
            **({"channel": slack_channel} if slack_channel else {}),
        }
        post_to_slack(slack_payload, slack_webhook_url)
