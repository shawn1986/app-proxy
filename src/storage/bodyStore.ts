import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { once } from "node:events";
import type { Writable } from "node:stream";

type BodyWriteStream = Writable;

export function createBodyStore(
  baseDir: string,
  dependencies: {
    createWriteStream?: (filePath: string) => BodyWriteStream;
  } = {},
) {
  mkdirSync(baseDir, { recursive: true });
  const createBodyWriteStream = dependencies.createWriteStream ?? createWriteStream;

  return {
    createBodyWriter(kind: "request" | "response") {
      let filePath: string | null = null;
      let stream: BodyWriteStream | null = null;
      let completion: Promise<void> | null = null;
      let finalized = false;
      let pendingWrite = Promise.resolve();

      function ensureStream() {
        if (stream) {
          return stream;
        }

        filePath = join(baseDir, `${kind}-${randomUUID()}.bin`);
        stream = createBodyWriteStream(filePath);
        completion = finished(stream).then(() => undefined);
        return stream;
      }

      return {
        write(chunk: Buffer) {
          if (finalized || chunk.length === 0) {
            return pendingWrite;
          }

          pendingWrite = pendingWrite.then(async () => {
            const target = ensureStream();
            if (!target.write(chunk)) {
              await once(target, "drain");
            }
          });
          return pendingWrite;
        },
        async finalize() {
          finalized = true;
          await pendingWrite;
          if (!stream || !completion) {
            return null;
          }

          stream.end();
          await completion;
          return filePath;
        },
        async abort() {
          finalized = true;
          try {
            await pendingWrite;
          } catch {
            // Ignore pending write failures during cleanup.
          }
          if (!stream || !completion || !filePath) {
            return;
          }

          stream.destroy();
          try {
            await completion;
          } catch {
            // Ignore write-stream teardown errors during cleanup.
          }
          await rm(filePath, { force: true });
        },
      };
    },
  };
}
