export class AppError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode = 400, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    // new.target is whichever constructor was actually invoked (AppError
    // itself, or a subclass like UnauthorizedError via super()) — using it
    // here (instead of the hardcoded AppError.prototype) keeps `instanceof
    // UnauthorizedError` etc. working correctly after the ES5-target
    // Error-subclassing workaround, rather than collapsing every subclass
    // down to plain AppError.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(message, 409);
  }
}
