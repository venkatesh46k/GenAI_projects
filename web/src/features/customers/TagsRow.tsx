import { Plus, Tag as TagIcon, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { useTags } from "@/api/hooks";
import { Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

/** Free-form labels an agent puts on a customer (VIP, At risk, ...), shown as removable chips. */
export function TagsRow({ msisdn, tags }: { msisdn: string; tags: string[] }) {
  const { add, remove } = useTags(msisdn);
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const tag = value.trim();
    if (!tag) return setAdding(false);
    add.mutate(tag, { onSuccess: () => setValue("") });
    setAdding(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="customer-tags">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-foreground" data-testid={`tag-${tag}`}>
          <TagIcon className="size-3 text-muted-foreground" aria-hidden />
          {tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            onClick={() => remove.mutate(tag)}
            disabled={remove.isPending}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-border hover:text-foreground"
          >
            <X className="size-2.5" />
          </button>
        </span>
      ))}

      {adding ? (
        <form onSubmit={submit} className="inline-flex items-center">
          <Input
            ref={inputRef}
            data-testid="add-tag-input"
            autoFocus
            maxLength={24}
            placeholder="Tag name"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => !value && setAdding(false)}
            onKeyDown={(event) => event.key === "Escape" && setAdding(false)}
            className="h-6 w-28 rounded-full px-2.5 text-xs"
          />
        </form>
      ) : (
        <button
          type="button"
          data-testid="add-tag-open"
          onClick={() => setAdding(true)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-dashed border-input px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground",
          )}
        >
          <Plus className="size-3" /> Tag
        </button>
      )}
    </div>
  );
}
