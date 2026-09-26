import { Badge } from "@/components/ui/primitives";
import { STATUS_TONE, statusLabel } from "@/lib/format";

/** Account status as a coloured pill. The word is always shown, so colour is never the only signal. */
export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "neutral";
  return (
    <Badge tone={tone} dot data-testid="status-badge">
      {statusLabel(status)}
    </Badge>
  );
}
