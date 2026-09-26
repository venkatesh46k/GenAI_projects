import os
import threading

from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma

PERSIST_DIR = os.path.join(os.path.dirname(__file__), "chroma_db")
EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def get_retriever(k: int = 4):
    embeddings = HuggingFaceEmbeddings(model_name=EMBEDDING_MODEL)
    db = Chroma(persist_directory=PERSIST_DIR, embedding_function=embeddings)
    return db.as_retriever(search_kwargs={"k": k})


_retrievers: dict = {}
_lock = threading.Lock()


def cached_retriever(k: int = 4):
    """Process-wide retriever so agents don't reload the embedding model on every call.

    Thread-safe on purpose: a threaded server (uvicorn's worker threads) can make two first calls at once, and two Chroma clients for
    the same folder tear each other down ("RustBindingsAPI has no attribute 'bindings'"). functools.lru_cache does not
    prevent that, because it does not lock while the function runs.
    """
    with _lock:
        if k not in _retrievers:
            _retrievers[k] = get_retriever(k)
        return _retrievers[k]
