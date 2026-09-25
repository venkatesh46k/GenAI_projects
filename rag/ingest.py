import os
import re
import shutil

from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter

DOCS_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "docs")
PERSIST_DIR = os.path.join(os.path.dirname(__file__), "chroma_db")
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def doc_title(text: str, fallback: str) -> str:
    """The document's first H1 (e.g. "Premium 599 Plan (PLAN_599)"), else the file name."""
    match = re.search(r"^#\s+(.+)$", text, re.M)
    return match.group(1).strip() if match else fallback


def add_title_headers(docs, chunks):
    """Prefix every chunk with its source document's title.

    The splitter cuts a document into pieces that keep only their own section text, so a section like
    "Benefits and limits: Data 1.5 GB per day" no longer says which plan it belongs to. Two plan docs then
    look interchangeable and the LLM mixes them up (this produced swapped Basic/Premium answers, caught by
    the DeepEval suite). A title header keeps every chunk self-describing, and helps the embeddings too.
    """
    titles = {d.metadata["source"]: doc_title(d.page_content, os.path.basename(d.metadata["source"])) for d in docs}
    for chunk in chunks:
        title = titles[chunk.metadata["source"]]
        if not chunk.page_content.lstrip().startswith(f"# {title}"):  # the first chunk already carries it
            chunk.page_content = f"[Document: {title}]\n\n{chunk.page_content}"
    return chunks


def ingest():
    loader = DirectoryLoader(
        DOCS_DIR, glob="**/*.md", loader_cls=TextLoader, loader_kwargs={"encoding": "utf-8"}
    )
    docs = loader.load()
    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
    chunks = add_title_headers(docs, splitter.split_documents(docs))

    # Rebuild from scratch so re-ingesting after doc edits never leaves stale chunks.
    if os.path.isdir(PERSIST_DIR):
        shutil.rmtree(PERSIST_DIR)

    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    Chroma.from_documents(chunks, embeddings, persist_directory=PERSIST_DIR)
    print(f"Indexed {len(chunks)} chunks from {len(docs)} documents into {PERSIST_DIR}")


if __name__ == "__main__":
    ingest()
