"""Execute recharge-flow scenarios through the Playwright MCP server and report pass/fail with evidence.

    python -m tests_qa.run_agent_tests                    # all five scenarios
    python -m tests_qa.run_agent_tests valid_recharge_e2e # named ones
    python -m tests_qa.run_agent_tests --generate         # have the Test-Gen agent write the steps from the
                                                          # plain-English requirement, then run them
    python -m tests_qa.run_agent_tests --headed           # watch the browser

Needs: the billing API (FASTAPI_BASE_URL, default :8000), the recharge UI (RECHARGE_UI_URL, default :8501), Node.js.
`execute_scenario()` is also what the chat graph's testgen node calls.
"""
import argparse
import asyncio
import concurrent.futures
import os
import re
import sys

import requests

from tests_qa.mcp_client import MCPClient, StepFailure
from tests_qa.scenarios import BY_NAME, SCENARIOS, SEL

API_BASE_ENV, UI_URL_ENV = "FASTAPI_BASE_URL", "RECHARGE_UI_URL"
PLACEHOLDER = re.compile(r"\{pre_balance(?:\s*\+\s*([\d.]+))?\}")
DEFAULT_MSISDN = "9876543210"


def api_base() -> str:
    return os.getenv(API_BASE_ENV, "http://localhost:8000")


def ui_url() -> str:
    return os.getenv(UI_URL_ENV, "http://localhost:8501")


def resolve(expression: str, pre_balance: float | None) -> str:
    """Fill `{pre_balance+N}` with the live balance plus N, to two decimals."""
    if not PLACEHOLDER.search(expression):
        return expression
    if pre_balance is None:
        raise ValueError("expected value uses {pre_balance}, but no subscriber balance could be read")
    return PLACEHOLDER.sub(lambda m: f"{pre_balance + float(m.group(1) or 0):.2f}", expression)


def infer_msisdn(scenario: dict) -> str:
    """The subscriber under test: scenario `setup`, else whatever the steps type into the number field."""
    if scenario.get("setup", {}).get("msisdn"):
        return scenario["setup"]["msisdn"]
    for step in scenario["steps"]:
        if step["action"] == "fill" and step["target"] == SEL["msisdn"] and re.fullmatch(r"\d{10}", step.get("value") or ""):
            return step["value"]
    return DEFAULT_MSISDN


def fetch_balance(msisdn: str) -> float:
    resp = requests.get(f"{api_base()}/balance/{msisdn}", timeout=5)
    resp.raise_for_status()
    return float(resp.json()["balance"])


def _result(status: str, detail: str, evidence_path: str | None = None, **extra) -> dict:
    return {"status": status, "detail": detail, "evidence_path": evidence_path, **extra}


def _preflight() -> str | None:
    try:
        requests.get(f"{api_base()}/docs", timeout=3)
    except requests.RequestException:
        return f"billing API not reachable at {api_base()} (uvicorn mock_api.main:app --port 8000)"
    try:
        if requests.get(f"{ui_url()}/_stcore/health", timeout=3).text.strip() != "ok":
            raise requests.RequestException("unhealthy")
    except requests.RequestException:
        return f"recharge UI not reachable at {ui_url()} (streamlit run ui/recharge_app.py --server.port 8501)"
    return None


async def _execute(scenario: dict, headless: bool = True) -> dict:
    name = scenario["scenario_name"]
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
            if expected not in actual:
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


def execute_scenario(scenario: dict, headless: bool = True) -> dict:
    """Run one scenario; never raises. Safe to call from a running event loop or from plain sync code."""
    try:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(_execute(scenario, headless))
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, _execute(scenario, headless)).result()
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
