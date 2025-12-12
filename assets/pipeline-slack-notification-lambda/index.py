import json
import os
import typing as t
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

import boto3

client = boto3.client("codepipeline")
s3 = boto3.client("s3")
secrets_manager = boto3.client("secretsmanager")

ACCOUNT_FRIENDLY_NAME = os.getenv("ACCOUNT_FRIENDLY_NAME", None)
SLACK_URL_SECRET_NAME = os.getenv("SLACK_URL_SECRET_NAME", None)
NOTIFICATION_LEVEL = os.getenv("NOTIFICATION_LEVEL", "WARN")

# Example event:
#
# {
#   version: '0',
#   id: '01896665-9ef2-b417-cccd-333acf6a9320',
#   'detail-type': 'CodePipeline Pipeline Execution State Change',
#   source: 'aws.codepipeline',
#   account: '123456789123',
#   time: '2021-06-11T23:02:20Z',
#   region: 'eu-west-1',
#   resources: [
#     'arn:aws:codepipeline:eu-west-1:123456789123:hst-tester-pipeline-PipelineC660917D-OLEMKURBGPBG'
#   ],
#   detail: {
#     pipeline: 'hst-tester-pipeline-PipelineC660917D-OLEMKURBGPBG',
#     'execution-id': '91daefbf-658a-4c6f-ad9e-13de7df5eaeb',
#     state: 'SUCCEEDED',
#     version: 3
#   }
# }

STYLES = {
    "FAILED": {"emoji_prefix": ":x:", "message_color": "#ff0000"},
    "SUCCEEDED": {"emoji_prefix": ":white_check_mark:", "message_color": "#008000"},
    "STARTED": {"emoji_prefix": ":rocket:", "message_color": "#00bfff"},
    "SUPERSEDED": {"emoji_prefix": ":arrow_heading_down:", "message_color": "#373737"},
}


class TriggerMetadataVcs(t.TypedDict):
    branchName: str
    commitAuthor: str
    commitHash: str
    repositoryName: str
    repositoryOwner: str


class TriggerMetadataCi(t.TypedDict):
    type: t.Literal["JENKINS", "GITHUB_ACTIONS"]
    triggeredBy: str


class TriggerMetadata(t.TypedDict):
    version: t.Literal["0.1"]
    ci: TriggerMetadataCi
    vcs: TriggerMetadataVcs


def get_masked_slack_webhook_url(slack_webhook_url: str):
    """
    Return a string that masks the final path segment of a Slack webhook URL.
    The URL is typically formatted as such: https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX
    """
    trimmed_url = slack_webhook_url.rstrip("/")
    [*url, final_path_segment] = trimmed_url.split("/")
    return "/".join(url + [len(final_path_segment) * "*"])


def get_previous_pipeline_execution(
    pipeline_name: str, execution_id: str
) -> dict | None:
    """Return the newest past execution that either succeeded or failed"""

    pipeline_executions = client.list_pipeline_executions(
        pipelineName=pipeline_name,
    )["pipelineExecutionSummaries"]

    is_next = False

    for item in pipeline_executions:
        # Only include succeeded and failed executions.
        # This is needed to properly detect a recovered
        # pipeline (failed -> succeeded, even if e.g. superseeded in between).
        if is_next and item["status"] in ["Succeeded", "Failed"]:
            return item
        if item["pipelineExecutionId"] == execution_id:
            is_next = True

    return None


def get_text_for_failed(pipeline_name: str, execution_id: str, state: str) -> str:
    """Return a Slack-formatted string that describes failed pipeline execution actions,
    if any, in a failed execution"""

    # We only show details if the pipeline has completed with failed state.
    # If we were to process this for other events such as started events,
    # we would include details from after the event took place.
    if state != "FAILED":
        return ""

    action_executions = client.list_action_executions(
        pipelineName=pipeline_name,
        filter={
            "pipelineExecutionId": execution_id,
        },
    )["actionExecutionDetails"]

    failures = []

    for action_execution in action_executions:
        if action_execution["status"] == "Failed":
            stage = action_execution["stageName"]
            action = action_execution["actionName"]
            summary = action_execution["output"]["executionResult"][
                "externalExecutionSummary"
            ]
            failures.append(f"{stage}.{action} failed:\n{summary}")

    result = ""

    if len(failures):
        result = "```\n" + "\n\n".join(failures) + "\n```"

    return result


def get_metadata_from_trigger(
    pipeline_name: str, execution_id: str
) -> TriggerMetadata | None:
    """Returns a dictionary containing the metadata, if any, stored in the trigger file"""

    action_response = client.list_action_executions(
        pipelineName=pipeline_name, filter={"pipelineExecutionId": execution_id}
    )

    action = next(
        (
            action
            for action in action_response["actionExecutionDetails"]
            if action["input"]["actionTypeId"]["category"] == "Source"
            and action["input"]["actionTypeId"]["provider"] == "S3"
        ),
        None,
    )
    if action:
        s3_version_id = action["output"]["outputVariables"]["VersionId"]
        artifacts_bucket = action["input"]["configuration"]["S3Bucket"]
        trigger_file = action["input"]["configuration"]["S3ObjectKey"]

    try:
        response = s3.get_object(
            Bucket=artifacts_bucket, Key=trigger_file, VersionId=s3_version_id
        )
        file_content = response["Body"].read().decode("utf-8")
        ci_metadata = json.loads(file_content)
        return ci_metadata
    except Exception as e:
        print(f"Could not obtain metadata from trigger file: {e}")

    return None


def get_footer_text(ci_metadata: TriggerMetadata) -> str:
    """Returns the footer text for the Slack message if the metadata contains the required fields"""

    footer_text = ""
    if ci_metadata and ci_metadata.get("version", "") == "0.1":
        ci = ci_metadata.get("ci", {})
        vcs = ci_metadata.get("vcs", {})
        triggering_actor = ci.get("triggeredBy", "")
        repository_owner = vcs.get("repositoryOwner", "")
        repository_name = vcs.get("repositoryName", "")
        short_commit_hash = vcs.get("commitHash", "")[:8]
        branch_name = vcs.get("branchName", "")
        if (
            triggering_actor
            and repository_owner
            and repository_name
            and short_commit_hash
            and branch_name
        ):
            commit_link_text = f"{repository_owner}/{repository_name} @ {branch_name} ({short_commit_hash})"
            github_commit_link = f"https://github.com/{repository_owner}/{repository_name}/commit/{short_commit_hash}"
            footer_text = f"Triggered by {triggering_actor} in <{github_commit_link}|{commit_link_text}>"

    return footer_text


def get_secret(secret):
    try:
        return secrets_manager.get_secret_value(SecretId=secret)["SecretString"]
    except Exception as e:
        raise Exception(f"Error retrieving secret: {e}")


def handler(event, context):
    print("Event: " + json.dumps(event))

    region = event["region"]
    account_id = event["account"]
    pipeline_name = event["detail"]["pipeline"]
    state = event["detail"]["state"]
    execution_id = event["detail"]["execution-id"]

    if state in ("STARTED", "SUPERSEDED") and NOTIFICATION_LEVEL != "DEBUG":
        return

    if event["detail-type"] != "CodePipeline Pipeline Execution State Change":
        print("Ignoring unknown event")
        return

    previous_pipeline_execution = get_previous_pipeline_execution(
        pipeline_name, execution_id
    )

    previous_failed = (
        previous_pipeline_execution is not None
        and previous_pipeline_execution["status"] == "Failed"
    )

    # We still show succeeded for the first event or when
    # the previous execution was not success.
    if state == "SUCCEEDED" and (NOTIFICATION_LEVEL == "WARN"):
        if previous_pipeline_execution is not None and not previous_failed:
            print("Ignoring succeeded event")
            return

    pipeline_url = f"https://{region}.console.aws.amazon.com/codesuite/codepipeline/pipelines/{quote(pipeline_name, safe='')}/view"
    execution_url = f"https://{region}.console.aws.amazon.com/codesuite/codepipeline/pipelines/{quote(pipeline_name, safe='')}/executions/{execution_id}/timeline"

    account_friendly_name = f"in {ACCOUNT_FRIENDLY_NAME or account_id}"

    state_text = state
    if previous_failed and state == "SUCCEEDED":
        state_text += " (previously failed)"

    ci_metadata = get_metadata_from_trigger(pipeline_name, execution_id)

    footer_text = get_footer_text(ci_metadata)

    style = STYLES.get(
        state, {"emoji_prefix": ":question:", "message_color": "#ffdf00"}
    )

    emoji_prefix = style["emoji_prefix"]
    message_color = style["message_color"]

    text_for_failed = get_text_for_failed(pipeline_name, execution_id, state)

    text = "\n".join(
        s
        for s in [f"*Execution:* <{execution_url}|{execution_id}>", text_for_failed]
        if s
    )
    pretext = " ".join(
        s
        for s in [
            f"{emoji_prefix} Pipeline *<{pipeline_url}|{pipeline_name}>*",
            f"*{state_text}*",
            account_friendly_name,
        ]
        if s
    )
    fallback = f"Pipeline {pipeline_name} {state}"
    attachments = [
        {
            "footer": footer_text,
            "color": message_color,
            "text": text,
            "mrkdwn_in": ["text", "pretext"],
            "pretext": pretext,
            "fallback": fallback,
        },
    ]

    slack_message = {
        "attachments": attachments,
    }

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
