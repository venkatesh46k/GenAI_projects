import { CircleCheck, CircleDashed, CircleX, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useHealth, useLogout, useSession } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const ROLE_LABEL = { agent: "Agent", team_lead: "Team lead" } as const;
const ROLE_HINT = { agent: "Handles customer queries; views but does not decide disputes or plans.", team_lead: "Reviews and escalates disputes, resolves them, and manages the plan catalog." } as const;
const THEMES: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Match system", icon: Monitor },
];

export function SettingsPage() {
  const session = useSession();
  const logout = useLogout();
  const health = useHealth();
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your profile, the console's appearance, and what it is connected to.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card data-testid="settings-profile">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Signed in as</p>
              <p className="text-lg font-medium">{session.data?.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Role</p>
              <p className="font-medium">{session.data ? ROLE_LABEL[session.data.role] : ""}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{session.data ? ROLE_HINT[session.data.role] : ""}</p>
            </div>
            <p className="text-xs text-muted-foreground">This is a demo sign-in: any name is accepted. There is no password to change.</p>
            <Button variant="secondary" size="sm" className="w-fit" onClick={() => logout.mutate()} data-testid="settings-sign-out">
              <LogOut /> Sign out
            </Button>
          </CardContent>
        </Card>

        <Card data-testid="settings-appearance">
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              {THEMES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`settings-theme-${value}`}
                  onClick={() => setTheme(value)}
                  aria-pressed={theme === value}
                  className={cn(
                    "flex items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors",
                    theme === value ? "border-primary bg-accent text-accent-foreground" : "border-border hover:bg-muted",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2" data-testid="settings-about">
          <CardHeader>
            <CardTitle>Copilot connection</CardTitle>
          </CardHeader>
          <CardContent>
            {health.isPending ? (
              <p className="text-sm text-muted-foreground">Checking…</p>
            ) : health.data?.assistant ? (
              <div className="flex items-center gap-3 text-sm">
                {health.data.assistant.ready ? (
                  <CircleCheck className="size-5 text-success" />
                ) : (
                  <CircleDashed className="size-5 animate-pulse text-warning" />
                )}
                <div>
                  <p className="font-medium">
                    {health.data.assistant.provider} · {health.data.assistant.model}
                  </p>
                  <p className="text-xs text-muted-foreground">{health.data.assistant.ready ? "Ready" : "Still starting up"}</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-sm">
                <CircleX className="size-5 text-danger" />
                <p>The assistant is not reachable right now. The rest of the console still works.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
