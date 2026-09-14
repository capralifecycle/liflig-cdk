import json

import pytest

import main


class FakeUrlopen:
    def __init__(self):
        self.requests = []

    def __call__(self, request):
        self.requests.append(request)
        return None


@pytest.fixture
def urlopen(monkeypatch):
    fake = FakeUrlopen()
    monkeypatch.setattr(main.urllib.request, "urlopen", fake)
    return fake


def sqs_event(body):
    return {"Records": [{"body": json.dumps(body)}]}


def test_forwarder_posts_to_the_webhook_url_from_the_environment(monkeypatch, urlopen):
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/X")

    main.handler_slack_forwarder(sqs_event({"slackPayload": {"text": "hello"}}), None)

    [request] = urlopen.requests
    assert request.full_url == "https://hooks.slack.com/services/T/B/X"
    assert json.loads(request.data) == {"text": "hello"}


def test_forwarder_ignores_a_webhook_url_supplied_in_the_message(monkeypatch, urlopen):
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/X")

    main.handler_slack_forwarder(
        sqs_event(
            {
                "slackWebhookUrl": "https://attacker.example.com/collect",
                "slackPayload": {"text": "hello"},
            }
        ),
        None,
    )

    [request] = urlopen.requests
    assert request.full_url == "https://hooks.slack.com/services/T/B/X"


def test_post_to_slack_rejects_a_webhook_url_that_is_not_https(urlopen):
    with pytest.raises(ValueError):
        main.post_to_slack(
            {"text": "hello"}, "http://169.254.169.254/latest/meta-data/"
        )

    assert urlopen.requests == []


def test_event_transformer_does_not_put_the_webhook_url_on_the_queue(monkeypatch):
    sent = {}

    class FakeSqs:
        def send_message(self, **kwargs):
            sent.update(kwargs)

    monkeypatch.setattr(main.boto3, "client", lambda service: FakeSqs())
    monkeypatch.setenv("FRIENDLY_NAMES", "{}")
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/X")
    monkeypatch.setenv("SLACK_CHANNEL", "#example")
    monkeypatch.setenv("SQS_QUEUE_URL", "https://sqs.eu-west-1.amazonaws.com/1/q.fifo")
    monkeypatch.setenv("DEDUPLICATE_EVENTS", "true")

    main.handler_event_transformer(
        {
            "id": "event-id",
            "account": "123456789012",
            "detail-type": "AWS API Call via CloudTrail",
            "detail": {
                "eventID": "event-detail-id",
                "eventName": "SomeUnmappedEvent",
                "eventType": "AwsApiCall",
                "eventTime": "2026-01-01T00:00:00Z",
                "recipientAccountId": "123456789012",
                "userIdentity": {"type": "IAMUser"},
            },
        },
        None,
    )

    assert "slackWebhookUrl" not in json.loads(sent["MessageBody"])
