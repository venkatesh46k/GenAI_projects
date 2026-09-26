"""Request/response contract of the AI service. These models generate contracts/ai-service.openapi.json, which the
TypeScript clients (Node web tier, React) derive their types from: change them, re-export, and the types follow."""
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")  # an unknown field is a client bug, not something to ignore silently

    query: str = Field(min_length=1, max_length=2000, description="What the agent typed.")
    msisdn: str | None = Field(
        default=None,
        pattern=r"^\d{10}$",
        description="The customer open in the console, used as context when the question names no number.",
    )


class TestResult(BaseModel):
    __test__ = False  # not a pytest class, despite the name

    status: Literal["pass", "fail"]
    detail: str
    evidence_url: str | None = Field(default=None, description="Path to the screenshot, relative to this service.")
    steps_completed: int | None = None


class ChatResponse(BaseModel):
    answer: str = Field(description="The reply after moderation: safe to show to the agent.")
    route: str = Field(description="rag | balance | dispute | escalation | testgen")
    route_method: str = Field(description="regex | llm: how the route was decided.")
    pii_masked: bool
    safety_flag: str | None = Field(default=None, description="Set when the safety check blocked the reply.")
    tool_calls: list[dict[str, Any]] = Field(default_factory=list, description="Billing calls the agents made.")
    sources: list[str] = Field(default_factory=list, description="Knowledge-base passages the answer was built from.")
    dispute_id: str | None = None
    ticket_id: str | None = None
    test_result: TestResult | None = None


class StepEvent(BaseModel):
    """One `step` server-sent event: an agent node finished."""

    node: str
    message: str


class ErrorEvent(BaseModel):
    """The `error` server-sent event: the request failed; `detail` is safe to show."""

    detail: str


class HealthResponse(BaseModel):
    status: Literal["ok"]
    ready: bool = Field(description="False until the models have finished loading (the first minutes after start).")
    provider: str
    model: str
