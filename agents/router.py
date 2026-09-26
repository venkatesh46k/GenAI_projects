import re

from agents.llm import get_llm
from agents.state import AgentState

# Order matters: escalation and dispute are checked before balance so that
# "I want to dispute my recharge" does not match the balance keyword first.
ROUTES = [
    ("escalation", re.compile(r"\b(escalate|manager|complaint|file a case|supervisor)\b", re.I)),
    (
        "dispute",
        re.compile(
            r"\b(dispute|wrong charge|overcharg\w*|refund\w*|incorrect (bill|charge)"
            r"|charged (twice|double|extra|wrongly|incorrectly)|double[- ]charg\w*|deducted (without|wrongly))\b",
            re.I,
        ),
    ),
    ("testgen", re.compile(r"\b(test|verify|check that|make sure .* works|validate the (ui|flow|page))\b", re.I)),
    # Process and policy questions ("what happens when the balance is low?", "how does a recharge get applied?") mention
    # balance/recharge but want the knowledge base, not a lookup. Not when a number is given: that is about a subscriber.
    (
        "rag",
        re.compile(
            r"^(?!.*\b\d{10}\b)\s*(what happens (when|if)|what if|how (does|do|long|is|are)|when (does|do)|why (does|do))\b",
            re.I,
        ),
    ),
    # "my plan" / "my account" are deliberately not keywords: "when does my plan expire?" is a policy
    # question. Those ambiguous phrasings fall through to the LLM classifier instead.
    ("balance", re.compile(r"\b(balance|recharge|top ?up|plan details)\b", re.I)),
]

MSISDN_PATTERN = re.compile(r"\b(\d{10})\b")
LABELS = {"rag", "balance", "dispute", "escalation", "testgen"}

CLASSIFY_PROMPT = """You are a strict intent classifier for a prepaid telecom billing assistant.
Classify the user's query into exactly one label from this list:
- rag        : general questions about plans, rating rules, CDR, regulations, policies
- balance    : checking balance, recharging, plan details for a specific subscriber
- dispute    : billing disputes, wrong charges, refund requests
- escalation : explicit requests to escalate, speak to a manager, file a complaint
- testgen    : requests to test/verify/check that a feature or flow works correctly

Respond with ONLY the label, lowercase, no punctuation, no explanation.

USER QUERY: {query}"""


def regex_route(query: str):
    for label, pattern in ROUTES:
        if pattern.search(query):
            return label
    return None


def router_node(state: AgentState) -> dict:
    query = state["query"]
    match = MSISDN_PATTERN.search(query)
    # A number typed in the query wins; otherwise keep the one the caller supplied (e.g. the customer currently
    # open in the console), so "what's the balance?" works without repeating it.
    msisdn = match.group(1) if match else state.get("msisdn")

    label = regex_route(query)
    if label:
        return {"route": label, "route_method": "regex", "msisdn": msisdn}

    raw = get_llm().invoke(CLASSIFY_PROMPT.format(query=query)).content.strip().lower()
    label = raw if raw in LABELS else "rag"
    return {"route": label, "route_method": "llm", "msisdn": msisdn}


def route_decision(state: AgentState) -> str:
    return state["route"]
