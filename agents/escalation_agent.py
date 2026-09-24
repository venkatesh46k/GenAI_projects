import requests

from agents.llm import get_llm
from agents.state import AgentState
from agents.utils import api_base
from rag.retriever import cached_retriever

ESCALATION_PROMPT = """You are confirming an escalation to a human billing specialist. Given the
dispute reason and the new ticket ID, write a short, reassuring confirmation message
to the subscriber, including the ticket ID and a realistic expected resolution window
(refer to the SOP context for the correct SLA: the resolution window for escalated
disputes, not the first-response time). Output only the message itself, addressed to
the subscriber, with no preamble or commentary, no quotation marks, and no signature or
placeholders such as [Your Name].

SOP CONTEXT:
{context}

DISPUTE REASON: {reason}
TICKET ID: {ticket_id}"""


def escalation_node(state: AgentState) -> dict:
    dispute_id = state.get("dispute_id")
    query = state["query"]
    tool_calls = list(state.get("tool_calls") or [])

    try:
        if not dispute_id:
            # Direct escalation request ("I want to speak to a manager"): register a dispute first.
            msisdn = state.get("msisdn")
            if not msisdn:
                return {
                    "raw_answer": "I can escalate this for you. Could you share the 10-digit mobile number "
                    "your complaint relates to?"
                }
            created = requests.post(
                f"{api_base()}/dispute",
                json={"msisdn": msisdn, "reason": query, "amount_disputed": 0.0},
                timeout=5,
            )
            created.raise_for_status()
            dispute_id = created.json()["dispute_id"]
            tool_calls.append({"endpoint": "/dispute", "msisdn": msisdn, "dispute_id": dispute_id})

        resp = requests.post(f"{api_base()}/dispute/{dispute_id}/escalate", timeout=5)
        resp.raise_for_status()
        ticket_id = resp.json()["ticket_id"]
    except requests.exceptions.RequestException:
        return {"raw_answer": "I couldn't escalate right now, please try again shortly."}

    tool_calls.append({"endpoint": "/dispute/escalate", "dispute_id": dispute_id, "ticket_id": ticket_id})

    docs = cached_retriever().invoke("dispute escalation SLA resolution timeline")
    context = "\n\n".join(d.page_content for d in docs)
    answer = get_llm().invoke(
        ESCALATION_PROMPT.format(context=context, reason=query, ticket_id=ticket_id)
    ).content
    return {
        "raw_answer": answer,
        "dispute_id": dispute_id,
        "escalation_ticket_id": ticket_id,
        "tool_calls": tool_calls,
    }
