import { LogOut, Search, Users } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useLogout, useSession } from "@/api/hooks";
import { CommandPalette } from "@/components/CommandPalette";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/overlays";
import { Avatar, Kbd } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const ROLE_LABEL = { agent: "Agent", team_lead: "Team lead" } as const;
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <svg viewBox="0 0 32 32" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21V11l7 6 7-6v10" />
        </svg>
      </span>
      <span className="text-sm font-semibold tracking-tight">Billing Ops</span>
    </div>
  );
}

function NavItem({ to, icon: Icon, children }: { to: string; icon: typeof Users; children: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
          isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )
      }
    >
      <Icon className="size-4" />
      {children}
    </NavLink>
  );
}

export function AppShell() {
  const { data: user } = useSession();
  const logout = useLogout();
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-card px-3 py-4 md:flex" aria-label="Sidebar">
        <div className="px-2 pb-5">
          <Brand />
        </div>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          <NavItem to="/customers" icon={Users}>
            Customers
          </NavItem>
        </nav>

        <div className="mt-auto flex items-center gap-2.5 rounded-md border border-border p-2.5" data-testid="user-card">
          <Avatar name={user?.name ?? ""} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user ? ROLE_LABEL[user.role] : ""}</p>
          </div>
          <Tooltip label="Sign out">
            <Button variant="ghost" size="icon" className="size-8" aria-label="Sign out" data-testid="sign-out" onClick={() => logout.mutate()}>
              <LogOut />
            </Button>
          </Tooltip>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur md:px-8">
          <div className="md:hidden">
            <Brand />
          </div>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            data-testid="open-palette"
            className="ml-auto flex h-9 w-full max-w-xs items-center gap-2 rounded-md border border-input bg-card px-3 text-sm text-muted-foreground shadow-card transition-colors hover:border-muted-foreground/50 md:ml-0"
          >
            <Search className="size-4" aria-hidden />
            <span className="flex-1 text-left">Search customers…</span>
            <Kbd>{isMac ? "⌘" : "Ctrl"} K</Kbd>
          </button>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
