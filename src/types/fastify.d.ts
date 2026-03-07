import type { AuthUser } from "./auth.ts";

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser;
  }
}
