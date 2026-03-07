import fastify from "fastify";
import fastifyCors from "@fastify/cors";
import { registerErrorHandlers } from "./http.ts";
import { registerRoutes } from "./routes.ts";

interface CreateAppOptions {
  isShuttingDown?: () => boolean;
}

export function createApp(options: CreateAppOptions = {}) {
  const isShuttingDown = options.isShuttingDown ?? (() => false);
  const app = fastify();

  void app.register(fastifyCors);

  app.get("/health", async (_request, reply) => {
    if (isShuttingDown()) {
      return reply.code(503).send({ status: "shutting_down" });
    }

    return { status: "ok" };
  });

  void app.register(registerRoutes, { prefix: "/api" });
  registerErrorHandlers(app);

  return app;
}
