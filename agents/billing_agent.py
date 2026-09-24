import requests

from agents.llm import get_llm
from agents.state import AgentState
from agents.utils import api_base

RESPONSE_PROMPT = """You are a prepaid billing assistant. Given this raw API response,
write a short, friendly, factual answer to the user's question. Do not add information
not present in the API response.

API RESPONSE (JSON): {api_response}
USER QUESTION: {query}"""


def billing_node(state: AgentState) -> dict:
    msisdn = state.get("msisdn")
    if not msisdn:
        return {"raw_answer": "Could you share the 10-digit mobile number you'd like me to check?"}

    try:
        resp = requests.get(f"{api_base()}/balance/{msisdn}", timeout=5)
        if resp.status_code == 404:
            return {"raw_answer": f"I couldn't find a subscriber with number {msisdn}."}
        resp.raise_for_status()
        data = resp.json()
    except requests.exceptions.RequestException:
        return {"raw_answer": "The billing system is temporarily unavailable. Please try again shortly."}

    answer = get_llm().invoke(RESPONSE_PROMPT.format(api_response=data, query=state["query"])).content
    return {"raw_answer": answer, "tool_calls": [{"endpoint": "/balance", "msisdn": msisdn}]}
