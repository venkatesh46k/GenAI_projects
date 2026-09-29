import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { describe, expect, it } from "vitest";
import { App } from "@/App";
import { TooltipProvider } from "@/components/ui/overlays";
import { parseAmount } from "@/features/customers/RechargeDialog";
import { validateName } from "@/features/auth/LoginPage";
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
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const signedOut = () => http.get("/api/session", () => HttpResponse.json({ detail: "Sign in required" }, { status: 401 }));

describe("pure validation", () => {
  it("validates names like the server does", () => {
    expect(validateName("")).toMatch(/at least 2/);
    expect(validateName("A")).toMatch(/at least 2/);
    expect(validateName("<script>")).toMatch(/letters/);
    expect(validateName("x".repeat(41))).toMatch(/under 40/);
    expect(validateName("Priya Sharma")).toBeNull();
    expect(validateName("D'Souza-Rao")).toBeNull();
  });

  it("parses recharge amounts", () => {
    expect(parseAmount("199")).toEqual({ value: 199, error: null });
    expect(parseAmount(" 99.50 ")).toEqual({ value: 99.5, error: null });
    for (const bad of ["", "abc", "-5", "1e3", "10.999", "0", "0.00", "100000.01"]) {
      expect(parseAmount(bad).error, bad).toBeTruthy();
    }
  });
});

describe("auth guard and login", () => {
  it("sends a signed-out visitor to the login page", async () => {
    server.use(signedOut());
    renderApp("/customers");
    expect(await screen.findByTestId("login-form")).toBeInTheDocument();
  });

  it("shows validation before any request and signs in with a valid name", async () => {
    let posted: { name: string; role: string } | null = null;
    let signedIn = false;
    server.use(
      http.get("/api/session", () => (signedIn ? HttpResponse.json({ name: "Priya", role: "team_lead" }) : HttpResponse.json({ detail: "x" }, { status: 401 }))),
      http.post("/api/session", async ({ request }) => {
        posted = (await request.json()) as { name: string; role: string };
        signedIn = true;
        return HttpResponse.json(posted);
      }),
    );
    const user = userEvent.setup();
    renderApp("/customers");
    await screen.findByTestId("login-form");

    await user.click(screen.getByTestId("login-submit"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/at least 2/);
    expect(posted).toBeNull();

    await user.type(screen.getByLabelText("Your name"), "Priya");
    await user.click(screen.getByLabelText(/Team lead/));
    await user.click(screen.getByTestId("login-submit"));
    expect(await screen.findByTestId("customers-table")).toBeInTheDocument();
    expect(posted).toEqual({ name: "Priya", role: "team_lead" });
  });

  it("shows the server's message when sign-in fails", async () => {
    server.use(signedOut(), http.post("/api/session", () => HttpResponse.json({ detail: "Too many attempts" }, { status: 429 })));
    const user = userEvent.setup();
    renderApp("/login");
    await user.type(await screen.findByLabelText("Your name"), "Priya");
    await user.click(screen.getByTestId("login-submit"));
    expect(await screen.findByTestId("login-error")).toHaveTextContent("Too many attempts");
  });
});

describe("customers list", () => {
  it("colors the balance by how low it is, but not for a barred number (its own badge already says so)", async () => {
    renderApp("/customers");
    const cell = (msisdn: string) => within(screen.getByTestId(`customer-row-${msisdn}`)).getByText(/^₹/);
    expect(await screen.findByTestId("customer-row-9876543210")).toBeInTheDocument();
    expect(cell("9876543210")).not.toHaveClass("text-danger", "text-warning"); // ₹120.50: well clear
    expect(cell("9876500002")).toHaveClass("text-danger"); // ₹2: below ₹5
    expect(cell("9876500003")).not.toHaveClass("text-danger", "text-warning"); // barred: the status badge covers it
    expect(cell("9876500004")).toHaveClass("text-warning"); // ₹7: the ₹5-10 warning band
  });

  it("lists customers and filters by status", async () => {
    const user = userEvent.setup();
    renderApp("/customers");
    expect(await screen.findByTestId("customer-row-9876543210")).toBeInTheDocument();
    expect(screen.getByTestId("customer-row-9876500003")).toBeInTheDocument();

    await user.click(screen.getByTestId("status-filter-barred"));
    await waitFor(() => expect(screen.queryByTestId("customer-row-9876543210")).not.toBeInTheDocument());
    expect(screen.getByTestId("customer-row-9876500003")).toBeInTheDocument();
  });

  it("searches by number", async () => {
    const user = userEvent.setup();
    renderApp("/customers");
    await screen.findByTestId("customer-row-9876543210");
    await user.type(screen.getByTestId("customers-search"), "00002");
    await waitFor(() => expect(screen.queryByTestId("customer-row-9876543210")).not.toBeInTheDocument());
    expect(screen.getByTestId("customer-row-9876500002")).toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    server.use(http.get("/api/customers", () => HttpResponse.json([])));
    renderApp("/customers");
    expect(await screen.findByText(/no customers/i)).toBeInTheDocument();
  });

  it("shows an error with retry when the API fails", async () => {
    server.use(http.get("/api/customers", () => HttpResponse.json({ detail: "boom" }, { status: 500 })));
    renderApp("/customers");
    expect(await screen.findByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });
});

describe("customer page", () => {
  it("shows balance, plan and tabs", async () => {
    const user = userEvent.setup();
    renderApp("/customers/9876543210");
    expect(await screen.findByTestId("customer-number")).toHaveTextContent("9876543210");
    expect(screen.getByTestId("kpi-balance")).toHaveTextContent("₹120.50");
    expect(screen.getByTestId("kpi-plan")).toHaveTextContent("Plus");
    expect(screen.queryByTestId("balance-alert")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("tab-transactions"));
    expect(await screen.findByTestId("transactions-table")).toHaveTextContent("TXN1");
  });

  it("warns when the balance is low and when the number is barred", async () => {
    const { unmount } = renderApp("/customers/9876500002");
    expect(await screen.findByTestId("balance-alert")).toHaveTextContent(/below/i);
    unmount();
    const barred = renderApp("/customers/9876500003");
    expect(await screen.findByTestId("balance-alert")).toHaveTextContent(/barred/i);
    barred.unmount();
    renderApp("/customers/9876500004");
    expect(await screen.findByTestId("balance-alert")).toHaveTextContent(/low balance warning/i);
  });

  it("explains an unknown number", async () => {
    renderApp("/customers/1111111111");
    expect(await screen.findByText(/No customer with number 1111111111/)).toBeInTheDocument();
  });

  it("escalates an open dispute after confirmation, as a team lead", async () => {
    let escalated = "";
    server.use(
      http.get("/api/session", () => HttpResponse.json({ name: "Priya", role: "team_lead" })),
      http.post("/api/disputes/:id/escalate", ({ params }) => {
        escalated = String(params.id);
        return HttpResponse.json({ dispute_id: escalated, status: "escalated", ticket_id: "TKT-9" });
      }),
    );
    const user = userEvent.setup();
    renderApp("/customers/9876543210");
    await screen.findByTestId("customer-number");
    await user.click(screen.getByTestId("tab-disputes"));
    await user.click(await screen.findByTestId("escalate-DSP-1"));
    expect(escalated).toBe(""); // nothing happens until confirmed
    await user.click(await screen.findByTestId("escalate-confirm"));
    await waitFor(() => expect(escalated).toBe("DSP-1"));
    expect(await screen.findByText(/TKT-9/)).toBeInTheDocument();
  });

  it("an agent sees Escalate but it does nothing: only a team lead may use it", async () => {
    let calls = 0;
    server.use(
      http.post("/api/disputes/:id/escalate", () => {
        calls++;
        return HttpResponse.json({ dispute_id: "DSP-1", status: "escalated", ticket_id: "TKT-9" });
      }),
    );
    const user = userEvent.setup();
    renderApp("/customers/9876543210"); // default session in test/server.ts is role: "agent"
    await screen.findByTestId("customer-number");
    await user.click(screen.getByTestId("tab-disputes"));
    const button = await screen.findByTestId("escalate-DSP-1");
    expect(button).toHaveAttribute("aria-disabled", "true");
    await user.click(button);
    expect(screen.queryByTestId("escalate-dialog")).not.toBeInTheDocument();
    expect(calls).toBe(0);
  });
});

describe("recharge flow", () => {
  async function openDialog() {
    const user = userEvent.setup();
    renderApp("/customers/9876543210");
    await screen.findByTestId("customer-number");
    await user.click(screen.getByTestId("open-recharge"));
    return { user, dialog: await screen.findByTestId("recharge-dialog") };
  }

  it("validates the amount before moving on", async () => {
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByTestId("recharge-continue"));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/enter an amount/i);
    await user.type(within(dialog).getByTestId("recharge-amount"), "abc");
    await user.click(within(dialog).getByTestId("recharge-continue"));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/digits/i);
    expect(within(dialog).queryByTestId("recharge-review")).not.toBeInTheDocument();
  });

  it("goes details → review → receipt and refreshes the balance", async () => {
    let body: unknown = null;
    server.use(
      http.post("/api/customers/:msisdn/recharge", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ txn_id: "TXN-NEW", new_balance: 319.5, status: "success" });
      }),
    );
    const { user, dialog } = await openDialog();
    await user.click(within(dialog).getByTestId("preset-199"));
    await user.click(within(dialog).getByTestId("recharge-continue"));
    expect(await within(dialog).findByTestId("review-amount")).toHaveTextContent("₹199.00");
    await user.click(within(dialog).getByTestId("recharge-confirm"));
    expect(await within(dialog).findByTestId("receipt-txn")).toHaveTextContent("TXN-NEW");
    expect(within(dialog).getByTestId("receipt-balance")).toHaveTextContent("₹319.50");
    expect(body).toEqual({ amount: 199, plan_id: null });
  });

  it("keeps the user on the review step when the recharge fails", async () => {
    server.use(http.post("/api/customers/:msisdn/recharge", () => HttpResponse.json({ detail: "Payment gateway unavailable" }, { status: 502 })));
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByTestId("recharge-amount"), "50");
    await user.click(within(dialog).getByTestId("recharge-continue"));
    await user.click(await within(dialog).findByTestId("recharge-confirm"));
    expect(await within(dialog).findByTestId("recharge-error")).toHaveTextContent("Payment gateway unavailable");
    expect(within(dialog).getByTestId("recharge-confirm")).toBeEnabled();
  });
});

describe("theme and command palette", () => {
  it("switches to dark and remembers the choice", async () => {
    const user = userEvent.setup();
    renderApp("/customers");
    await screen.findByTestId("customers-table");
    await user.click(screen.getAllByTestId("theme-toggle")[0]!);
    await user.click(await screen.findByTestId("theme-dark"));
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    await user.click(screen.getAllByTestId("theme-toggle")[0]!);
    await user.click(await screen.findByTestId("theme-light"));
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("opens with Ctrl+K and jumps to a customer", async () => {
    const user = userEvent.setup();
    renderApp("/customers");
    await screen.findByTestId("customers-table");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByPlaceholderText(/type a command/i);
    await user.type(input, "9876500002");
    await user.keyboard("{Enter}");
    expect(await screen.findByTestId("customer-number")).toHaveTextContent("9876500002");
  });
});
