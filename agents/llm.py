import os
from dotenv import load_dotenv
from langchain_ollama import ChatOllama
from langchain_anthropic import ChatAnthropic

load_dotenv()


def get_llm(env: str | None = None):
    env = env or os.getenv("ENV", "dev")
    if env == "demo":
        return ChatAnthropic(model="claude-sonnet-4-6")
    return ChatOllama(model="llama3.1:8b", base_url=os.getenv("OLLAMA_HOST", "http://localhost:11434"))
