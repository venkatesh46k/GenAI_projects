import os
from dotenv import load_dotenv
from langchain_ollama import ChatOllama
from langchain_anthropic import ChatAnthropic

load_dotenv()


def get_llm(env: str | None = None):
    env = env or os.getenv("ENV", "dev")
    if env == "demo":
        return ChatAnthropic(model="claude-sonnet-4-6")
    kwargs = {}
    # Optional escape hatch for flaky CUDA runners on small GPUs: OLLAMA_NUM_GPU=0 forces CPU-only.
    if os.getenv("OLLAMA_NUM_GPU"):
        kwargs["num_gpu"] = int(os.environ["OLLAMA_NUM_GPU"])
    return ChatOllama(model="llama3.1:8b", base_url=os.getenv("OLLAMA_HOST", "http://localhost:11434"), **kwargs)
