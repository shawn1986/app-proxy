import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { readCertificateState } from "../../ca/caStore.js";

export async function registerSetupRoutes(
  app: FastifyInstance,
  input: {
    proxyPort: number;
    certificateDir: string;
  },
) {
  app.get("/api/setup", async () => ({
    proxyPort: input.proxyPort,
    certificate: readCertificateState(input.certificateDir),
    androidSteps: [
      "Connect the Android device to the same Wi-Fi network as this computer.",
      "Set the Wi-Fi proxy host to this computer's LAN IP address and the port to the proxy port above.",
      "Install and trust the generated CA certificate if the app should allow HTTPS interception.",
    ],
  }));

  app.get("/api/certificate", async (_, reply) => {
    const state = readCertificateState(input.certificateDir);
    if (!state.exists) {
      reply.code(404);
      return { message: "CA certificate has not been generated yet" };
    }

    reply.header("content-type", "application/x-pem-file");
    return reply.send(createReadStream(state.caPath));
  });
}
