import { Command } from "cmdk";
import { LogOut, Monitor, Moon, Search, Sun, Users } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useCustomers, useLogout } from "@/api/hooks";
import { Avatar } from "@/components/ui/primitives";
import { money, statusLabel } from "@/lib/format";
import { useTheme } from "@/lib/theme";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** ⌘K / Ctrl+K: jump to a customer or run a command without touching the mouse. */
export function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const logout = useLogout();
  const customers = useCustomers("", "");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const run = (action: () => void) => () => {
    onOpenChange(false);
    action();
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      overlayClassName="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
      contentClassName="fixed left-1/2 top-[18vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-border px-4">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <Command.Input placeholder="Search customers or type a command…" className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
      </div>
      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing found.</Command.Empty>

        <Group heading="Customers">
          {(customers.data ?? []).map((customer) => (
            <Item
              key={customer.msisdn}
              value={`${customer.msisdn} ${customer.status} ${customer.plan_id ?? ""}`}
              onSelect={run(() => navigate(`/customers/${customer.msisdn}`))}
              testId={`palette-customer-${customer.msisdn}`}
            >
              <Avatar name={customer.msisdn.slice(-2)} className="size-6 text-[10px]" />
              <span className="tabular font-medium">{customer.msisdn}</span>
              <span className="text-muted-foreground">{statusLabel(customer.status)}</span>
              <span className="tabular ml-auto text-muted-foreground">{money(customer.balance)}</span>
            </Item>
          ))}
        </Group>

        <Group heading="Go to">
          <Item value="go customers list" onSelect={run(() => navigate("/customers"))} testId="palette-go-customers">
            <Users className="size-4" /> Customers
          </Item>
        </Group>

        <Group heading="Appearance">
          <Item value="theme light" onSelect={run(() => setTheme("light"))} testId="palette-theme-light">
            <Sun className="size-4" /> Light theme
          </Item>
          <Item value="theme dark" onSelect={run(() => setTheme("dark"))} testId="palette-theme-dark">
            <Moon className="size-4" /> Dark theme
          </Item>
          <Item value="theme system" onSelect={run(() => setTheme("system"))} testId="palette-theme-system">
            <Monitor className="size-4" /> Match system theme
          </Item>
        </Group>

        <Group heading="Account">
          <Item value="sign out log out" onSelect={run(() => logout.mutate())} testId="palette-sign-out">
            <LogOut className="size-4" /> Sign out
          </Item>
        </Group>
      </Command.List>
    </Command.Dialog>
  );
}

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group heading={heading} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
      {children}
    </Command.Group>
  );
}

function Item({ value, onSelect, testId, children }: { value: string; onSelect: () => void; testId: string; children: ReactNode }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      data-testid={testId}
      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-muted"
    >
      {children}
    </Command.Item>
  );
}
