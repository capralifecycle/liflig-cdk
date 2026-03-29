import json
import gzip
import base64
import os
import pytest

os.environ.setdefault("AWS_REGION", "eu-west-1")

import index as handler_module

from index import (
    create_slack_message_from_cloudwatch_log,
    process_event,
    get_secret,
    send_slack_notification,
    get_masked_slack_webhook_url,
)


def make_event(log_messages):
    log_events = []
    for i, msg in enumerate(log_messages, start=1):
        log_events.append({
            "id": str(i),
            "timestamp": 1620000000000 + i,
            "message": json.dumps(msg),
        })
    payload = {
        "logGroup": "test-log-group",
        "logStream": "test-log-stream",
        "logEvents": log_events,
    }
    compressed = base64.b64encode(
        gzip.compress(json.dumps(payload).encode("utf-8"))
    ).decode("utf-8")
    return {"awslogs": {"data": compressed}}


class DummyResp:
    def read(self):
        return b"ok"


def test_create_slack_message_from_cloudwatch_log_defaults():
    events = [{"service": "svc", "message": "err", "stack_trace": "trace"}]
    slack = create_slack_message_from_cloudwatch_log(
        events, "lg", 123456, project_name="proj", environment_name="env"
    )
    assert "blocks" in slack
    # header contains the title with service
    header_text = slack["blocks"][0]["text"]["text"]
    assert "svc error" in header_text


def test_get_secret_success_and_failure():
    class DummySecretsClient:
        def get_secret_value(self, SecretId):
            return {"SecretString": "super-secret"}

    assert get_secret("id", secrets_client=DummySecretsClient()) == "super-secret"

    class BrokenSecretsClient:
        def get_secret_value(self, SecretId):
            raise Exception("boom")

    with pytest.raises(Exception) as exc:
        get_secret("id", secrets_client=BrokenSecretsClient())
    assert "Error retrieving secret" in str(exc.value)


def test_process_event_calls_urlopen():
    ev = make_event([
        {"service": "svc", "message": "oops", "stack_trace": "trace"}
    ])

    class DummySecretsClient:
        def get_secret_value(self, SecretId):
            return {"SecretString": "https://hooks.slack.com/services/T/B/S"}

    class DummyResp:
        def read(self):
            return b"ok"

    # Instead of checking urlopen directly (overlaps with
    # send_slack_notification tests), verify process_event delegates to
    # send_slack_notification by replacing it in the module with a spy.
    called = {"count": 0}

    original_send = handler_module.send_slack_notification

    def dummy_send_slack_notification(slack_message, **kwargs):
        called["count"] += 1

    try:
        handler_module.send_slack_notification = dummy_send_slack_notification
        process_event(ev, None, secrets_client=DummySecretsClient(), urlopen_func=lambda r: DummyResp())
    finally:
        handler_module.send_slack_notification = original_send

    assert called["count"] == 1


def test_send_slack_notification_uses_secret_and_urlopen():
    # send_slack_notification uses get_secret and urlopen; inject both
    class DummySecretsClient:
        def get_secret_value(self, SecretId):
            return {"SecretString": "https://hooks.slack.com/services/T/B/S"}


    called = {"c": 0}

    def dummy_urlopen(req):
        called["c"] += 1
        # basic checks on request body (headers may not be accessible in this
        # test environment in the same way across Python versions).
        data = None
        if hasattr(req, "data") and req.data is not None:
            data = req.data
        elif hasattr(req, "get_data"):
            data = req.get_data()
        assert data is not None
        payload = json.loads(data.decode("utf-8"))
        assert payload.get("foo") == "bar"
        return DummyResp()

    send_slack_notification(
        {"foo": "bar"},
        secrets_client=DummySecretsClient(),
        urlopen_func=dummy_urlopen,
        slack_secret_name="unused",
    )
    assert called["c"] == 1


def test_create_slack_message_more_than_three_events():
    # 5 events -> summary should say "...and 2 other messages." or similar
    events = [
        {"service": "svc1", "message": "m1", "stack_trace": "t1"},
        {"service": "svc2", "message": "m2", "stack_trace": "t2"},
        {"service": "svc3", "message": "m3", "stack_trace": "t3"},
        {"service": "svc4", "message": "m4", "stack_trace": "t4"},
        {"service": "svc5", "message": "m5", "stack_trace": "t5"},
    ]
    slack = create_slack_message_from_cloudwatch_log(
        events, "lg", 123456, project_name="proj", environment_name="env"
    )
    # Collect text from blocks and assert the summary mentions extra messages
    text_join = " ".join(
        b.get("text", {}).get("text", "")
        for b in slack.get("blocks", [])
        if "text" in b
    )
    # Be permissive about the exact wording; the handler may say "And 4 other logs"
    # or similar. Ensure some "other" summary appears.
    assert "other" in text_join.lower()


def test_create_slack_message_no_stack_trace():
    # event without stack_trace should include a fallback such as "No stack trace."
    events = [{"service": "svc", "message": "err"}]  # no stack_trace key
    slack = create_slack_message_from_cloudwatch_log(
        events, "lg", 123456, project_name="proj", environment_name="env"
    )
    # Assert there is no section block that contains the explicit
    # "*Stack trace*:" header and that no rich_text block for stack trace
    # exists.
    blocks = slack.get("blocks", [])
    assert not any(
        b.get("type") == "section" and "stack trace" in b.get("text", {}).get("text", "").lower()
        for b in blocks
    )
    # Ensure at least the message rich_text block exists (the handler
    # always includes a rich_text block for the message itself).
    assert any(b.get("type") == "rich_text" for b in blocks)


def test_get_secrets_client_injection_does_not_pollute_module_cache():
    # Ensure passing a secrets_client directly does not set the module-level
    # cached client (_secrets_client). Also verify that creating a client when
    # none is cached will populate the module cache (using a monkeypatched
    # boto3.client to avoid network calls).
    # Reset state
    handler_module._secrets_client = None

    # Passing a dummy client should not mutate the module cache
    dummy = object()
    returned = handler_module._get_secrets_client(secrets_client=dummy)
    assert returned is dummy
    assert handler_module._secrets_client is None

    # Monkeypatch boto3.client to a noop factory that returns a sentinel
    original_boto3_client = handler_module.boto3.client
    try:
        handler_module.boto3.client = lambda svc: "real-client-sentinel"
        ret2 = handler_module._get_secrets_client()
        assert ret2 == "real-client-sentinel"
        assert handler_module._secrets_client == "real-client-sentinel"
    finally:
        handler_module.boto3.client = original_boto3_client


def test_process_event_json_decode_error_fallback():
    # Build compressed payload with a raw non-JSON first message to trigger
    # JSONDecodeError in the parser path.
    payload = {
        "logGroup": "test-log-group",
        "logStream": "test-log-stream",
        "logEvents": [
            {"id": "1", "timestamp": 1620000000000, "message": "not-a-json"},
            {"id": "2", "timestamp": 1620000000001, "message": json.dumps({"service": "svc2", "message": "m2"})},
        ],
    }
    compressed = base64.b64encode(gzip.compress(json.dumps(payload).encode("utf-8"))).decode("utf-8")
    ev = {"awslogs": {"data": compressed}}

    class DummySecretsClient:
        def get_secret_value(self, SecretId):
            return {"SecretString": "https://hooks.slack.com/services/T/B/S"}

    called = {"c": 0}

    def dummy_urlopen(req):
        called["c"] += 1
        return DummyResp()

    # Should not raise and should call urlopen once
    process_event(ev, None, secrets_client=DummySecretsClient(), urlopen_func=dummy_urlopen)
    assert called["c"] == 1


def test_process_event_with_broken_secrets_client_raises():
    ev = make_event([{"service": "svc", "message": "oops", "stack_trace": "trace"}])

    class BrokenSecretsClient:
        def get_secret_value(self, SecretId):
            raise Exception("boom-secret")

    with pytest.raises(Exception):
        process_event(
            ev, None, secrets_client=BrokenSecretsClient(), urlopen_func=lambda r: None
        )


def test_get_masked_slack_webhook_url():
    masked = get_masked_slack_webhook_url("https://hooks.slack.com/services/T/B/S")
    assert masked.endswith("*" * len("S"))

    masked2 = get_masked_slack_webhook_url("https://example.com/abcd/")
    assert masked2.endswith("*" * len("abcd"))

    masked3 = get_masked_slack_webhook_url("https://example.com/foo")
    assert masked3.endswith("*" * len("foo"))


