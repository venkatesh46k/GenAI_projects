"""Execute recharge-flow scenarios through the Playwright MCP server and report pass/fail with evidence.

    python -m tests_qa.run_agent_tests                    # all five scenarios
    python -m tests_qa.run_agent_tests valid_recharge_e2e # named ones
    python -m tests_qa.run_agent_tests --generate         # have the Test-Gen agent write the steps from the
                                                          # plain-English requirement, then run them
    python -m tests_qa.run_agent_tests --headed           # watch the browser

Needs: the billing API (BILLING_API_URL, default :8000), the console (RECHARGE_UI_URL, default :8080), Node.js.
`execute_scenario()` is also what the chat graph's testgen node calls.
"""
import argparse
import asyncio
import concurrent.futures
import os
import re
import sys

import requests

from agents.utils import api_base
from tests_qa.mcp_client import MCPClient, StepFailure
from tests_qa.scenarios import BY_NAME, SCENARIOS, SEL
from tests_qa.urls import is_allowed_navigation, recharge_ui_url

UI_URL_ENV = "RECHARGE_UI_URL"
PLACEHOLDER = re.compile(r"\{pre_balance(?:\s*\+\s*([\d.]+))?\}")
DEFAULT_MSISDN = "9876543210"
CUSTOMER_PAGE = re.compile(r"/customers/(\d{10})(?:\D|$)")


def contains(actual: str, expected: str) -> bool:
    """Whether the page text has the expected text. The console groups thousands (₹1,234.50); the numbers are compared
    without that grouping so a balance crossing 1,000 does not fail a passing flow."""
    return expected in actual or expected.replace(",", "") in actual.replace(",", "")


def ui_url() -> str:
    return recharge_ui_url()


def resolve(expression: str, pre_balance: float | None) -> str:
    """Fill `{pre_balance+N}` with the live balance plus N, to two decimals."""
    if not PLACEHOLDER.search(expression):
        return expression
    if pre_balance is None:
        raise ValueError("expected value uses {pre_balance}, but no subscriber balance could be read")
    return PLACEHOLDER.sub(lambda m: f"{pre_balance + float(m.group(1) or 0):.2f}", expression)


def infer_msisdn(scenario: dict) -> str:
    """The subscriber under test: scenario `setup`, else the number in the customer page the steps open."""
    if scenario.get("setup", {}).get("msisdn"):
        return scenario["setup"]["msisdn"]
    for step in scenario["steps"]:
        if step["action"] == "navigate" and (found := CUSTOMER_PAGE.search(step["target"])):
            return found.group(1)
    return DEFAULT_MSISDN


def fetch_balance(msisdn: str) -> float:
    resp = requests.get(f"{api_base()}/balance/{msisdn}", timeout=5)
    resp.raise_for_status()
    return float(resp.json()["balance"])


def _result(status: str, detail: str, evidence_path: str | None = None, **extra) -> dict:
    return {"status": status, "detail": detail, "evidence_path": evidence_path, **extra}


def _preflight() -> str | None:
    try:
        requests.get(f"{api_base()}/subscribers", timeout=3).raise_for_status()
    except requests.RequestException:
        return f"billing API not reachable at {api_base()} (cd services/billing && npm run serve)"
    try:
        if requests.get(f"{ui_url()}/api/health", timeout=3).json().get("status") != "ok":
            raise requests.RequestException("unhealthy")
    except (requests.RequestException, ValueError):
        return f"console not reachable at {ui_url()} (cd services/billing && npm run serve, with the built web/dist)"
    return None


async def _execute(scenario: dict, headless: bool = True) -> dict:
    name = scenario["scenario_name"]
    for step in scenario["steps"]:  # defence in depth: also refuse hand-written or otherwise unvalidated scenarios
        if step["action"] == "navigate" and not is_allowed_navigation(step["target"]):
            return _result("fail", f"navigation to {step['target']!r} is not allowed: tests may only visit {ui_url()}")
    if problem := _preflight():
        return _result("fail", problem)

    needs_balance = "setup" in scenario or "api_check" in scenario or PLACEHOLDER.search(str(scenario["assertion"]))
    msisdn = infer_msisdn(scenario)
    try:
        pre_balance = fetch_balance(msisdn) if needs_balance else None
    except (requests.RequestException, KeyError, ValueError):
        return _result("fail", f"could not read the starting balance for {msisdn} from the billing API")

    completed = 0
    async with MCPClient(headless=headless) as client:
        try:
            for step in scenario["steps"]:
                await client.perform(step["action"], step.get("target"), step.get("value"))
                completed += 1

            expected = resolve(scenario["assertion"]["expected_contains"], pre_balance)
            actual = await client.read_text(scenario["assertion"]["target"])
            evidence = await client.screenshot(name)
            if not contains(actual, expected):
                return _result("fail", f"Expected {expected!r} in {actual!r}", evidence, steps_completed=completed)

            detail = f"Expected {expected!r} found in {actual!r}"
            if check := scenario.get("api_check"):
                wanted = float(resolve(check["balance_equals"], pre_balance))
                actual_balance = fetch_balance(msisdn)
                if abs(actual_balance - wanted) > 0.005:
                    return _result(
                        "fail", f"API balance {actual_balance:.2f} != expected {wanted:.2f} (double charge?)",
                        evidence, steps_completed=completed,
                    )
                detail += f"; API balance {actual_balance:.2f} matches"
            return _result("pass", detail, evidence, steps_completed=completed)

        except StepFailure as exc:
            evidence = await client.screenshot(f"{name}_failure")
            return _result("fail", f"step {completed + 1} failed: {exc}", evidence, steps_completed=completed)
        except (ValueError, requests.RequestException) as exc:
            return _result("fail", f"could not evaluate the scenario: {exc}", steps_completed=completed)


def run_in_fresh_loop(coroutine_factory):
    """Run a coroutine on its own event loop in a worker thread, whatever the host's asyncio policy is.

    Why not asyncio.run(): the MCP client spawns the Playwright server as a subprocess, and on Windows only the
    Proactor loop can do that. Streamlit's server (Tornado) switches the process to a Selector loop, where
    subprocess creation raises NotImplementedError, so browser tests worked from a script but silently failed when
    triggered from the console. An explicit loop in a dedicated thread also works when called from a thread that is
    already running an event loop.
    """

    def run():
        loop = asyncio.ProactorEventLoop() if sys.platform == "win32" else asyncio.new_event_loop()
        try:
            return loop.run_until_complete(coroutine_factory())
        finally:
            loop.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(run).result()


def execute_scenario(scenario: dict, headless: bool = True) -> dict:
    """Run one scenario; never raises. Safe from any thread and under any asyncio policy."""
    try:
        return run_in_fresh_loop(lambda: _execute(scenario, headless))
    except Exception as exc:  # the MCP server failed to start, Node missing, ...
        return _result("fail", f"execution error: {type(exc).__name__}: {exc}")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("names", nargs="*", help="scenario names (default: all)")
    parser.add_argument("--generate", action="store_true", help="have the Test-Gen agent write the steps")
    parser.add_argument("--headed", action="store_true", help="show the browser")
    args = parser.parse_args(argv)

    unknown = [n for n in args.names if n not in BY_NAME]
    if unknown:
        print(f"unknown scenario(s): {unknown}; available: {list(BY_NAME)}")
        return 2
    chosen = [BY_NAME[n] for n in args.names] or SCENARIOS

    failures = 0
    for scenario in chosen:
        run = scenario
        if args.generate:
            from agents.testgen_agent import generate_scenario

            run = generate_scenario(scenario["requirement"])
            if run is None:
                print(f"FAIL {scenario['scenario_name']}: the Test-Gen agent could not produce a valid scenario")
                failures += 1
                continue
        result = execute_scenario(run, headless=not args.headed)
        failures += result["status"] != "pass"
        print(f"{result['status'].upper():4} {run['scenario_name']}: {result['detail']}")
        if result.get("evidence_path"):
            print(f"     evidence: {result['evidence_path']}")
    print(f"\n{len(chosen) - failures}/{len(chosen)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
