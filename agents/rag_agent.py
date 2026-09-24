from agents.llm import get_llm
from agents.state import AgentState
from rag.retriever import cached_retriever

RAG_PROMPT = """You are a prepaid telecom billing assistant. Answer ONLY using the
provided context. If the context does not contain the answer, say clearly that you
don't have that information rather than guessing. Keep answers under 120 words.
Do not invent plan names, prices, or regulations not present in the context.

CONTEXT:
{context}

QUESTION: {query}"""


def rag_node(state: AgentState) -> dict:
    docs = cached_retriever().invoke(state["query"])
    chunks = [d.page_content for d in docs]
    answer = get_llm().invoke(
        RAG_PROMPT.format(context="\n\n".join(chunks), query=state["query"])
    ).content
    return {"raw_answer": answer, "retrieved_context": chunks}
