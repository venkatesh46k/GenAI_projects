"""Capture the README screenshots of the console with the Playwright MCP client (headless, 1440x900).

Start everything first with `python scripts/dev.py --reseed`. The recharge steps and the browser-test question make real
recharges, so reseed afterwards (`python scripts/dev.py --reseed`, or `npm run seed` in services/billing).

    python docs/capture_screenshots.py                  # every view -> docs/images/*.png
    python docs/capture_screenshots.py --no-copilot     # skip the Copilot questions (they need the LLM and take minutes)
    CONSOLE_URL=http://localhost:8080 python docs/capture_screenshots.py
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests_qa.mcp_client import MCPClient  # noqa: E402

URL = os.getenv("CONSOLE_URL", "http://localhost:8080")
OUT = os.path.join(os.path.dirname(__file__), "images")
BASIC, BARRED = "9876543210", "9988776655"

POLICY_QUESTION = "What happens when the balance goes below ₹5?"
TEST_QUESTION = "Verify that the confirmation page shows exactly the amount 599 that was entered on the recharge page."


def tid(name: str) -> str:
    return f'[data-testid="{name}"]'


async def set_theme(c: MCPClient, theme: str) -> None:
    await c.click(tid("theme-toggle"))
    await c.click(tid(f"theme-{theme}"))


async def ask(c: MCPClient, question: str, done_text: str, name: str) -> str | None:
    """Send a question to the open Copilot and capture the moment the answer (with its badge) is on screen."""
    await c.fill(tid("copilot-input"), question)
    await c.click(tid("copilot-send"))
    await c.wait_for_text(done_text)
    await c._call("browser_wait_for", time=2)  # let the screenshot image and sources finish drawing
    return await c.screenshot(name)


async def main(copilot: bool) -> None:
    # A Copilot answer can take minutes on a cold start, so the per-action timeout is far above the 5 s default.
    async with MCPClient(evidence_dir=OUT, settle_seconds=0.8, action_timeout_ms=600_000) as c:
        await c._call("browser_resize", width=1440, height=900)
        shots: dict[str, str | None] = {}

        await c.navigate(f"{URL}/customers/{BASIC}")
        await c.wait_for_text("Sign in to look up customers")
        shots["01_login"] = await c.screenshot("01_login")
        await c.fill("#name", "Priya Sharma")
        await c.click('label:has-text("Team lead")')  # so the role-gated pages (Plans) show the active buttons too
        await c.click(tid("login-submit"))
        # Signing in from a customer-page URL returns there, not to /dashboard; visit it explicitly for the shot.
        await c.navigate(f"{URL}/dashboard")
        await c.wait_for_text("Today, at a glance.")
        await c._call("browser_wait_for", time=1)  # let the KPIs and the chart finish loading
        shots["00_dashboard"] = await c.screenshot("00_dashboard")

        await c.navigate(f"{URL}/customers/{BASIC}")
        await c.wait_for_text("Prepaid subscriber")
        shots["03_customer_360"] = await c.screenshot("03_customer_360")

        await c.click(tid("tab-disputes"))
        shots["04_customer_disputes"] = await c.screenshot("04_customer_disputes")

        await c.navigate(f"{URL}/customers")
        await c.wait_for_text("Total balance")
        shots["02_customers"] = await c.screenshot("02_customers")

        await c.navigate(f"{URL}/customers/{BARRED}")
        await c.wait_for_text("This number is barred")
        shots["05_customer_barred"] = await c.screenshot("05_customer_barred")

        await c._call("browser_press_key", key="Control+k")
        await c.wait_for_text("Appearance")
        shots["06_command_palette"] = await c.screenshot("06_command_palette")
        await c._call("browser_press_key", key="Escape")

        await c.navigate(f"{URL}/customers/{BASIC}")
        await c.wait_for_text("Prepaid subscriber")
        await c.click(tid("open-recharge"))
        await c.wait_for_text("Add balance to")
        await c.fill(tid("recharge-amount"), "199")
        shots["07_recharge_details"] = await c.screenshot("07_recharge_details")
        await c.click(tid("recharge-continue"))
        await c.wait_for_text("Confirm recharge")
        shots["08_recharge_review"] = await c.screenshot("08_recharge_review")
        await c.click(tid("recharge-confirm"))
        await c.wait_for_text("Recharge successful")
        shots["09_recharge_receipt"] = await c.screenshot("09_recharge_receipt")
        await c.click(tid("recharge-done"))

        await set_theme(c, "dark")
        shots["10_customer_dark"] = await c.screenshot("10_customer_dark")
        await set_theme(c, "light")

        await c.navigate(f"{URL}/reports")
        await c.wait_for_text("Recharge revenue")
        await c._call("browser_wait_for", time=1)  # let the chart finish drawing
        shots["14_reports"] = await c.screenshot("14_reports")

        await c.navigate(f"{URL}/plans")
        await c.wait_for_text("Plans")
        shots["15_plans"] = await c.screenshot("15_plans")

        await c.navigate(f"{URL}/audit")
        await c.wait_for_text("Audit log")
        shots["16_audit"] = await c.screenshot("16_audit")

        await c.navigate(f"{URL}/settings")
        await c.wait_for_text("Copilot connection")
        shots["17_settings"] = await c.screenshot("17_settings")

        if copilot:
            await c.click(tid("copilot-open"))
            await c.wait_for_text("How can I help?")
            shots["11_copilot_empty"] = await c.screenshot("11_copilot_empty")
            shots["12_copilot_answer"] = await ask(c, POLICY_QUESTION, "Knowledge base", "12_copilot_answer")
            shots["13_copilot_browser_test"] = await ask(c, TEST_QUESTION, "Passed", "13_copilot_browser_test")

        for label, path in shots.items():
            print(f"{label}: {path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-copilot", action="store_true", help="skip the Copilot questions")
    args = parser.parse_args()
    asyncio.run(main(copilot=not args.no_copilot))
