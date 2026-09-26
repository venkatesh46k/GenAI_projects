"""Thin client for the billing API, shared by the console and the recharge flow.

Every function either returns data or raises ApiError with a message that is safe to show to a user.
"""
from typing import Any

import requests

from agents.utils import api_base


class ApiError(Exception):
    """The billing API could not be reached, or refused the request."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def base_url() -> str:
    return api_base()  # normalised: avoids the 2 s "localhost" IPv6 stall on Windows


def _detail(resp: requests.Response) -> str:
    try:
        return str(resp.json().get("detail", ""))
    except ValueError:
        return resp.text[:100]


def _request(method: str, path: str, **kwargs) -> Any:
    try:
        resp = requests.request(method, f"{base_url()}{path}", timeout=10, **kwargs)
    except requests.exceptions.RequestException as exc:
        raise ApiError("The billing system is temporarily unavailable. Please try again.") from exc
    if resp.status_code == 404:
        # The API says "Subscriber not found" for an unknown number; any other 404 is a missing route, which
        # must not be reported as a customer problem (it means the API is outdated or misconfigured).
        detail = _detail(resp)
        if detail == "Subscriber not found":
            raise ApiError("No subscriber found for this number", 404)
        raise ApiError(f"The billing API does not support this request ({method} {path}: {detail}).", 404)
    if not resp.ok:
        raise ApiError("The billing system could not complete the request", resp.status_code)
    return resp.json()


def list_subscribers() -> list[dict]:
    return _request("GET", "/subscribers")


def get_balance(msisdn: str) -> dict:
    return _request("GET", f"/balance/{msisdn}")


def get_plan(plan_id: str) -> dict:
    return _request("GET", f"/plans/{plan_id}")


def get_cdrs(msisdn: str, limit: int = 20) -> list[dict]:
    return _request("GET", f"/cdr/{msisdn}", params={"limit": limit})


def get_transactions(msisdn: str, limit: int = 20) -> list[dict]:
    return _request("GET", f"/transactions/{msisdn}", params={"limit": limit})


def get_disputes(msisdn: str) -> list[dict]:
    return _request("GET", "/disputes", params={"msisdn": msisdn})


def recharge(msisdn: str, amount: float, plan_id: str | None) -> dict:
    return _request("POST", "/recharge", json={"msisdn": msisdn, "amount": amount, "plan_id": plan_id})


def escalate(dispute_id: str) -> dict:
    return _request("POST", f"/dispute/{dispute_id}/escalate")
