import { afterEach, describe, expect, it, vi } from "vitest";

describe("appConfig.httpHost", () => {
  afterEach(() => {
    delete process.env.APP_HOST;
    vi.resetModules();
  });

  it("defaults to 127.0.0.1", async () => {
    delete process.env.APP_HOST;
    vi.resetModules();

    const { appConfig } = await import("../src/config.js");

    expect(appConfig.httpHost).toBe("127.0.0.1");
  });

  it("respects APP_HOST=0.0.0.0", async () => {
    process.env.APP_HOST = "0.0.0.0";
    vi.resetModules();

    const { appConfig } = await import("../src/config.js");

    expect(appConfig.httpHost).toBe("0.0.0.0");
  });
});
