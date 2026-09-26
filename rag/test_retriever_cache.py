"""cached_retriever must build exactly one retriever even when many threads ask at the same instant."""
import threading
import time

from rag import retriever


def test_concurrent_first_calls_build_the_retriever_once(monkeypatch):
    monkeypatch.setattr(retriever, "_retrievers", {})
    built = []

    def slow_get_retriever(k):
        built.append(k)
        time.sleep(0.2)  # long enough for every thread to arrive while the first is still building
        return object()

    monkeypatch.setattr(retriever, "get_retriever", slow_get_retriever)
    results, barrier = [], threading.Barrier(8)

    def worker():
        barrier.wait()
        results.append(retriever.cached_retriever())

    threads = [threading.Thread(target=worker) for _ in range(8)]
    [t.start() for t in threads]
    [t.join() for t in threads]

    assert built == [4], f"built {len(built)} retrievers"
    assert len({id(r) for r in results}) == 1  # every caller got the same instance


def test_different_k_values_are_cached_separately(monkeypatch):
    monkeypatch.setattr(retriever, "_retrievers", {})
    monkeypatch.setattr(retriever, "get_retriever", lambda k: ("retriever", k))
    assert retriever.cached_retriever(4) == ("retriever", 4)
    assert retriever.cached_retriever(2) == ("retriever", 2)
    assert retriever.cached_retriever(4) is retriever.cached_retriever(4)
