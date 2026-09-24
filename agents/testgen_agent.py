from agents.llm import get_llm
from agents.state import AgentState
from agents.utils import parse_json

TESTGEN_PROMPT = """Convert this plain-English QA requirement into a structured test scenario.
Respond as JSON only, matching this schema exactly:
{{
  "scenario_name": "string",
  "target_page": "recharge | confirmation | receipt",
  "steps": [
    {{"action": "navigate|fill|click|read_text", "target": "css selector or url", "value": "string or null"}}
  ],
  "assertion": {{"target": "css selector", "expected_contains": "string"}}
}}

REQUIREMENT: {requirement}"""

REQUIRED_KEYS = {"scenario_name", "target_page", "steps", "assertion"}
VALID_ACTIONS = {"navigate", "fill", "click", "read_text"}


def is_valid_scenario(scenario) -> bool:
    if not isinstance(scenario, dict) or not REQUIRED_KEYS <= scenario.keys():
        return False
    steps = scenario["steps"]
    assertion = scenario["assertion"]
    return (
        isinstance(steps, list)
        and bool(steps)
        and all(isinstance(s, dict) and s.get("action") in VALID_ACTIONS for s in steps)
        and isinstance(assertion, dict)
        and {"target", "expected_contains"} <= assertion.keys()
    )


def testgen_node(state: AgentState) -> dict:
    raw = get_llm().invoke(TESTGEN_PROMPT.format(requirement=state["query"])).content
    scenario = parse_json(raw)

    if not is_valid_scenario(scenario):
        return {
            "raw_answer": "I couldn't turn that into a runnable test scenario. Try rephrasing it more concretely."
        }

    # Imported lazily: the executor (Phase 7) pulls in the MCP client, which chat-only paths don't need.
    from tests_qa.run_agent_tests import execute_scenario

    result = execute_scenario(scenario)
    return {
        "test_scenario": scenario,
        "test_result": result,
        "raw_answer": f"Test '{scenario['scenario_name']}': {result['status']}. {result.get('detail', '')}",
    }
