from langgraph.graph import END, StateGraph

from agents.billing_agent import billing_node
from agents.dispute_agent import dispute_node, dispute_route_decision
from agents.escalation_agent import escalation_node
from agents.moderation import moderation_node
from agents.rag_agent import rag_node
from agents.router import route_decision, router_node
from agents.state import AgentState
from agents.testgen_agent import testgen_node

graph = StateGraph(AgentState)

graph.add_node("router", router_node)
graph.add_node("rag", rag_node)
graph.add_node("balance", billing_node)
graph.add_node("dispute", dispute_node)
graph.add_node("escalation", escalation_node)
graph.add_node("testgen", testgen_node)
graph.add_node("moderate", moderation_node)

graph.set_entry_point("router")
graph.add_conditional_edges(
    "router",
    route_decision,
    {
        "rag": "rag",
        "balance": "balance",
        "dispute": "dispute",
        "escalation": "escalation",
        "testgen": "testgen",
    },
)
graph.add_conditional_edges(
    "dispute", dispute_route_decision, {"escalation": "escalation", "moderate": "moderate"}
)

graph.add_edge("rag", "moderate")
graph.add_edge("balance", "moderate")
graph.add_edge("escalation", "moderate")
graph.add_edge("testgen", "moderate")
graph.add_edge("moderate", END)

app = graph.compile()

if __name__ == "__main__":
    result = app.invoke({"query": "What's my balance for 9876543210?"})
    print(result["moderated_answer"])
