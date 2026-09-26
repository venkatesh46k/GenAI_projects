/** An error that maps directly to an HTTP response of the form {"detail": ...}. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string | unknown[],
  ) {
    super(typeof detail === "string" ? detail : "request validation failed");
  }
}
