import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  MINGLE_RUNTIME,
  MINGLE_RUNTIME_CAPABILITIES,
  MINGLE_RUNTIME_VERSION,
} from "../src/version.js";

describe("Mingle runtime identity", () => {
  it("matches the package version and advertises only the supported updater", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };

    expect(MINGLE_RUNTIME).toBe("openclaw-mingle");
    expect(MINGLE_RUNTIME_VERSION).toBe(packageJson.version);
    expect(MINGLE_RUNTIME_CAPABILITIES).toEqual(["plugin-update-v1"]);
  });
});
