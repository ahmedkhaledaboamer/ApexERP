/**
 * Error shape every API call rejects with; `status` mirrors the HTTP status. `code` is a stable
 * machine-readable reason for cases the UI branches on (workspace_not_found, tenant_mismatch,
 * workspace_suspended, workspace_required).
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message)
  }
}
