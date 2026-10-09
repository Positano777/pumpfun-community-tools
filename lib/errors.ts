/** An error that maps to an HTTP status; `fail()` in lib/http.ts renders it. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
