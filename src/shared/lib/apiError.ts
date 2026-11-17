/** Error shape every API call rejects with; `status` mirrors the HTTP status. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}
