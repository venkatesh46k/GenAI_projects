"""Capture the README screenshots of the console with the Playwright MCP client (headless).

Needs the billing API (:8000) and the console (`streamlit run ui/chat_app.py --server.port 8502`).
The recharge steps make a real recharge, so re-seed afterwards: python -m mock_api.seed

    python docs/capture_screenshots.py                            # the static views -> docs/images/*.png
    python docs/capture_screenshots.py --skip-static --copilot "question" --name 08_copilot
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests_qa.mcp_client import MCPClient  # noqa: E402

URL = os.getenv("CONSOLE_URL", "http://localhost:8502")
OUT = os.path.join(os.path.dirname(__file__), "images")
PREMIUM, BASIC, BARRED = "9123456780", "9876543210", "9988776655"


async def pick_customer(c: MCPClient, msisdn: str) -> None:
    await c.select(".st-key-customer", msisdn)
    await c.wait_for_text(msisdn)


async def open_view(c: MCPClient, name: str) -> None:
    await c.click(f'[data-testid="stSidebar"] label:has-text("{name}")')


async def ask_copilot(c: MCPClient, question: str, name: str) -> str | None:
    """Type a question into the Copilot and capture the answer (a local LLM can take minutes on the first one)."""
    await c.fill('[data-testid="stChatInputTextArea"]', question)
    await c.wait_for_text("Working on it")  # the spinner appears...
    await c.wait_until_gone("Working on it")  # ...and disappearing means the answer text is on screen
    await c.wait_until_gone("Stop")  # Streamlit's running indicator: gone once details and images are drawn too
    await c._call("browser_wait_for", time=2)
    return await c.screenshot(name)


async def main(copilot: list[str], name: str, skip_static: bool) -> None:
    # Copilot answers can take minutes, so raise the per-action timeout far above the 5 s default.
    async with MCPClient(evidence_dir=OUT, settle_seconds=1.0, action_timeout_ms=600_000) as c:
        await c._call("browser_resize", width=1440, height=900)
        await c.navigate(URL)
        await c._call("browser_wait_for", time=8)  # a cold Streamlit session takes a few seconds to draw
        await c.wait_for_text("Balance")
        shots = {}
        if skip_static:
            await pick_customer(c, BASIC)
            await open_view(c, "Copilot")
            await c.wait_for_text("Try one of these")
            for i, question in enumerate(copilot):
                shots[f"{name}_{i + 1}"] = await ask_copilot(c, question, f"{name}_{i + 1}")
            for label, path in shots.items():
                print(f"{label}: {path}")
            return

        shots["01_customer_360"] = await c.screenshot("01_customer_360")

        await pick_customer(c, BASIC)
        await c.wait_for_text("Disputes (1)")  # only present once this customer's data has been drawn
        await c.click('[role="tab"]:has-text("Disputes")')
        shots["02_customer_disputes"] = await c.screenshot("02_customer_disputes")

        await pick_customer(c, BARRED)
        await c.wait_for_text("This number is barred")
        shots["03_customer_barred"] = await c.screenshot("03_customer_barred")

        await pick_customer(c, BASIC)
        await open_view(c, "Recharge")
        await c.wait_for_text("Mobile number")
        await c.fill(".st-key-amount_input input", "199")
        shots["04_recharge_form"] = await c.screenshot("04_recharge_form")
        await c.click(".st-key-continue_btn button")
        await c.wait_for_text("Confirm your recharge")
        shots["05_recharge_confirm"] = await c.screenshot("05_recharge_confirm")
        await c.click(".st-key-confirm_btn button")
        await c.wait_for_text("Recharge successful")
        shots["06_recharge_receipt"] = await c.screenshot("06_recharge_receipt")

        await open_view(c, "Copilot")
        await c.wait_for_text("Try one of these")
        shots["07_copilot_empty"] = await c.screenshot("07_copilot_empty")

        for i, question in enumerate(copilot):
            shots[f"{name}_{i + 1}"] = await ask_copilot(c, question, f"{name}_{i + 1}")

        for name, path in shots.items():
            print(f"{name}: {path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--copilot", action="append", default=[], help="ask the Copilot this question (repeatable)")
    parser.add_argument("--name", default="08_copilot", help="file name prefix for the Copilot screenshots")
    parser.add_argument("--skip-static", action="store_true", help="only the Copilot questions, not the other views")
    args = parser.parse_args()
    asyncio.run(main(args.copilot, args.name, args.skip_static))
