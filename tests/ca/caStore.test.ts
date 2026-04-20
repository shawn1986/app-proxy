import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCertificateState, resolveCaStorePaths } from "../../src/ca/caStore.js";

describe("CA store", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it("reports an incomplete CA store as missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ca-store-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    const certificateDir = join(dir, "certs");
    mkdirSync(certificateDir, { recursive: true });
    writeFileSync(join(certificateDir, "ca.pem"), "test ca");

    const state = readCertificateState(certificateDir);

    expect(state.exists).toBe(false);
    expect(state.createdAt).toBeNull();
  });

  it("reports a complete CA store as present", () => {
    const dir = mkdtempSync(join(tmpdir(), "ca-store-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    const certificateDir = join(dir, "certs");
    const keysDir = join(dir, "keys");
    mkdirSync(certificateDir, { recursive: true });
    mkdirSync(keysDir, { recursive: true });
    writeFileSync(join(certificateDir, "ca.pem"), "test ca");
    writeFileSync(join(keysDir, "ca.private.key"), "private");
    writeFileSync(join(keysDir, "ca.public.key"), "public");

    const state = readCertificateState(certificateDir);

    expect(state.exists).toBe(true);
    expect(state.caPath).toBe(join(certificateDir, "ca.pem"));
    expect(state.createdAt).not.toBeNull();
  });

  it("requires certificateDir to point at the certs directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "ca-store-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

    expect(() => resolveCaStorePaths(join(dir, "wrong"))).toThrow(/certs/i);
  });
});
