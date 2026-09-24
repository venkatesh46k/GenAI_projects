import os
from functools import lru_cache

from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma

PERSIST_DIR = os.path.join(os.path.dirname(__file__), "chroma_db")
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def get_retriever(k: int = 4):
    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    db = Chroma(persist_directory=PERSIST_DIR, embedding_function=embeddings)
    return db.as_retriever(search_kwargs={"k": k})


@lru_cache(maxsize=None)
def cached_retriever(k: int = 4):
    """Process-wide retriever so agents don't reload the embedding model on every call."""
    return get_retriever(k)
