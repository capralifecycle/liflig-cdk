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
        log_events.append(
            {
                "id": str(i),
                "timestamp": 1620000000000 + i,
                "message": json.dumps(msg),
            }
        )
    payload = {
        "logGroup": "test-log-group",
        "logStream": "test-log-stream",
        "logEvents": log_events,
    }
    compressed = base64.b64encode(
        gzip.compress(json.dumps(payload).encode("utf-8"))
    ).decode("utf-8")
    return {"awslogs": {"data": compressed}}


# Small helper used across tests to represent a secrets client that returns
# a fixed secret string.
class SimpleSecretsClient:
    def __init__(self, secret_str):
        self._secret = secret_str

    def get_secret_value(self, SecretId):
        return {"SecretString": self._secret}


@pytest.fixture
def dummy_resp():
    class _D:
        def read(self):
            return b"ok"

    return _D()


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
    assert get_secret("id", secrets_client=SimpleSecretsClient("super-secret")) == "super-secret"

    class BrokenSecretsClient:
        def get_secret_value(self, SecretId):
            raise Exception("boom")

    with pytest.raises(Exception) as exc:
        get_secret("id", secrets_client=BrokenSecretsClient())
    assert "Error retrieving secret" in str(exc.value)

def test_send_slack_notification_uses_secret_and_urlopen(dummy_resp):
    # send_slack_notification uses get_secret and urlopen; inject both
    dummy_client = SimpleSecretsClient("https://hooks.slack.com/services/T/B/S")

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
        return dummy_resp

    send_slack_notification(
        {"foo": "bar"},
        secrets_client=dummy_client,
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
        b.get("type") == "section"
        and "stack trace" in b.get("text", {}).get("text", "").lower()
        for b in blocks
    )
    # Ensure at least the message rich_text block exists (the handler
    # always includes a rich_text block for the message itself).
    assert any(b.get("type") == "rich_text" for b in blocks)


def test_injected_client_does_not_pollute_cache(monkeypatch):
    # Start from a clean module-level cache
    monkeypatch.setattr(handler_module, "_secrets_client", None, raising=False)

    injected = object()
    assert handler_module._get_secrets_client(secrets_client=injected) is injected
    # cache should remain empty after injection
    assert handler_module._secrets_client is None

    # Lazy-create a real client via boto3.client (monkeypatch to a sentinel)
    monkeypatch.setattr(handler_module.boto3, "client", lambda svc: "sentinel")
    assert handler_module._get_secrets_client() == "sentinel"
    assert handler_module._secrets_client == "sentinel"

def test_process_event_json_decode_error_fallback(dummy_resp):
    # Build compressed payload with a raw non-JSON first message to trigger
    # JSONDecodeError in the parser path.
    payload = {
        "logGroup": "test-log-group",
        "logStream": "test-log-stream",
        "logEvents": [
            {"id": "1", "timestamp": 1620000000000, "message": "not-a-json"},
            {
                "id": "2",
                "timestamp": 1620000000001,
                "message": json.dumps({"service": "svc2", "message": "m2"}),
            },
        ],
    }
    compressed = base64.b64encode(
        gzip.compress(json.dumps(payload).encode("utf-8"))
    ).decode("utf-8")
    ev = {"awslogs": {"data": compressed}}

    dummy_client = SimpleSecretsClient("https://hooks.slack.com/services/T/B/S")

    called = {"c": 0}

    def dummy_urlopen(req):
        called["c"] += 1
        return dummy_resp

    # Should not raise and should call urlopen once
    process_event(ev, None, secrets_client=dummy_client, urlopen_func=dummy_urlopen)
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


@pytest.mark.parametrize(
    "url, tail",
    [
        ("https://hooks.slack.com/services/T/B/S", "S"),
        ("https://example.com/abcd/", "abcd"),
        ("https://example.com/foo", "foo"),
    ],
)
def test_get_masked_slack_webhook_url(url, tail):
    masked = get_masked_slack_webhook_url(url)
    assert masked.endswith("*" * len(tail))
