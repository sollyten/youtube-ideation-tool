/** HTTP-mapped errors thrown from the data layer and services. */

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = "Bad request") {
    super(400, message);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "Not signed in") {
    super(401, message);
  }
}

/** Cross-user access: the record exists but belongs to someone else. */
export class ForbiddenError extends HttpError {
  constructor(message = "You do not have access to this resource") {
    super(403, message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found") {
    super(404, message);
  }
}

export class ConflictError extends HttpError {
  constructor(message = "Conflict") {
    super(409, message);
  }
}

export class QuotaExceededError extends HttpError {
  constructor(message = "Daily quota for this action has been reached") {
    super(429, message);
  }
}

/** An upstream fetch (YouTube, Perplexity, Anthropic) failed. Never fabricate — surface it. */
export class UpstreamError extends HttpError {
  constructor(message: string) {
    super(502, message);
  }
}
