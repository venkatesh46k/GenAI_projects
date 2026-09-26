"""Thin async wrapper around the Playwright MCP server (`npx @playwright/mcp`).

Maps the scenario vocabulary onto the server's real tools (verified against @playwright/mcp 0.0.82):

    navigate   -> browser_navigate(url)
    fill       -> browser_type(element, target, text, submit=True)     Enter commits Streamlit inputs
    click      -> browser_click(element, target)
    select     -> browser_click(dropdown) then browser_click(option)   Streamlit selects are not native <select>
    wait_for   -> browser_wait_for(text)
    read_text  -> browser_snapshot(target=<selector>)                  accessibility snapshot of one subtree
    screenshot -> browser_take_screenshot(type="png")

`target` accepts a snapshot ref or a unique CSS selector; the scenarios use the stable `.st-key-<key>` classes that
ui/recharge_app.py exposes, not Streamlit's generated ids.
"""
import base64
import os
import re
import shutil
from contextlib import AsyncExitStack

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

EVIDENCE_DIR = os.path.join(os.path.dirname(__file__), "evidence")


class StepFailure(Exception):
    """A scenario step could not be performed (missing element, timeout, ...). Reported as a test failure."""


_LINE = re.compile(r'^(?P<role>[\w-]+)(?: "(?P<name>[^"]*)")?(?: \[[^\]]*\])*(?::\s*(?P<text>.*))?$')


def extract_text(snapshot: str) -> str:
    """Visible text from a Playwright MCP accessibility snapshot (YAML-ish), joined with single spaces."""
    block = re.search(r"```yaml\n(.*?)```", snapshot, re.S)
    body = block.group(1) if block else snapshot
    pieces = []
    for raw in body.splitlines():
        line = raw.strip()
        if not line.startswith("- ") or line.startswith("- /"):  # "- /url:" and "- /placeholder:" are metadata
            continue
        match = _LINE.match(line[2:].strip())
        if not match:
            continue
        text = (match.group("text") or "").strip()
        if len(text) >= 2 and text[0] == text[-1] == '"':
            text = text[1:-1]
        piece = text or match.group("name") or ""
        if piece and (not pieces or pieces[-1] != piece):
            pieces.append(piece)
    return " ".join(pieces)


def _selector_problem(message: str, target: str) -> str:
    """Turn Playwright's raw error into the reason string the tests report."""
    lowered = message.lower()
    if "waiting for locator" in lowered or "strict mode violation" in lowered or "not found" in lowered:
        return f"selector not found: {target}"
    if "timeout" in lowered:
        return f"timed out on: {target}"
    return message.strip().splitlines()[-1][:300] if message.strip() else "unknown error"


class MCPClient:
    def __init__(
        self,
        headless: bool = True,
        settle_seconds: float = 0.5,
        evidence_dir: str = EVIDENCE_DIR,
        action_timeout_ms: int | None = None,
    ):
        self.headless = headless
        self.action_timeout_ms = action_timeout_ms  # the server's default is 5 s per action / wait_for
        self.settle_seconds = settle_seconds
        self.evidence_dir = evidence_dir
        self._stack = AsyncExitStack()
        self._session: ClientSession | None = None

    def server_args(self) -> list[str]:
        # --isolated: every run gets its own throwaway browser profile. Without it the server keeps one persistent
        # profile on disk, so two concurrent runs (two agents, or a QA run while another browser session is open) fail
        # with "Browser is already in use for ...\mcp-chrome-..., use --isolated to run multiple instances".
        args = ["-y", "@playwright/mcp@latest", "--isolated"]
        if self.headless:
            args.append("--headless")
        if self.action_timeout_ms:
            args.append(f"--timeout-action={self.action_timeout_ms}")
        return args

    async def __aenter__(self) -> "MCPClient":
        npx = shutil.which("npx") or shutil.which("npx.cmd")
        if not npx:
            raise RuntimeError("npx not found: install Node.js 18+ to run the Playwright MCP server")
        read, write = await self._stack.enter_async_context(
            stdio_client(StdioServerParameters(command=npx, args=self.server_args()))
        )
        self._session = await self._stack.enter_async_context(ClientSession(read, write))
        await self._session.initialize()
        return self

    async def __aexit__(self, *exc) -> None:
        await self._stack.aclose()

    async def _call(self, tool: str, label: str = "", **arguments):
        result = await self._session.call_tool(tool, arguments)
        text = "".join(getattr(c, "text", "") for c in result.content)
        if result.is_error or text.lstrip().startswith("### Error"):
            raise StepFailure(_selector_problem(text, label))
        return result, text

    async def _settle(self) -> None:
        # Streamlit reruns the script after every interaction; give it a moment before the next step.
        if self.settle_seconds:
            await self._call("browser_wait_for", time=self.settle_seconds)

    async def navigate(self, url: str) -> None:
        await self._call("browser_navigate", url, url=url)

    async def fill(self, selector: str, value: str) -> None:
        await self._call("browser_type", selector, element=selector, target=selector, text=value, submit=True)
        await self._settle()

    async def click(self, selector: str) -> None:
        await self._call("browser_click", selector, element=selector, target=selector)
        await self._settle()

    async def select(self, selector: str, option: str) -> None:
        await self.click(selector)
        await self.click(f'[role="option"]:has-text("{option}")')

    async def wait_for_text(self, text: str) -> None:
        try:
            await self._call("browser_wait_for", text, text=text)
        except StepFailure as exc:
            raise StepFailure(f"text never appeared: {text!r} ({exc})") from exc

    async def wait_until_gone(self, text: str) -> None:
        """Wait for a piece of text (e.g. a spinner message) to disappear: the reliable 'it finished' signal."""
        await self._call("browser_wait_for", text, textGone=text)

    async def read_text(self, selector: str) -> str:
        _, text = await self._call("browser_snapshot", selector, target=selector)
        return extract_text(text)

    async def screenshot(self, name: str) -> str | None:
        """Save a PNG of the current page to tests_qa/evidence/<name>.png and return the path."""
        try:
            result, _ = await self._call("browser_take_screenshot", type="png")
        except StepFailure:
            return None
        for content in result.content:
            if getattr(content, "type", "") == "image":
                os.makedirs(self.evidence_dir, exist_ok=True)
                path = os.path.join(self.evidence_dir, f"{name}.png")
                with open(path, "wb") as f:
                    f.write(base64.b64decode(content.data))
                return path
        return None

    async def perform(self, action: str, target: str | None, value: str | None) -> None:
        """Execute one scenario step. read_text is a no-op here: the assertion reads what it needs."""
        if action == "navigate":
            await self.navigate(target)
        elif action == "fill":
            await self.fill(target, value or "")
        elif action == "click":
            await self.click(target)
        elif action == "select":
            await self.select(target, value or "")
        elif action == "wait_for":
            await self.wait_for_text(target)
        elif action == "read_text":
            await self.read_text(target)
        else:
            raise StepFailure(f"unknown action: {action}")
