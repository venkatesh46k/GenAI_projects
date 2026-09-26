/** Every request goes to the Node web tier under /api, same origin, with the session cookie. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Detail = string | Array<{ loc?: unknown[]; msg?: string }> | undefined;

/** The server's {"detail": ...} as one readable sentence. */
function describe(detail: Detail, status: number): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0]?.msg) {
    const where = detail[0].loc?.filter((part) => part !== "body" && part !== "query").join(".");
    return where ? `${where}: ${detail[0].msg}` : detail[0].msg;
  }
  return status >= 500 ? "Something went wrong on our side. Please try again." : "The request could not be completed.";
}

export async function api<T>(path: string, init: Omit<RequestInit, "body"> & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...rest,
      headers: { accept: "application/json", ...(json !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your connection and try again.");
  }
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => undefined)) as { detail?: Detail } | T | undefined;
  if (!response.ok) throw new ApiError(response.status, describe((body as { detail?: Detail } | undefined)?.detail, response.status));
  return body as T;
}
