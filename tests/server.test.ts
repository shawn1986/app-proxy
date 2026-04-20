import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isDirectRun } from "../src/server.js";

describe("isDirectRun", () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const serverPath = join(testDir, "..", "src", "server.ts");
  const serverUrl = pathToFileURL(serverPath).href;

  it("matches a Windows tsx invocation path", () => {
    expect(
      isDirectRun(serverUrl, serverPath),
    ).toBe(true);
  });

  it("returns false for a different entrypoint", () => {
    expect(isDirectRun(serverUrl, join(testDir, "..", "src", "other.ts"))).toBe(
      false,
    );
  });
});
