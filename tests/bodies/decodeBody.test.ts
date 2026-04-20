import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeBody } from "../../src/bodies/decodeBody.js";

describe("decodeBody", () => {
  it("inflates gzip and truncates long text", () => {
    const longText = "a".repeat(6000);
    const result = decodeBody({
      payload: gzipSync(Buffer.from(longText)),
      contentEncoding: "gzip",
      contentType: "text/plain; charset=utf-8",
      maxPreviewBytes: 4096,
    });

    expect(result.preview.length).toBe(4096);
    expect(result.truncated).toBe(true);
    expect(result.preview.startsWith("aaaa")).toBe(true);
  });

  it("truncates by utf8 byte length for multibyte text", () => {
    const result = decodeBody({
      payload: Buffer.from("🙂".repeat(2000)),
      contentEncoding: undefined,
      contentType: "text/plain; charset=utf-8",
      maxPreviewBytes: 4096,
    });

    expect(Buffer.byteLength(result.preview, "utf8")).toBeLessThanOrEqual(4096);
    expect(result.preview).toBe("🙂".repeat(1024));
    expect(result.truncated).toBe(true);
  });

  it("inflates brotli and deflate payloads", () => {
    const brotli = decodeBody({
      payload: brotliCompressSync(Buffer.from('{"ok":"br"}')),
      contentEncoding: "br",
      contentType: "application/json",
      maxPreviewBytes: 4096,
    });
    const deflated = decodeBody({
      payload: deflateSync(Buffer.from("plain deflate text")),
      contentEncoding: "deflate",
      contentType: "text/plain",
      maxPreviewBytes: 4096,
    });

    expect(brotli.preview).toBe('{"ok":"br"}');
    expect(deflated.preview).toBe("plain deflate text");
  });

  it("marks previewability from content type", () => {
    const previewable = decodeBody({
      payload: Buffer.from('{"ok":true}'),
      contentEncoding: undefined,
      contentType: "application/json; charset=utf-8",
      maxPreviewBytes: 4096,
    });
    const binary = decodeBody({
      payload: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
      contentEncoding: undefined,
      contentType: "application/octet-stream",
      maxPreviewBytes: 4096,
    });

    expect(previewable.previewable).toBe(true);
    expect(binary.previewable).toBe(false);
  });
});
