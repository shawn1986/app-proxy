import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createBodyStore } from "../../src/storage/bodyStore.js";

describe("body store", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("writes body chunks incrementally and returns the persisted path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "body-store-"));
    dirs.push(dir);

    const store = createBodyStore(dir);
    const writer = store.createBodyWriter("response");
    await writer.write(Buffer.from("hello "));
    await writer.write(Buffer.from("world"));

    const filePath = await writer.finalize();

    expect(filePath).toBeTruthy();
    expect(readFileSync(filePath!, "utf8")).toBe("hello world");
  });

  it("waits for drain when the write stream applies backpressure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "body-store-"));
    dirs.push(dir);

    class SlowWritable extends Writable {
      chunks: Buffer[] = [];

      constructor() {
        super({ highWaterMark: 1 });
      }

      _write(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
      ) {
        this.chunks.push(Buffer.from(chunk));
        setTimeout(() => callback(), 20);
      }
    }

    const slowStream = new SlowWritable();
    const store = createBodyStore(dir, {
      createWriteStream: () => slowStream,
    });
    const writer = store.createBodyWriter("response");

    let resolved = false;
    const writePromise = writer.write(Buffer.from("hello")).then(() => {
      resolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(resolved).toBe(false);

    await writePromise;
    const filePath = await writer.finalize();

    expect(resolved).toBe(true);
    expect(filePath).toBeTruthy();
    expect(Buffer.concat(slowStream.chunks).toString("utf8")).toBe("hello");
  });
});
