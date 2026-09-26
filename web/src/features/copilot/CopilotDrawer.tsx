import { useQuery } from "@tanstack/react-query";
import { ArrowUp, Check, ChevronRight, Loader2, RotateCcw, ShieldAlert, Sparkles, Square, User, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { keys } from "@/api/hooks";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { Badge } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ChatError, streamChat, type ChatResponse, type Step } from "./stream";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  response?: ChatResponse;
  error?: { message: string; retryable: boolean };
  /** The question that produced an error, so "Try again" can send it once more. */
  retry?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The customer open in the console, if any. */
  msisdn?: string;
}

const ROUTE_LABEL: Record<string, string> = {
  rag: "Knowledge base",
  balance: "Balance",
  dispute: "Dispute",
  escalation: "Escalation",
  testgen: "Browser test",
};

const SUGGESTIONS_WITH_CONTEXT = ["What is this customer's balance and plan?", "Why was the last recharge not applied?", "Raise a dispute for a double charge of ₹50"];
const SUGGESTIONS = ["How does a recharge get applied?", "What happens when the balance goes below ₹5?", "How long does a dispute take to resolve?"];

interface AssistantHealth {
  status: string;
  assistant: { ready: boolean } | null;
}

export function CopilotDrawer({ open, onOpenChange, msisdn }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [useContext, setUseContext] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const bottom = useRef<HTMLDivElement | null>(null);

  // While the models are still loading after a start, tell the agent the first answer will be slow.
  const health = useQuery({
    queryKey: keys.health,
    queryFn: () => api<AssistantHealth>("/api/health"),
    enabled: open,
    refetchInterval: (query) => (query.state.data?.assistant?.ready === false ? 5000 : false),
    staleTime: 0,
  });
  const warming = health.data?.assistant?.ready === false;
  const unavailable = health.data !== undefined && health.data.assistant === null;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, steps, open]);

  useEffect(() => () => abort.current?.abort(), []); // leaving the console cancels any question in flight

  const ask = useCallback(
    async (question: string) => {
      const query = question.trim();
      if (!query || busy) return;
      const controller = new AbortController();
      abort.current = controller;
      setBusy(true);
      setSteps([]);
      setDraft("");
      setMessages((prev) => [...prev, { id: nextId.current++, role: "user", text: query }]);
      try {
        await streamChat(
          { query, ...(msisdn && useContext ? { msisdn } : {}) },
          {
            onStep: (step) => setSteps((prev) => [...prev, step]),
            onResult: (response) => setMessages((prev) => [...prev, { id: nextId.current++, role: "assistant", text: response.answer, response }]),
          },
          controller.signal,
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          const chatError = error instanceof ChatError ? error : new ChatError("The assistant ran into a problem. Please try again.");
          setMessages((prev) => [
            ...prev,
            { id: nextId.current++, role: "assistant", text: "", error: { message: chatError.message, retryable: chatError.retryable }, retry: query },
          ]);
        }
      } finally {
        setBusy(false);
        setSteps([]);
      }
    },
    [busy, msisdn, useContext],
  );

  function stop() {
    abort.current?.abort();
    setMessages((prev) => [...prev, { id: nextId.current++, role: "assistant", text: "Stopped. Ask again whenever you are ready." }]);
  }

  function reset() {
    abort.current?.abort();
    setMessages([]);
    setSteps([]);
    setBusy(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void ask(draft);
    }
  }

  const suggestions = msisdn && useContext ? SUGGESTIONS_WITH_CONTEXT : SUGGESTIONS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent placement="right" title="Copilot" description="Ask about balances, recharges, disputes and billing policy." data-testid="copilot-drawer" className="max-w-[30rem]">
        <div className="flex items-center gap-2 border-b border-border px-5 py-2 pr-14">
          {msisdn ? (
            <button
              type="button"
              onClick={() => setUseContext((value) => !value)}
              aria-pressed={useContext}
              data-testid="copilot-context"
              title={useContext ? "The Copilot knows which customer is open. Click to stop sharing it." : "Click to let the Copilot use the open customer."}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                useContext ? "border-primary bg-accent text-accent-foreground" : "border-input text-muted-foreground",
              )}
            >
              {useContext ? <Check className="size-3" /> : <X className="size-3" />}
              <span className="tabular">{msisdn}</span>
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">No customer open: name a number in your question.</span>
          )}
          <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs" onClick={reset} disabled={messages.length === 0 && !busy} data-testid="copilot-new">
            <RotateCcw /> New chat
          </Button>
        </div>

        {warming && (
          <p role="status" data-testid="copilot-warming" className="border-b border-border bg-warning-soft px-5 py-2 text-xs text-warning">
            The assistant is still starting up. The first answer can take a minute or two.
          </p>
        )}
        {unavailable && (
          <p role="alert" data-testid="copilot-unavailable" className="border-b border-border bg-danger-soft px-5 py-2 text-xs text-danger">
            The assistant is not reachable right now. Running locally? Start everything with <code className="font-mono">python scripts/dev.py</code>. The rest of the console still works.
          </p>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4" aria-live="polite" data-testid="copilot-thread">
          {messages.length === 0 && !busy ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Sparkles className="size-5" />
              </span>
              <p className="text-sm font-medium">How can I help?</p>
              <div className="flex w-full flex-col gap-2">
                {suggestions.map((text, index) => (
                  <button
                    key={text}
                    type="button"
                    data-testid={`suggestion-${index}`}
                    onClick={() => void ask(text)}
                    className="rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-4">
              {messages.map((message) => (
                <li key={message.id}>
                  <MessageView message={message} onRetry={(question) => void ask(question)} disabled={busy} />
                </li>
              ))}
              {busy && (
                <li data-testid="copilot-steps" className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                  {steps.map((step, index) => (
                    <p key={index} className="flex items-center gap-2">
                      <Check className="size-3.5 text-success" aria-hidden /> {step.message}
                    </p>
                  ))}
                  <p className="flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden /> {steps.length === 0 ? "Working on it…" : "Still working…"}
                  </p>
                </li>
              )}
            </ul>
          )}
          <div ref={bottom} />
        </div>

        <form onSubmit={submit} className="flex items-end gap-2 border-t border-border p-3">
          <textarea
            data-testid="copilot-input"
            aria-label="Ask the Copilot"
            rows={2}
            maxLength={2000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about a balance, a recharge or a dispute…"
            className="min-h-14 flex-1 resize-none rounded-md border border-input bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          {busy ? (
            <Button type="button" variant="secondary" size="icon" onClick={stop} aria-label="Stop" data-testid="copilot-stop">
              <Square />
            </Button>
          ) : (
            <Button type="submit" variant="primary" size="icon" aria-label="Send" data-testid="copilot-send" disabled={!draft.trim()}>
              <ArrowUp />
            </Button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MessageView({ message, onRetry, disabled }: { message: Message; onRetry: (question: string) => void; disabled: boolean }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end gap-2" data-testid="copilot-message-user">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">{message.text}</p>
        <User className="mt-1.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (message.error) {
    return (
      <div role="alert" data-testid="copilot-error" className="flex flex-col items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
        <p>{message.error.message}</p>
        {message.error.retryable && message.retry && (
          <Button variant="secondary" size="sm" disabled={disabled} onClick={() => onRetry(message.retry!)} data-testid="copilot-retry">
            Try again
          </Button>
        )}
      </div>
    );
  }

  const response = message.response;
  return (
    <div className="flex gap-2" data-testid="copilot-message-assistant">
      <Sparkles className="mt-1.5 size-4 shrink-0 text-primary" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {response?.safety_flag && (
          <p className="flex items-center gap-1.5 text-xs text-warning" data-testid="copilot-blocked">
            <ShieldAlert className="size-3.5" /> This reply was held back by the safety check.
          </p>
        )}
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{renderInline(message.text)}</p>
        {response && <ResponseDetails response={response} />}
      </div>
    </div>
  );
}

function ResponseDetails({ response }: { response: ChatResponse }) {
  const evidence = response.test_result?.evidence_url;
  const sources = response.sources ?? [];
  const toolCalls = response.tool_calls ?? [];
  const hasDetails = sources.length > 0 || toolCalls.length > 0;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="info" data-testid="copilot-route">
          {ROUTE_LABEL[response.route] ?? response.route}
        </Badge>
        {response.pii_masked && <Badge tone="neutral">Numbers masked</Badge>}
        {response.dispute_id && <Badge tone="warning">{response.dispute_id}</Badge>}
        {response.ticket_id && <Badge tone="success">{response.ticket_id}</Badge>}
      </div>

      {response.test_result && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-2.5" data-testid="copilot-test-result">
          <div className="flex items-center gap-2 text-sm">
            <Badge tone={response.test_result.status === "pass" ? "success" : "danger"} dot>
              {response.test_result.status === "pass" ? "Passed" : "Failed"}
            </Badge>
            {response.test_result.steps_completed != null && <span className="text-xs text-muted-foreground">{response.test_result.steps_completed} steps completed</span>}
          </div>
          <p className="text-xs text-muted-foreground">{response.test_result.detail}</p>
          {evidence && (
            <a href={evidence} target="_blank" rel="noreferrer" title="Open the full screenshot">
              <img src={evidence} alt="Screenshot of the finished browser test" data-testid="copilot-evidence" loading="lazy" onLoad={(event) => event.currentTarget.scrollIntoView({ block: "nearest" })} className="w-full rounded border border-border" />
            </a>
          )}
        </div>
      )}

      {hasDetails && (
        <details className="group rounded-md border border-border text-xs" data-testid="copilot-details">
          <summary className="flex cursor-pointer list-none items-center gap-1 px-2.5 py-1.5 text-muted-foreground hover:text-foreground">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden /> How this was answered
          </summary>
          <div className="flex flex-col gap-3 border-t border-border px-2.5 py-2">
            {sources.length > 0 && (
              <section>
                <h3 className="mb-1 font-medium">Sources</h3>
                <ul className="flex flex-col gap-1 text-muted-foreground">
                  {sources.map((source, index) => (
                    <li key={index} className="line-clamp-3 break-words">
                      {source}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {toolCalls.length > 0 && (
              <section>
                <h3 className="mb-1 font-medium">Billing calls</h3>
                <ul className="flex flex-col gap-1 text-muted-foreground">
                  {toolCalls.map((call, index) => (
                    <li key={index} className="break-all font-mono">
                      {JSON.stringify(call)}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </details>
      )}
    </>
  );
}

/** The model often answers with **bold** and `code`. Rendered as React nodes, never as HTML, so the text stays inert. */
export function renderInline(text: string): ReactNode {
  return text.replace(/[\u202f\u00a0]/g, " ").split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, index) => {
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={index} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}
