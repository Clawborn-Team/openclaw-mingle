import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DeliveryStateStore, resolveDeliveryStatePath } from "../src/state.js";

describe("DeliveryStateStore", () => {
  let stateDir: string;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), "openclaw-mingle-state-"));
  });

  it("starts empty for missing or corrupt state", async () => {
    const store = new DeliveryStateStore({ accountId: "default", stateDir });
    expect(await store.load()).toEqual({ version: 1, acceptedEventIds: [] });

    await writeFile(resolveDeliveryStatePath("default", stateDir), "{broken", { flag: "w" }).catch(
      async () => {
        await store.saveCursor("seed");
        await writeFile(resolveDeliveryStatePath("default", stateDir), "{broken");
      },
    );
    expect(await store.load()).toEqual({ version: 1, acceptedEventIds: [] });
  });

  it("isolates accounts and persists cursor independently from accepted IDs", async () => {
    const alpha = new DeliveryStateStore({ accountId: "alpha", stateDir });
    const beta = new DeliveryStateStore({ accountId: "beta", stateDir });

    await alpha.saveCursor("cursor-a");
    await alpha.markAccepted("evt-a");
    await beta.saveCursor("cursor-b");

    expect(await new DeliveryStateStore({ accountId: "alpha", stateDir }).load()).toEqual({
      version: 1,
      cursor: "cursor-a",
      acceptedEventIds: ["evt-a"],
    });
    expect(await beta.load()).toEqual({
      version: 1,
      cursor: "cursor-b",
      acceptedEventIds: [],
    });
  });

  it("deduplicates accepted IDs, persists across restart, and bounds the cache", async () => {
    const store = new DeliveryStateStore({ accountId: "default", stateDir, maxAccepted: 3 });
    await store.markAccepted("evt-1");
    await store.markAccepted("evt-2");
    await store.markAccepted("evt-2");
    await store.markAccepted("evt-3");
    await store.markAccepted("evt-4");

    const restarted = new DeliveryStateStore({ accountId: "default", stateDir, maxAccepted: 3 });
    expect(await restarted.load()).toMatchObject({ acceptedEventIds: ["evt-2", "evt-3", "evt-4"] });
    expect(await restarted.hasAccepted("evt-1")).toBe(false);
    expect(await restarted.hasAccepted("evt-4")).toBe(true);
  });

  it("writes valid JSON atomically with owner-only permissions", async () => {
    const store = new DeliveryStateStore({ accountId: "a/../unsafe", stateDir });
    await Promise.all([store.saveCursor("one"), store.markAccepted("evt-1")]);

    const path = resolveDeliveryStatePath("a/../unsafe", stateDir);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ version: 1 });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(path.startsWith(join(stateDir, "openclaw-mingle"))).toBe(true);
  });
});
