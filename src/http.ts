import type { FastifyInstance } from "fastify";

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function isDatabaseConflict(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

export function registerErrorHandlers(app: FastifyInstance) {
  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({ error: "Not found" });
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (isDatabaseConflict(error)) {
      return reply.code(409).send({ error: "Resource already exists" });
    }

    if (error instanceof HttpError) {
      return reply.code(error.status).send({ error: error.message });
    }

    request.log.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  });
}
