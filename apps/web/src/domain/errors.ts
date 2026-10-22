/** UNAVAILABLE: an outside service (GitHub) failed; the message says how. */
export type DomainErrorCode = "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "UNAVAILABLE";

/** A business rule the request broke. The message is written for the user and safe to show. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    /** Form field the error belongs to, when there is one. */
    readonly field?: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
