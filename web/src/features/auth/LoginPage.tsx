import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useLogin, useSession } from "@/api/hooks";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { Input, Label } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type Role = "agent" | "team_lead";

const ROLES: Array<{ value: Role; label: string; hint: string }> = [
  { value: "agent", label: "Agent", hint: "Handles customer queries" },
  { value: "team_lead", label: "Team lead", hint: "Reviews and escalates" },
];

// The same rules the server enforces, so a mistake is shown before a round trip.
const NAME_PATTERN = /^\p{L}[\p{L} .'-]*$/u;

export function validateName(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 2) return "Enter at least 2 characters.";
  if (name.length > 40) return "Keep the name under 40 characters.";
  if (!NAME_PATTERN.test(name)) return "Use letters, spaces, dots, apostrophes and hyphens only.";
  return null;
}

export function LoginPage() {
  const session = useSession();
  const login = useLogin();
  const location = useLocation();
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [touched, setTouched] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? "/customers";
  if (session.data) return <Navigate to={from} replace />;

  const nameError = touched ? validateName(name) : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (validateName(name)) return;
    login.mutate({ name: name.trim(), role });
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span aria-hidden className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-card">
            <svg viewBox="0 0 32 32" className="size-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21V11l7 6 7-6v10" />
            </svg>
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Billing Ops Console</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to look up customers and use the Copilot.</p>
          </div>
        </div>

        <Card className="p-6">
          <form onSubmit={submit} noValidate className="flex flex-col gap-5" data-testid="login-form">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                name="name"
                autoFocus
                autoComplete="name"
                placeholder="e.g. Priya Sharma"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? "name-error" : undefined}
              />
              {nameError && (
                <p id="name-error" role="alert" className="text-xs text-danger">
                  {nameError}
                </p>
              )}
            </div>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium">Role</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Role">
                {ROLES.map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      "flex cursor-pointer flex-col gap-0.5 rounded-md border p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                      role === option.value ? "border-primary bg-accent" : "border-input bg-card hover:border-muted-foreground/50",
                    )}
                  >
                    <input
                      type="radio"
                      name="role"
                      value={option.value}
                      checked={role === option.value}
                      onChange={() => setRole(option.value)}
                      className="sr-only"
                    />
                    <span className="text-sm font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">{option.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {login.isError && (
              <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger" data-testid="login-error">
                {login.error.message}
              </p>
            )}

            <Button type="submit" variant="primary" size="lg" disabled={login.isPending} data-testid="login-submit">
              {login.isPending ? "Signing in…" : "Continue"}
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">Demo sign-in: no password, any name works.</p>
      </div>
    </div>
  );
}
