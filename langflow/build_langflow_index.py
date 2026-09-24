"""Build a Chroma index for the Langflow prototype.

Langflow has no local sentence-transformers embeddings component, so the flow uses
Ollama Embeddings with `all-minilm` (the same MiniLM-L6-v2 model, served by Ollama).
Chunking mirrors rag/ingest.py. Kept separate from rag/chroma_db so the main index is untouched.

Run from the repo root:  python -m langflow.build_langflow_index
"""
import os
import shutil

from langchain_chroma import Chroma
from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_ollama import OllamaEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

ROOT = os.path.join(os.path.dirname(__file__), "..")
DOCS_DIR = os.path.join(ROOT, "data", "docs")
PERSIST_DIR = os.path.join(ROOT, "langflow", "chroma_db_langflow")
COLLECTION = "billing_docs"


def build():
    docs = DirectoryLoader(
        DOCS_DIR, glob="**/*.md", loader_cls=TextLoader, loader_kwargs={"encoding": "utf-8"}
    ).load()
    chunks = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100).split_documents(docs)

    if os.path.isdir(PERSIST_DIR):
        shutil.rmtree(PERSIST_DIR)
    Chroma.from_documents(
        chunks,
        OllamaEmbeddings(model="all-minilm"),
        collection_name=COLLECTION,
        persist_directory=PERSIST_DIR,
    )
    print(f"Indexed {len(chunks)} chunks into {PERSIST_DIR} (collection '{COLLECTION}')")


if __name__ == "__main__":
    build()
