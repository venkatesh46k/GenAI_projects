"""End-to-end: run every scenario in a real browser through the Playwright MCP server.

Needs the billing API, the console (built front end) and Node.js; skipped (not failed) when they are not available:

    cd web && npm run build
    cd services/billing && npm run seed && npm run serve       # billing API :8000, console :8080
    pytest tests_qa/test_scenarios_e2e.py
"""
import shutil

import pytest

from tests_qa.run_agent_tests import _preflight, execute_scenario
from tests_qa.scenarios import SCENARIOS

pytestmark = pytest.mark.e2e

_unavailable = None if shutil.which("npx") or shutil.which("npx.cmd") else "npx (Node.js) not installed"
_unavailable = _unavailable or _preflight()


@pytest.mark.skipif(_unavailable is not None, reason=str(_unavailable))
@pytest.mark.parametrize("scenario", SCENARIOS, ids=[s["scenario_name"] for s in SCENARIOS])
def test_scenario_passes_in_a_real_browser(scenario):
    result = execute_scenario(scenario)
    assert result["status"] == "pass", result["detail"]
    assert result["evidence_path"], "a passing run must leave screenshot evidence"
