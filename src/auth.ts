import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import jwt from "jsonwebtoken";
import { config } from "./config.ts";
import { HttpError } from "./http.ts";
import type { AuthUser } from "./types/auth.ts";

export function extractBearerToken(header?: string) {
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}

export const authenticate: preHandlerHookHandler = async (
  request: FastifyRequest,
  _reply: FastifyReply,
) => {
  const token = extractBearerToken(request.headers.authorization);

  if (!token) {
    throw new HttpError(401, "No token");
  }

  try {
    const payload = jwt.verify(token, config.auth.jwtSecret);

    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof payload.id !== "string"
    ) {
      throw new HttpError(401, "Invalid token");
    }

    request.user = { id: payload.id } satisfies AuthUser;
    return;
  } catch {
    throw new HttpError(401, "Invalid token");
  }
};
