"""Offline tests for chunk headers (no embedding model needed)."""
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from rag.ingest import add_title_headers, doc_title

BASIC = "# Basic 199 Plan (PLAN_199)\n\nIntro text.\n\n## Benefits and limits\n\n- **Data:** 1.5 GB per day.\n"
PREMIUM = "# Premium 599 Plan (PLAN_599)\n\nIntro text.\n\n## Benefits and limits\n\n- **Data:** 2.5 GB per day.\n"


def split(*texts, size=60):
    docs = [Document(page_content=t, metadata={"source": f"doc{i}.md"}) for i, t in enumerate(texts)]
    splitter = RecursiveCharacterTextSplitter(chunk_size=size, chunk_overlap=0)
    return docs, splitter.split_documents(docs)


def test_doc_title_uses_first_h1_else_the_fallback():
    assert doc_title(BASIC, "x.md") == "Basic 199 Plan (PLAN_199)"
    assert doc_title("no heading here", "faq.md") == "faq.md"


def test_the_bug_without_headers_a_benefits_chunk_names_no_plan():
    """Reproduces the failure the eval suite caught: the numbers survive, the plan name does not."""
    _, chunks = split(BASIC, PREMIUM)
    benefit_chunks = [c for c in chunks if "GB per day" in c.page_content]
    assert benefit_chunks and not any("Basic" in c.page_content or "Premium" in c.page_content for c in benefit_chunks)


def test_every_chunk_names_its_own_document():
    docs, chunks = split(BASIC, PREMIUM)
    chunks = add_title_headers(docs, chunks)
    for chunk in chunks:
        expected = "Basic 199" if chunk.metadata["source"] == "doc0.md" else "Premium 599"
        assert expected in chunk.page_content, chunk.page_content


def test_benefit_numbers_are_attributed_to_the_right_plan():
    docs, chunks = split(BASIC, PREMIUM)
    by_number = {c.metadata["source"]: c.page_content for c in add_title_headers(docs, chunks) if "GB per day" in c.page_content}
    assert "Basic 199" in by_number["doc0.md"] and "1.5 GB" in by_number["doc0.md"]
    assert "Premium 599" in by_number["doc1.md"] and "2.5 GB" in by_number["doc1.md"]


def test_first_chunk_is_not_given_a_duplicate_header():
    docs, chunks = split(BASIC, size=400)
    chunks = add_title_headers(docs, chunks)
    assert chunks[0].page_content.startswith("# Basic 199 Plan") and "[Document:" not in chunks[0].page_content
