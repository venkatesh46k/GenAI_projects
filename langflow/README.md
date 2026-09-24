# Langflow prototype

Visual prototype of the RAG chain: Chat Input -> Chroma DB (Ollama `all-minilm` embeddings) -> Parser -> Prompt Template -> Ollama `llama3.1:8b` -> Chat Output.

- `billing_copilot_flow.json` - exported flow (import via Langflow -> Import)
- `flow_screenshot.png` - canvas screenshot
- `build_langflow_index.py` - builds the Chroma index the flow reads

Langflow has no local sentence-transformers embeddings component, so the flow uses Ollama's `all-minilm` (same MiniLM-L6-v2 model) against its own index, separate from `rag/chroma_db`.

## Run
1. `ollama pull all-minilm llama3.1:8b`
2. `python langflow/build_langflow_index.py` (from the repo root, project venv)
3. In a separate venv: `pip install langflow`, then `langflow run`
4. Import the JSON and set the Chroma **Persist Directory** to your local `langflow/chroma_db_langflow` path (the exported path is machine-specific).
