"""Write the AI service's OpenAPI document to contracts/ai-service.openapi.json.

The TypeScript clients generate their types from that file, so re-run this whenever ai_service/schemas.py or the
endpoints change (a test fails if the committed file is stale):

    python -m ai_service.export_openapi
"""
import json
import os

from ai_service.main import create_app

PATH = os.path.join(os.path.dirname(__file__), "..", "contracts", "ai-service.openapi.json")


def render() -> str:
    return json.dumps(create_app(warm_up=False).openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    with open(PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(render())
    print(f"wrote {os.path.abspath(PATH)}")
