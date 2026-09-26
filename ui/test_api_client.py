"""api_client error mapping, with `requests` faked."""
import pytest
import requests

from ui import api_client


class Resp:
    def __init__(self, status, body=None, text=""):
        self.status_code, self._body, self.text = status, body, text
        self.ok = 200 <= status < 300

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


def fake(monkeypatch, response=None, error=None):
    def request(method, url, timeout, **kwargs):
        if error:
            raise error
        return response

    monkeypatch.setattr(api_client.requests, "request", request)


def test_success_returns_the_json(monkeypatch):
    fake(monkeypatch, Resp(200, {"balance": 1.0}))
    assert api_client.get_balance("9876543210") == {"balance": 1.0}


def test_unknown_subscriber_is_a_friendly_customer_message(monkeypatch):
    fake(monkeypatch, Resp(404, {"detail": "Subscriber not found"}))
    with pytest.raises(api_client.ApiError, match="No subscriber found") as exc:
        api_client.get_balance("0000000000")
    assert exc.value.status_code == 404


def test_a_missing_route_is_not_reported_as_a_customer_problem(monkeypatch):
    fake(monkeypatch, Resp(404, {"detail": "Not Found"}))
    with pytest.raises(api_client.ApiError) as exc:
        api_client.list_subscribers()
    assert "does not support this request" in str(exc.value) and "/subscribers" in str(exc.value)
    assert "No subscriber" not in str(exc.value)


def test_an_unreachable_api_is_reported_as_unavailable(monkeypatch):
    fake(monkeypatch, error=requests.exceptions.ConnectionError("refused"))
    with pytest.raises(api_client.ApiError, match="temporarily unavailable"):
        api_client.list_subscribers()


def test_other_errors_do_not_leak_details(monkeypatch):
    fake(monkeypatch, Resp(500, text="Traceback (most recent call last): secret internals"))
    with pytest.raises(api_client.ApiError) as exc:
        api_client.get_balance("9876543210")
    assert "Traceback" not in str(exc.value) and exc.value.status_code == 500
