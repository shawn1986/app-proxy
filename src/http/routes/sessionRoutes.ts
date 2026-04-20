import type { FastifyInstance } from "fastify";
import type { createSessionRepository } from "../../storage/sessionRepository.js";

export async function registerSessionRoutes(
  app: FastifyInstance,
  repository: ReturnType<typeof createSessionRepository>,
) {
  app.get("/api/sessions", async () => repository.listSessions());

  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (request, reply) => {
    const session = repository.getSession(request.params.id);
    if (!session) {
      reply.code(404);
      return { message: "Session not found" };
    }
    return session;
  });
}
