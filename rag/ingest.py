import os
import shutil

from langchain_community.document_loaders import DirectoryLoader, TextLoader
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter

DOCS_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "docs")
PERSIST_DIR = os.path.join(os.path.dirname(__file__), "chroma_db")
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def ingest():
    loader = DirectoryLoader(
        DOCS_DIR, glob="**/*.md", loader_cls=TextLoader, loader_kwargs={"encoding": "utf-8"}
    )
    docs = loader.load()
    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
    chunks = splitter.split_documents(docs)

    # Rebuild from scratch so re-ingesting after doc edits never leaves stale chunks.
    if os.path.isdir(PERSIST_DIR):
        shutil.rmtree(PERSIST_DIR)

    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    Chroma.from_documents(chunks, embeddings, persist_directory=PERSIST_DIR)
    print(f"Indexed {len(chunks)} chunks from {len(docs)} documents into {PERSIST_DIR}")


if __name__ == "__main__":
    ingest()
