import type { CdrItem, DisputeSummary, NoteItem, TransactionItem } from "@contract/schemas";
import { AlertOctagon, MessageSquareText, Phone, StickyNote, Wallet, Wifi } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useAddNote } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { formatUsage, formatWhen, money } from "@/lib/format";

interface Props {
  msisdn: string;
  usage: CdrItem[];
  transactions: TransactionItem[];
  disputes: DisputeSummary[];
  notes: NoteItem[];
}

type Entry =
  | { kind: "note"; at: string; note: NoteItem }
  | { kind: "transaction"; at: string; txn: TransactionItem }
  | { kind: "usage"; at: string; cdr: CdrItem }
  | { kind: "dispute"; at: string; dispute: DisputeSummary };

/** One chronological feed of everything that happened on this account: usage, transactions, disputes and the notes
 * an agent left. A real audit log would also record who changed a plan or barred a number; this is the demo's cut. */
export function ActivityTab({ msisdn, usage, transactions, disputes, notes }: Props) {
  const addNote = useAddNote(msisdn);
  const [text, setText] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    addNote.mutate(trimmed, { onSuccess: () => setText("") });
  }

  const entries: Entry[] = [
    ...notes.map((note): Entry => ({ kind: "note", at: note.created_at, note })),
    ...transactions.map((txn): Entry => ({ kind: "transaction", at: txn.timestamp, txn })),
    ...usage.map((cdr): Entry => ({ kind: "usage", at: cdr.timestamp, cdr })),
    ...disputes.map((dispute): Entry => ({ kind: "dispute", at: dispute.created_at, dispute })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="activity-tab">
      <form onSubmit={submit} className="flex flex-col gap-2 rounded-md border border-border p-3">
        <label htmlFor="new-note" className="text-xs font-medium text-muted-foreground">
          Add a note (visible to your team, not to the customer)
        </label>
        <textarea
          id="new-note"
          data-testid="note-input"
          rows={2}
          maxLength={2000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="e.g. Customer asked about switching to the Premium plan next cycle."
          className="resize-none rounded-md border border-input bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" variant="secondary" size="sm" className="self-end" disabled={!text.trim() || addNote.isPending} data-testid="add-note-submit">
          {addNote.isPending ? "Saving…" : "Add note"}
        </Button>
      </form>

      {entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="flex flex-col gap-3" data-testid="activity-feed">
          {entries.map((entry) => (
            <ActivityRow key={`${entry.kind}-${entryId(entry)}`} entry={entry} />
          ))}
        </ol>
      )}
    </div>
  );
}

function entryId(entry: Entry): string {
  switch (entry.kind) {
    case "note":
      return entry.note.note_id;
    case "transaction":
      return entry.txn.txn_id;
    case "usage":
      return entry.cdr.cdr_id;
    case "dispute":
      return entry.dispute.dispute_id;
  }
}

function ActivityRow({ entry }: { entry: Entry }) {
  const { icon, body } = describe(entry);
  return (
    <li className="flex gap-3 text-sm" data-testid={`activity-${entry.kind}`}>
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        {body}
        <span className="text-xs text-muted-foreground">{formatWhen(entry.at)}</span>
      </div>
    </li>
  );
}

function describe(entry: Entry): { icon: ReactNode; body: ReactNode } {
  const icon16 = "size-3.5";
  if (entry.kind === "note") {
    return {
      icon: <StickyNote className={icon16} />,
      body: (
        <>
          <p className="whitespace-pre-wrap break-words">{entry.note.text}</p>
          <span className="text-xs text-muted-foreground">
            {entry.note.author_name} · {entry.note.author_role === "team_lead" ? "Team lead" : "Agent"}
          </span>
        </>
      ),
    };
  }
  if (entry.kind === "transaction") {
    return {
      icon: <Wallet className={icon16} />,
      body: (
        <p>
          <span className="capitalize">{entry.txn.type}</span> of <span className="tabular font-medium">{money(entry.txn.amount)}</span> · balance {money(entry.txn.balance_after)}
        </p>
      ),
    };
  }
  if (entry.kind === "dispute") {
    return {
      icon: <AlertOctagon className={icon16} />,
      body: (
        <p>
          Dispute <span className="tabular font-medium">{entry.dispute.dispute_id}</span> ({entry.dispute.status}): {entry.dispute.reason}
        </p>
      ),
    };
  }
  const Icon = entry.cdr.call_type === "voice" ? Phone : entry.cdr.call_type === "sms" ? MessageSquareText : Wifi;
  return {
    icon: <Icon className={icon16} />,
    body: (
      <p>
        <span className="capitalize">{entry.cdr.call_type}</span> usage: {formatUsage(entry.cdr)} · {money(entry.cdr.charge)}
      </p>
    ),
  };
}
