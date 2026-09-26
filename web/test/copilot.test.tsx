import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "@/App";
import { TooltipProvider } from "@/components/ui/overlays";
import { renderInline } from "@/features/copilot/CopilotDrawer";
import { parseSse } from "@/features/copilot/stream";
import { ThemeProvider } from "@/lib/theme";
import { server } from "./server";

function renderApp(route = "/customers") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <MemoryRouter initialEntries={[route]}>
            <App />
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const RESULT = {
  answer: "Your balance is ₹45.50.",
  route: "balance",
  route_method: "regex",
  pii_masked: false,
  safety_flag: null,
  tool_calls: [{ tool: "get_balance", msisdn: "9876543210" }],
  sources: ["Recharge rules: a balance below ₹5 bars outgoing usage."],
  dispute_id: null,
  ticket_id: null,
  test_result: null,
};

function sse(...blocks: string[]) {
  const encoder = new TextEncoder();
  return new HttpResponse(
    new ReadableStream({
      start(controller) {
        for (const block of blocks) controller.enqueue(encoder.encode(block));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

const step = (node: string, message: string) => `event: step\ndata: ${JSON.stringify({ node, message })}\n\n`;
const result = (body: object = RESULT) => `event: result\ndata: ${JSON.stringify(body)}\n\nevent: done\ndata: {}\n\n`;

type Sent = { query: string; msisdn?: string };

describe("parseSse", () => {
  it("splits complete blocks and keeps the unfinished tail", () => {
    const { blocks, rest } = parseSse('event: step\ndata: {"a":1}\n\nevent: result\ndata: {"b"');
    expect(blocks).toEqual([{ event: "step", data: '{"a":1}' }]);
    expect(rest).toBe('event: result\ndata: {"b"');
  });

  it("ignores keepalive comments and handles CRLF", () => {
    const { blocks } = parseSse(": keepalive\n\nevent: step\r\ndata: {}\r\n\r\n");
    expect(blocks).toEqual([{ event: "step", data: "{}" }]);
  });
});

describe("renderInline", () => {
  it("turns non-breaking spaces from the model into normal spaces", () => {
    const { container } = render(<p>{renderInline("below\u202f\u20b95 and\u00a0more")}</p>);
    expect(container.textContent).toBe("below \u20b95 and more");
  });

  it("renders bold and code as elements and leaves HTML inert", () => {
    const { container } = render(<p>{renderInline("Balance is **₹45.50** via `GET /balance` <img src=x onerror=alert(1)>")}</p>);
    expect(container.querySelector("strong")).toHaveTextContent("₹45.50");
    expect(container.querySelector("code")).toHaveTextContent("GET /balance");
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("<img src=x onerror=alert(1)>");
  });
});

describe("Copilot drawer", () => {
  async function openDrawer(route = "/customers/9876543210") {
    const user = userEvent.setup();
    renderApp(route);
    await screen.findByTestId("copilot-open");
    await user.click(screen.getByTestId("copilot-open"));
    return { user, drawer: await screen.findByTestId("copilot-drawer") };
  }

  async function ask(user: ReturnType<typeof userEvent.setup>, drawer: HTMLElement, text: string) {
    await user.type(within(drawer).getByTestId("copilot-input"), text);
    await user.keyboard("{Enter}");
  }

  it("streams progress, then shows the answer with route and sources", async () => {
    let sent: Sent | null = null;
    server.use(
      http.post("/api/chat/stream", async ({ request }) => {
        sent = (await request.json()) as Sent;
        return sse(step("router", "Understanding the question"), step("balance", "Checked the balance"), result());
      }),
    );
    const { user, drawer } = await openDrawer();
    await ask(user, drawer, "What is my balance?");

    expect(await within(drawer).findByText("Your balance is ₹45.50.")).toBeInTheDocument();
    expect(within(drawer).getByTestId("copilot-route")).toHaveTextContent("Balance");
    expect(within(drawer).getByTestId("copilot-details")).toHaveTextContent("get_balance");
    expect(within(drawer).getByTestId("copilot-details")).toHaveTextContent("balance below ₹5");
    expect(sent).toEqual({ query: "What is my balance?", msisdn: "9876543210" }); // the open customer is shared as context
  });

  it("stops sharing the customer when the context chip is switched off", async () => {
    let sent: Sent | null = null;
    server.use(
      http.post("/api/chat/stream", async ({ request }) => {
        sent = (await request.json()) as Sent;
        return sse(result());
      }),
    );
    const { user, drawer } = await openDrawer();
    await user.click(within(drawer).getByTestId("copilot-context"));
    await user.click(within(drawer).getByTestId("suggestion-0"));
    await within(drawer).findByText("Your balance is ₹45.50.");
    expect(sent).not.toBeNull();
    expect((sent as unknown as Sent).msisdn).toBeUndefined();
  });

  it("does not send an empty question", async () => {
    const { drawer } = await openDrawer("/customers");
    expect(within(drawer).getByTestId("copilot-send")).toBeDisabled();
    expect(within(drawer).getByText(/No customer open/)).toBeInTheDocument();
  });

  it("shows the server's message and lets the agent retry", async () => {
    let calls = 0;
    server.use(
      http.post("/api/chat/stream", () => {
        calls += 1;
        return calls === 1 ? HttpResponse.json({ detail: "The assistant is busy. Please try again shortly." }, { status: 429 }) : sse(result());
      }),
    );
    const { user, drawer } = await openDrawer();
    await ask(user, drawer, "balance?");
    expect(await within(drawer).findByTestId("copilot-error")).toHaveTextContent("busy");
    await user.click(within(drawer).getByTestId("copilot-retry"));
    expect(await within(drawer).findByText("Your balance is ₹45.50.")).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it("reports a stream that ends without an answer", async () => {
    server.use(http.post("/api/chat/stream", () => sse(step("router", "Understanding the question"))));
    const { user, drawer } = await openDrawer();
    await ask(user, drawer, "hello");
    expect(await within(drawer).findByTestId("copilot-error")).toHaveTextContent(/stopped before answering/i);
  });

  it("shows an error event from the service", async () => {
    server.use(http.post("/api/chat/stream", () => sse('event: error\ndata: {"detail":"The assistant ran into a problem. Please try again."}\n\nevent: done\ndata: {}\n\n')));
    const { user, drawer } = await openDrawer();
    await ask(user, drawer, "hello");
    expect(await within(drawer).findByTestId("copilot-error")).toHaveTextContent(/ran into a problem/);
  });

  it("shows the browser-test verdict with its screenshot", async () => {
    server.use(
      http.post("/api/chat/stream", () =>
        sse(
          result({
            ...RESULT,
            answer: "The recharge flow works.",
            route: "testgen",
            tool_calls: [],
            sources: [],
            test_result: { status: "pass", detail: "Recharge completed", evidence_url: "/api/evidence/run1.png", steps_completed: 5 },
          }),
        ),
      ),
    );
    const { user, drawer } = await openDrawer();
    await ask(user, drawer, "test the recharge");
    const image = await within(drawer).findByTestId("copilot-evidence");
    expect(image).toHaveAttribute("src", "/api/evidence/run1.png");
    expect(within(drawer).getByTestId("copilot-test-result")).toHaveTextContent("Passed");
    expect(within(drawer).getByTestId("copilot-test-result")).toHaveTextContent("5 steps");
  });

  it("warns while the assistant is warming up", async () => {
    server.use(http.get("/api/health", () => HttpResponse.json({ status: "ok", assistant: { status: "ok", ready: false, provider: "x", model: "y" } })));
    const { drawer } = await openDrawer("/customers");
    expect(await within(drawer).findByTestId("copilot-warming")).toBeInTheDocument();
  });

  it("shows unavailable when the assistant cannot be reached", async () => {
    server.use(http.get("/api/health", () => HttpResponse.json({ status: "ok", assistant: null })));
    const { drawer } = await openDrawer("/customers");
    expect(await within(drawer).findByTestId("copilot-unavailable")).toBeInTheDocument();
  });

  it("clears the conversation with New chat", async () => {
    server.use(http.post("/api/chat/stream", () => sse(result())));
    const { user, drawer } = await openDrawer();
    await user.click(within(drawer).getByTestId("suggestion-0"));
    await within(drawer).findByText("Your balance is ₹45.50.");
    await user.click(within(drawer).getByTestId("copilot-new"));
    await waitFor(() => expect(within(drawer).queryByTestId("copilot-message-assistant")).not.toBeInTheDocument());
    expect(within(drawer).getByTestId("suggestion-0")).toBeInTheDocument();
  });

  it("opens with Ctrl+J", async () => {
    const user = userEvent.setup();
    renderApp("/customers");
    await screen.findByTestId("copilot-open");
    await user.keyboard("{Control>}j{/Control}");
    expect(await screen.findByTestId("copilot-drawer")).toBeInTheDocument();
  });
});
