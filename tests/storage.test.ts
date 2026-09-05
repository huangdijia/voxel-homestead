import "fake-indexeddb/auto";
import { IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInventory } from "../src/game/inventory";
import {
  deleteWorld,
  downloadSave,
  importWorld,
  listWorlds,
  loadWorld,
  saveWorld,
  validateSave,
} from "../src/game/storage";
import type { SaveData } from "../src/game/types";
function fixture(id = crypto.randomUUID()): SaveData {
  return {
    manifest: {
      version: 1,
      generatorVersion: 1,
      id,
      name: "测试世界",
      seed: "oak",
      mode: "survival",
      createdAt: 1,
      updatedAt: 2,
      playedSeconds: 0,
    },
    player: {
      position: { x: 0.5, y: 40, z: -1.5 },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      pitch: 0,
      health: 20,
      hunger: 20,
      oxygen: 20,
      inventory: createInventory(),
      armor: { head: null, chest: null, legs: null, feet: null },
      selected: 0,
      spawn: { x: 0, y: 40, z: 0 },
      dead: false,
      flying: false,
    },
    changes: [
      { x: -1, y: 39, z: 0, id: 14 },
      { x: 1, y: 39, z: 0, id: 15 },
      { x: 1, y: 40, z: 0, id: 0 },
    ],
    containers: {
      "-1,39,0": {
        kind: "furnace",
        slots: [
          { id: "raw_iron", count: 3 },
          { id: "coal", count: 2 },
          { id: "iron_ingot", count: 1 },
        ],
        burn: 15,
        burnTotal: 80,
        progress: 5,
      },
      "1,39,0": {
        kind: "chest",
        slots: Array.from({ length: 27 }, (_, i) =>
          i === 0 ? { id: "torch", count: 16 } : null,
        ),
      },
    },
    entities: [
      {
        id: "sheep1",
        kind: "sheep",
        position: { x: 3.4, y: 39, z: -5.1 },
        health: 8,
        yaw: 2,
        timer: 1,
      },
    ],
    drops: [
      {
        id: "drop1",
        stack: { id: "wood_pickaxe", count: 1, durability: 7 },
        position: { x: 1.2, y: 40, z: 2.2 },
        age: 20,
      },
    ],
    time: 6000,
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("save validation", () => {
  it("round trips active furnaces, chests, removed blocks, drops and fractional positions", () => {
    const world = fixture();
    expect(validateSave(JSON.parse(JSON.stringify(world)))).toEqual(world);
  });
  it.each([
    [
      "future version",
      (w: any) => {
        w.manifest.version = 2;
      },
    ],
    [
      "unknown generator",
      (w: any) => {
        w.manifest.generatorVersion = 2;
      },
    ],
    [
      "NaN position",
      (w: any) => {
        w.player.position.x = NaN;
      },
    ],
    [
      "infinite timer",
      (w: any) => {
        w.entities[0].timer = Infinity;
      },
    ],
    [
      "unknown item",
      (w: any) => {
        w.player.inventory[0] = { id: "__proto__", count: 1 };
      },
    ],
    [
      "overfull item",
      (w: any) => {
        w.player.inventory[0] = { id: "dirt", count: 65 };
      },
    ],
    [
      "fractional count",
      (w: any) => {
        w.player.inventory[0] = { id: "dirt", count: 0.5 };
      },
    ],
    [
      "bad durability",
      (w: any) => {
        w.drops[0].stack.durability = 100;
      },
    ],
    [
      "wrong armor",
      (w: any) => {
        w.player.armor.head = { id: "iron_boots", count: 1 };
      },
    ],
    [
      "duplicate changes",
      (w: any) => {
        w.changes.push(w.changes[0]);
      },
    ],
    [
      "duplicate entity",
      (w: any) => {
        w.entities.push(w.entities[0]);
      },
    ],
    [
      "duplicate drop",
      (w: any) => {
        w.drops.push(w.drops[0]);
      },
    ],
    [
      "missing chest block",
      (w: any) => {
        w.changes[1].id = 0;
      },
    ],
    [
      "coordinate alias",
      (w: any) => {
        w.containers["01,39,0"] = w.containers["1,39,0"];
      },
    ],
    [
      "invalid chest capacity",
      (w: any) => {
        w.containers["1,39,0"].slots.pop();
      },
    ],
    [
      "extra field",
      (w: any) => {
        w.player.teleport = true;
      },
    ],
  ])("rejects %s", (_, mutate) => {
    const world = fixture();
    mutate(world);
    expect(() => validateSave(world)).toThrow("存档校验失败");
  });
  it("accepts spawn pickup cooldown and elapsed hostile attack timers", () => {
    const world = fixture();
    world.drops[0].age = -0.65;
    world.entities[0].timer = -20;
    expect(validateSave(world).drops[0].age).toBe(-0.65);
  });
  it("accepts death and an invalidated bed location as gameplay state", () => {
    const world = fixture();
    world.player.dead = true;
    world.player.health = 0;
    world.player.bedSpawn = { x: -3, y: 40, z: 5 };
    expect(validateSave(world).player.dead).toBe(true);
  });
});
describe("transaction checkpoints", () => {
  it("saves, lists, reloads and deletes a complete independent world", async () => {
    const world = fixture();
    await saveWorld(world);
    expect(await loadWorld(world.manifest.id)).toEqual(world);
    expect(
      (await listWorlds()).some(
        (manifest) => manifest.id === world.manifest.id,
      ),
    ).toBe(true);
    await deleteWorld(world.manifest.id);
    expect(await loadWorld(world.manifest.id)).toBeNull();
  });
  it("preserves the previous checkpoint when an in-flight transaction is aborted", async () => {
    const world = fixture();
    await saveWorld(world);
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      const request = originalPut.call(this, value, key);
      request.addEventListener("success", () => this.transaction.abort(), {
        once: true,
      });
      return request;
    });
    const next = structuredClone(world);
    next.containers["-1,39,0"].slots[2]!.count = 2;
    next.containers["-1,39,0"].slots[0]!.count = 2;
    next.player.inventory[0] = { id: "diamond_not_supported", count: 1 };
    await expect(saveWorld(next)).rejects.toThrow();
    next.player.inventory[0] = { id: "dirt", count: 1 };
    await expect(saveWorld(next)).rejects.toThrow("中断");
    expect(await loadWorld(world.manifest.id)).toEqual(world);
  });
  it("leaves previous data intact on quota failure", async () => {
    const world = fixture();
    await saveWorld(world);
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("Quota full", "QuotaExceededError");
    });
    const next = structuredClone(world);
    next.player.inventory[0] = { id: "iron_ingot", count: 32 };
    await expect(saveWorld(next)).rejects.toThrow("Quota full");
    expect(await loadWorld(world.manifest.id)).toEqual(world);
  });
  it("imports under a new id and never overwrites the source", async () => {
    const world = fixture();
    await saveWorld(world);
    const manifest = await importWorld(JSON.stringify(world));
    expect(manifest.id).not.toBe(world.manifest.id);
    expect(manifest.name).toContain("导入");
    expect((await loadWorld(manifest.id))?.containers).toEqual(
      world.containers,
    );
    expect(await loadWorld(world.manifest.id)).toEqual(world);
  });
  it("rejects bad JSON or future versions without writing", async () => {
    const before = await listWorlds();
    await expect(importWorld("{")).rejects.toThrow("JSON");
    const world: any = fixture();
    world.manifest.version = 9000;
    await expect(importWorld(JSON.stringify(world))).rejects.toThrow("版本");
    expect(await listWorlds()).toEqual(before);
  });
});

describe("live checkpoint downloads", () => {
  it("downloads the supplied current data without reading or writing browser storage", async () => {
    vi.useFakeTimers();
    const world = fixture();
    world.time = 17000;
    world.player.inventory[0] = { id: "iron_ingot", count: 17 };
    const before = structuredClone(world);
    const read = vi
      .spyOn(IDBObjectStore.prototype, "get")
      .mockImplementation(() => {
        throw new Error("IndexedDB unavailable");
      });
    const write = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(() => {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      });
    const link = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    const append = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn(() => link),
      body: { append },
    });
    let downloaded: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      downloaded = blob as Blob;
      return "blob:live-checkpoint";
    });
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    downloadSave(world);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledWith(link);
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.download).toBe("测试世界.voxel.json");
    expect(link.href).toBe("blob:live-checkpoint");
    expect(link.remove).toHaveBeenCalledOnce();
    expect(JSON.parse(await downloaded!.text())).toEqual(before);
    expect(world).toEqual(before);
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith("blob:live-checkpoint");
  });

  it("reports a download failure and cleans up its temporary link and object URL", () => {
    vi.useFakeTimers();
    const link = {
      href: "",
      download: "",
      remove: vi.fn(),
      click: vi.fn(() => {
        throw new Error("Download blocked");
      }),
    };
    vi.stubGlobal("document", {
      createElement: vi.fn(() => link),
      body: { append: vi.fn() },
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:failed-checkpoint");
    const revoke = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    expect(() => downloadSave(fixture())).toThrow("Download blocked");
    expect(link.remove).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith("blob:failed-checkpoint");
  });
});
