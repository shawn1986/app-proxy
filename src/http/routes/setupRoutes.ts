import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { readCertificateState } from "../../ca/caStore.js";
import type { HttpsMode } from "../../proxy/createProxyServer.js";

export async function registerSetupRoutes(
  app: FastifyInstance,
  input: {
    proxyPort: number;
    certificateDir: string;
    getHttpsMode: () => HttpsMode;
    setHttpsMode: (mode: HttpsMode) => Promise<void>;
  },
) {
  app.get("/api/setup", async () => ({
    proxyPort: input.proxyPort,
    httpsMode: input.getHttpsMode(),
    certificate: readCertificateState(input.certificateDir),
    androidSteps: [
      "Connect the Android device to the same Wi-Fi network as this computer.",
      "Set the Wi-Fi proxy host to this computer's LAN IP address and the port to the proxy port above.",
      "Use HTTPS tunnel mode if you only need host-level metadata and want to avoid certificate setup.",
      "Switch to HTTPS MITM mode only when you need decrypted HTTPS details.",
    ],
  }));

  app.post<{ Body: { mode?: string } }>("/api/setup/https-mode", async (request, reply) => {
    const mode = request.body?.mode;
    if (mode !== "mitm" && mode !== "tunnel") {
      reply.code(400);
      return { message: "mode must be either 'mitm' or 'tunnel'" };
    }

    await input.setHttpsMode(mode);
    return { httpsMode: input.getHttpsMode() };
  });

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
