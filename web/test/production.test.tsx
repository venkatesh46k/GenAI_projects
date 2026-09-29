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
import { PLANS, server } from "./server";

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

describe("sidebar navigation", () => {
  it("reaches every new page from the sidebar", async () => {
    const user = userEvent.setup();
    renderApp("/dashboard");
    await screen.findByRole("heading", { name: "Dashboard" });

    await user.click(screen.getByTestId("nav-reports"));
    expect(await screen.findByRole("heading", { name: "Reports" })).toBeInTheDocument();

    await user.click(screen.getByTestId("nav-plans"));
    expect(await screen.findByRole("heading", { name: "Plans" })).toBeInTheDocument();

    await user.click(screen.getByTestId("nav-audit"));
    expect(await screen.findByRole("heading", { name: "Audit log" })).toBeInTheDocument();

    await user.click(screen.getByTestId("nav-settings"));
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });
});

describe("customer profiles", () => {
  it("shows a customer's name and city in the list, and lets you search by name", async () => {
    const user = userEvent.setup();
    renderApp("/customers");
    const row = await screen.findByTestId("customer-row-9876543210");
    expect(row).toHaveTextContent("Ananya Sharma");
    expect(row).toHaveTextContent("Pune");

    await user.type(screen.getByTestId("customers-search"), "Ananya");
    await waitFor(() => expect(screen.queryByTestId("customer-row-9876500002")).not.toBeInTheDocument());
    expect(screen.getByTestId("customer-row-9876543210")).toBeInTheDocument();
  });
});

describe("Reports page", () => {
  it("shows the revenue trend and plan mix, and switches period", async () => {
    const user = userEvent.setup();
    renderApp("/reports");
    await waitFor(() => expect(screen.getByTestId("revenue-trend")).toHaveTextContent("2026-09-2"));
    expect(screen.getByTestId("plan-distribution")).toHaveTextContent("Basic");
    expect(screen.getByTestId("usage-by-type")).toHaveTextContent("voice");

    await user.click(screen.getByTestId("reports-period-30"));
    await waitFor(() => expect(screen.getByTestId("revenue-trend")).toHaveTextContent("2026-08-01"));
  });
});

describe("Plans page", () => {
  it("an agent can see the catalog but the New/Edit buttons are disabled", async () => {
    renderApp("/plans"); // default session role is agent
    await screen.findByTestId("plans-table");
    expect(screen.getByTestId("new-plan")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("edit-plan-P99")).toHaveAttribute("aria-disabled", "true");
  });

  it("a team lead creates a new plan and sees it in the catalog", async () => {
    server.use(asTeamLead());
    const user = userEvent.setup();
    renderApp("/plans");
    await screen.findByTestId("plans-table");
    await user.click(screen.getByTestId("new-plan"));
    const dialog = await screen.findByTestId("plan-dialog");

    await user.type(within(dialog).getByTestId("plan-id-input"), "PLAN_249");
    await user.type(within(dialog).getByTestId("plan-name-input"), "Value 249");
    await user.clear(within(dialog).getByTestId("plan-price-input"));
    await user.type(within(dialog).getByTestId("plan-price-input"), "249");
    await user.type(screen.getByLabelText("Validity (days)"), "30");
    await user.type(screen.getByLabelText("Data/day (GB)"), "2");
    await user.type(screen.getByLabelText("Voice minutes"), "1500");
    await user.type(screen.getByLabelText("SMS/day"), "100");
    await user.click(within(dialog).getByTestId("plan-save"));

    await waitFor(() => expect(screen.queryByTestId("plan-dialog")).not.toBeInTheDocument());
    expect(await screen.findByTestId("plan-row-PLAN_249")).toHaveTextContent("Value 249");
  });

  it("validates the form before saving", async () => {
    server.use(asTeamLead());
    const user = userEvent.setup();
    renderApp("/plans");
    await screen.findByTestId("plans-table");
    await user.click(screen.getByTestId("new-plan"));
    const dialog = await screen.findByTestId("plan-dialog");
    await user.click(within(dialog).getByTestId("plan-save"));
    expect(await within(dialog).findByTestId("plan-form-error")).toHaveTextContent(/plan name/i);
    expect(PLANS).toHaveLength(2); // nothing was created
  });

  it("a team lead edits an existing plan", async () => {
    server.use(asTeamLead());
    const user = userEvent.setup();
    renderApp("/plans");
    await screen.findByTestId("plans-table");
    await user.click(screen.getByTestId("edit-plan-P99"));
    const dialog = await screen.findByTestId("plan-dialog");
    const priceInput = within(dialog).getByTestId("plan-price-input");
    expect(priceInput).toHaveValue("99");
    await user.clear(priceInput);
    await user.type(priceInput, "119");
    await user.click(within(dialog).getByTestId("plan-save"));
    await waitFor(() => expect(screen.getByTestId("plan-row-P99")).toHaveTextContent("₹119.00"));
  });
});

describe("Audit log", () => {
  it("lists entries and filters by action", async () => {
    const user = userEvent.setup();
    renderApp("/audit");
    const table = await screen.findByTestId("audit-table");
    expect(table).toHaveTextContent("Priya");
    expect(table).toHaveTextContent("Recharge");

    await user.selectOptions(screen.getByTestId("audit-action-filter"), "tag_added");
    await waitFor(() => expect(screen.getByTestId("audit-table")).not.toHaveTextContent("Dispute escalated"));
    expect(screen.getByTestId("audit-table")).toHaveTextContent("Tag added");
  });

  it("links an entry's customer back to their page", async () => {
    const user = userEvent.setup();
    renderApp("/audit");
    await screen.findByTestId("audit-table");
    await user.click(screen.getByTestId("audit-row-A-1").querySelector("a")!);
    expect(await screen.findByTestId("customer-number")).toBeInTheDocument();
  });
});

describe("Settings page", () => {
  it("shows the signed-in profile, lets the theme be changed, and shows the assistant's status", async () => {
    const user = userEvent.setup();
    renderApp("/settings");
    await screen.findByTestId("settings-profile");
    expect(screen.getByTestId("settings-profile")).toHaveTextContent("Priya");
    expect(screen.getByTestId("settings-profile")).toHaveTextContent("Agent");

    await user.click(screen.getByTestId("settings-theme-dark"));
    expect(document.documentElement).toHaveClass("dark");

    expect(await screen.findByTestId("settings-about")).toHaveTextContent("test");
    expect(screen.getByTestId("settings-about")).toHaveTextContent("Ready");
  });

  it("signs out from the settings page", async () => {
    const user = userEvent.setup();
    renderApp("/settings");
    await screen.findByTestId("settings-profile");
    await user.click(screen.getByTestId("settings-sign-out"));
    expect(await screen.findByTestId("login-form")).toBeInTheDocument();
  });
});
