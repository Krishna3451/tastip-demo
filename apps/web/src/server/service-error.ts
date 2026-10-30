/** Expected service failures safe to show to the caller; never include database/provider payloads. */
export class ServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}
