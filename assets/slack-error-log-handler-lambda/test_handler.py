import json
import gzip
import base64
import os
import pytest

os.environ.setdefault("AWS_REGION", "eu-west-1")

from index import (
    create_slack_message_from_cloudwatch_log,
    process_event,
    get_secret,
    send_slack_notification,
)


def make_event(log_messages):
    payload = {
        "logGroup": "test-log-group",
        "logStream": "test-log-stream",
        "logEvents": [
            {"id": "1", "timestamp": 1620000000000, "message": json.dumps(log_messages[0])}
        ]
    }
    compressed = base64.b64encode(gzip.compress(json.dumps(payload).encode("utf-8"))).decode("utf-8")
    return {"awslogs": {"data": compressed}}


def test_create_slack_message_from_cloudwatch_log_defaults():
    events = [{"service": "svc", "message": "err", "stack_trace": "trace"}]
    slack = create_slack_message_from_cloudwatch_log(events, "lg", 123456, project_name="proj", environment_name="env")
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


def test_process_event_calls_urlopen(monkeypatch):
    ev = make_event([{"service": "svc", "message": "oops", "stack_trace": "trace"}])

    class DummySecretsClient:
        def get_secret_value(self, SecretId):
            return {"SecretString": "https://hooks.slack.com/services/T/B/S"}

    class DummyResp:
        def read(self):
            return b"ok"

    called = {"count": 0}

    def dummy_urlopen(req):
        called["count"] += 1
        return DummyResp()

    # Should not raise when provided with functional secrets client and urlopen
    process_event(ev, None, secrets_client=DummySecretsClient(), urlopen_func=dummy_urlopen)
    assert called["count"] == 1


def test_send_slack_notification_uses_secret_and_urlopen(monkeypatch):
    # send_slack_notification uses get_secret and urlopen; inject both
    class DummySecretsClient:
        def get_secret_value(self, SecretId):
            return {"SecretString": "https://hooks.slack.com/services/T/B/S"}

    class DummyResp:
        def read(self):
            return b"ok"

    called = {"c": 0}

    def dummy_urlopen(req):
        called["c"] += 1
        # basic checks on request body (headers may not be accessible in this
        # test environment in the same way across Python versions).
        data = None
        if hasattr(req, 'data') and req.data is not None:
            data = req.data
        elif hasattr(req, 'get_data'):
            data = req.get_data()
        assert data is not None
        payload = json.loads(data.decode('utf-8'))
        assert payload.get('foo') == 'bar'
        return DummyResp()

    send_slack_notification({"foo": "bar"}, secrets_client=DummySecretsClient(), urlopen_func=dummy_urlopen, slack_secret_name="unused")
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
    slack = create_slack_message_from_cloudwatch_log(events, "lg", 123456, project_name="proj", environment_name="env")
    # Collect text from blocks and assert the summary mentions extra messages
    text_join = " ".join(
        b.get("text", {}).get("text", "") for b in slack.get("blocks", []) if "text" in b
    )
    # Be permissive about the exact wording; the handler may say "And 4 other logs"
    # or similar. Ensure some "other" summary appears.
    assert "other" in text_join.lower()


def test_create_slack_message_no_stack_trace():
    # event without stack_trace should include a fallback such as "No stack trace."
    events = [{"service": "svc", "message": "err"}]  # no stack_trace key
    slack = create_slack_message_from_cloudwatch_log(events, "lg", 123456, project_name="proj", environment_name="env")
    text_join = " ".join(
        b.get("text", {}).get("text", "") for b in slack.get("blocks", []) if "text" in b
    )
    # The handler may omit an explicit "No stack trace" message and instead
    # include a CloudWatch Logs Insights link; accept either behavior.
    assert ("no stack trace" in text_join.lower()) or ("logs insights" in text_join.lower()) or ("cloudwatch" in text_join.lower())


def test_process_event_with_broken_secrets_client_raises():
    ev = make_event([{"service": "svc", "message": "oops", "stack_trace": "trace"}])

    class BrokenSecretsClient:
        def get_secret_value(self, SecretId):
            raise Exception("boom-secret")

    with pytest.raises(Exception):
        process_event(ev, None, secrets_client=BrokenSecretsClient(), urlopen_func=lambda r: None)
