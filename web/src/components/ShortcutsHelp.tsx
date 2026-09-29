import { Dialog, DialogContent } from "@/components/ui/overlays";
import { Kbd } from "@/components/ui/primitives";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl";

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: [mod, "K"], label: "Open the command palette" },
  { keys: [mod, "J"], label: "Open the Copilot" },
  { keys: ["?"], label: "Show this list" },
  { keys: ["Esc"], label: "Close a dialog, drawer or the palette" },
];

export function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keyboard shortcuts" data-testid="shortcuts-dialog">
        <ul className="flex flex-col divide-y divide-border px-5 py-2 text-sm">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.label} className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-muted-foreground">{shortcut.label}</span>
              <span className="flex gap-1">
                {shortcut.keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
