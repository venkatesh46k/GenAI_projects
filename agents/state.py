from typing import Literal, Optional, TypedDict


class AgentState(TypedDict, total=False):
    query: str
    msisdn: Optional[str]
    route: Literal["rag", "balance", "dispute", "escalation", "testgen"]
    route_method: Literal["regex", "llm"]
    retrieved_context: Optional[list]
    raw_answer: Optional[str]
    moderated_answer: Optional[str]
    pii_masked: bool
    safety_flag: Optional[str]
    tool_calls: list
    dispute_id: Optional[str]
    dispute_confidence: Optional[float]
    escalation_ticket_id: Optional[str]
    test_scenario: Optional[dict]
    test_result: Optional[dict]
