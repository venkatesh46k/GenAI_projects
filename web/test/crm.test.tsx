import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { describe, expect, it } from "vitest";
import { App } from "@/App";
import { TooltipProvider } from "@/components/ui/overlays";
import { ThemeProvider } from "@/lib/theme";
import { server } from "./server";

function renderApp(route = "/dashboard") {
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

const asTeamLead = () => http.get("/api/session", () => HttpResponse.json({ name: "Priya", role: "team_lead" }));

describe("routing", () => {
  it("lands on the dashboard by default, once signed in", async () => {
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });
});

describe("tags", () => {
  it("adds and removes a tag on the customer page, and it appears in the customer list", async () => {
    const user = userEvent.setup();
    renderApp("/customers/9876543210");
    await screen.findByTestId("customer-number");

    await user.click(screen.getByTestId("add-tag-open"));
    await user.type(screen.getByTestId("add-tag-input"), "VIP{Enter}");
    expect(await screen.findByTestId("tag-VIP")).toBeInTheDocument();

    await user.click(screen.getByTestId("nav-customers"));
    const row = await screen.findByTestId("customer-row-9876543210");
    expect(within(row).getByText("VIP")).toBeInTheDocument();

    // filter the list down to just that tag
    await user.selectOptions(screen.getByTestId("tag-filter"), "VIP");
    await waitFor(() => expect(screen.getByTestId("customers-table")).toHaveTextContent("9876543210"));
    expect(screen.queryByTestId("customer-row-9876500002")).not.toBeInTheDocument();

    // back on the customer page, remove it
    await user.click(screen.getByTestId("customer-row-9876543210"));
    await screen.findByTestId("customer-number");
    await user.click(within(screen.getByTestId("tag-VIP")).getByRole("button", { name: /remove tag/i }));
    await waitFor(() => expect(screen.queryByTestId("tag-VIP")).not.toBeInTheDocument());
  });
});

describe("notes and activity", () => {
  it("adds a note and shows it merged with usage, transactions and disputes, newest first", async () => {
    const user = userEvent.setup();
    renderApp("/customers/9876543210");
    await screen.findByTestId("customer-number");
    await user.click(screen.getByTestId("tab-activity"));

    await user.type(screen.getByTestId("note-input"), "Asked for a plan upgrade.");
    await user.click(screen.getByTestId("add-note-submit"));

    const feed = await screen.findByTestId("activity-feed");
    expect(within(feed).getByText("Asked for a plan upgrade.")).toBeInTheDocument();
    // the note was just added, so it is the newest thing and sorts first
    expect(within(feed).getAllByRole("listitem")[0]).toHaveTextContent("Asked for a plan upgrade.");
    expect(within(feed).getByTestId("activity-transaction")).toBeInTheDocument();
    expect(within(feed).getByTestId("activity-usage")).toBeInTheDocument();
    expect(within(feed).getByTestId("activity-dispute")).toBeInTheDocument();
  });
});

describe("dispute workspace", () => {
  it("lists disputes across customers and filters by status", async () => {
    renderApp("/disputes");
    await screen.findByTestId("disputes-workspace-table");
    expect(screen.getByTestId("workspace-dispute-DSP-1")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-dispute-DSP-2")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByTestId("dispute-status-filter-escalated"));
    await waitFor(() => expect(screen.queryByTestId("workspace-dispute-DSP-1")).not.toBeInTheDocument());
    expect(screen.getByTestId("workspace-dispute-DSP-2")).toBeInTheDocument();
  });

  it("an agent cannot escalate or resolve from the workspace; a team lead can", async () => {
    renderApp("/disputes"); // default session role is agent
    await screen.findByTestId("disputes-workspace-table");
    expect(screen.getByTestId("workspace-escalate-DSP-1")).toHaveAttribute("aria-disabled", "true");
  });

  it("a team lead resolves an escalated dispute from the workspace", async () => {
    server.use(asTeamLead());
    const user = userEvent.setup();
    renderApp("/disputes");
    await screen.findByTestId("disputes-workspace-table");
    await user.click(screen.getByTestId("workspace-resolve-DSP-2"));
    await user.click(await screen.findByTestId("workspace-resolve-confirm"));
    await waitFor(() => expect(within(screen.getByTestId("workspace-dispute-DSP-2")).getByText("Resolved")).toBeInTheDocument());
    // resolved disputes have nothing left to do
    expect(within(screen.getByTestId("workspace-dispute-DSP-2")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("links a dispute row back to its customer", async () => {
    const user = userEvent.setup();
    renderApp("/disputes");
    await screen.findByTestId("disputes-workspace-table");
    await user.click(within(screen.getByTestId("workspace-dispute-DSP-1")).getByRole("link"));
    expect(await screen.findByTestId("customer-number")).toHaveTextContent("Ananya Sharma"); // DSP-1's customer has a profile
    expect(screen.getByTestId("customer-subheading")).toHaveTextContent("9876543210");
  });
});

describe("dashboard", () => {
  it("shows KPIs and a link into the dispute workspace", async () => {
    const user = userEvent.setup();
    renderApp("/dashboard");
    await waitFor(() => expect(screen.getByTestId("dashboard-kpi-recharges-today")).toHaveTextContent("2")); // today's recharge count
    expect(screen.getByTestId("revenue-chart")).toBeInTheDocument();
    await user.click(screen.getByTestId("dashboard-to-disputes"));
    expect(await screen.findByTestId("disputes-workspace-table")).toBeInTheDocument();
  });
});

describe("recently viewed", () => {
  it("lists customers opened in this session, most recent first", async () => {
    const user = userEvent.setup();
    renderApp("/customers");
    await screen.findByTestId("customers-table");
    await user.click(screen.getByTestId("customer-row-9876543210"));
    await screen.findByTestId("customer-number");
    await user.click(screen.getByTestId("nav-customers"));
    await screen.findByTestId("customers-table");
    await user.click(screen.getByTestId("customer-row-9876500002"));
    await screen.findByTestId("customer-number");

    const list = await screen.findByTestId("recently-viewed");
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["9876500002", "9876543210"]);
  });
});

describe("export CSV", () => {
  it("triggers a CSV download of the visible customers", async () => {
    const user = userEvent.setup();
    const clicks: string[] = [];
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    };
    try {
      renderApp("/customers");
      await screen.findByTestId("customers-table");
      await user.click(screen.getByTestId("export-customers"));
      expect(clicks).toEqual(["customers.csv"]);
    } finally {
      HTMLAnchorElement.prototype.click = original;
    }
  });
});

describe("keyboard shortcuts", () => {
  it("opens the shortcuts dialog with ?, and from the sidebar button", async () => {
    const user = userEvent.setup();
    renderApp("/dashboard");
    await screen.findByRole("heading", { name: "Dashboard" });
    await user.keyboard("?");
    expect(await screen.findByTestId("shortcuts-dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("shortcuts-dialog")).not.toBeInTheDocument());

    await user.click(screen.getByTestId("open-shortcuts"));
    expect(await screen.findByTestId("shortcuts-dialog")).toBeInTheDocument();
  });

  it("does not open when typing ? into a text field", async () => {
    const user = userEvent.setup();
    renderApp("/customers");
    await screen.findByTestId("customers-table");
    await user.type(screen.getByTestId("customers-search"), "?");
    expect(screen.queryByTestId("shortcuts-dialog")).not.toBeInTheDocument();
  });
});
