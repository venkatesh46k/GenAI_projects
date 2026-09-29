import type { ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

interface Props extends Pick<ButtonProps, "variant" | "size"> {
  canAct: boolean;
  onClick: () => void;
  testId: string;
  /** Shown in the tooltip when canAct is false. Defaults to the team-lead-only reason, the console's only role gate. */
  reason?: string;
  children: ReactNode;
}

/** A button that only some roles may use. Stays visible and explains itself on hover rather than disappearing, so an
 * agent can see what exists without being able to do it (and a curious reviewer can see the whole feature set). */
export function RoleGatedButton({ canAct, onClick, testId, reason = "Only a team lead can do this", variant, size = "sm", children }: Props) {
  // Not a native `disabled` button: a disabled element fires no pointer/focus events, so Radix's tooltip trigger
  // would never see the hover that is supposed to explain why the button doesn't work. aria-disabled plus a
  // no-op handler reads the same to assistive tech and blocks the action just as well.
  const button = (
    <Button variant={variant} size={size} onClick={canAct ? onClick : undefined} aria-disabled={!canAct} className={cn(!canAct && "cursor-not-allowed opacity-50")} data-testid={testId}>
      {children}
    </Button>
  );
  return canAct ? button : <Tooltip label={reason}>{button}</Tooltip>;
}
