/** DEV-only fixture; requires a fresh named survival world. Explicit grants are
 * tools, workshop building materials, lapis and eight cow entities. Cane/leather,
 * paper/books, beef and the first table/bookshelf are obtained through real rules.
 * Teleports, a small cleared workshop and accelerated fixed ticks are scaffolding.
 * Later 14 shelves and enough XP to reach level 30 are declared UI-only setup.
 */
export async function runBrowserEnchanting() {
  const game = window.__voxelGame,
    sim = game?.simulation,
    world = game?.world;
  const report = (window.__enchantingAcceptance = {
    version: 1,
    passed: false,
    startedAt: new Date().toISOString(),
    stages: [],
    checkpoints: [],
    errors: [],
    advancedSeconds: 0,
    fixture: [
      "Fresh survival world; grants diamond pickaxe/sword, workbench, furnace, coal2, planks30, diamond2, obsidian4, lapis6",
      "Natural cane is harvested then planted and grown; leather/beef come from eight spawned adult cows killed using attack",
      "Teleports, cleared workshop/water trench, hunger10 eating fixture and accelerated 60Hz ticks",
      "After resource-chain proof, grants 14 shelves and supplements XP to level30; seed0 for UI validation",
    ],
    limitations: [
      "Not an unassisted survival playthrough, full Minecraft parity, native-fullscreen proof or FPS benchmark",
    ],
  });
  const assert = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const canonical = (v) =>
    JSON.stringify(v, (_k, e) =>
      e && typeof e === "object" && !Array.isArray(e)
        ? Object.fromEntries(
            Object.entries(e).sort(([a], [b]) => a.localeCompare(b)),
          )
        : e,
    );
  try {
    assert(
      sim?.manifest.name === "书与微光 · 附魔验收" &&
        sim.manifest.seed === "M2-enchanting-20260905" &&
        sim.manifest.generatorVersion === 6 &&
        sim.manifest.mode === "survival",
      "Wrong world",
    );
    assert(
      world.getChanges().length === 0 && sim.player.inventory.every((s) => !s),
      "World not fresh",
    );
    game.showOverlay("pause");
    const initialPlayedSeconds = sim.manifest.playedSeconds;
    sim.player.hunger = 10;
    const { addItem, countItem } = await import("/src/game/inventory.ts"),
      { ITEMS } = await import("/src/game/registry.ts"),
      storage = await import("/src/game/storage.ts"),
      { BOOKSHELF_OFFSETS } = await import("/src/game/enchanting.ts"),
      { experienceForLevel } = await import("/src/game/experience.ts");
    const idle = {
      forward: 0,
      right: 0,
      jump: false,
      sprint: false,
      sneak: false,
    };
    const count = (id) => countItem(sim.player.inventory, id);
    const stage = (name, values = {}) =>
      report.stages.push({ name, passed: true, ...values });
    const set = (x, y, z, id) =>
      assert(sim.setBlock(x, y, z, id), `Edit rejected ${x},${y},${z}`);
    const grant = (id, count) =>
      assert(
        !addItem(sim.player.inventory, {
          id,
          count,
          ...(ITEMS[id].maxDurability
            ? { durability: ITEMS[id].maxDurability }
            : {}),
        }),
        `Grant full ${id}`,
      );
    const look = (p) => {
      const e = sim.eye(),
        dx = p.x - e.x,
        dy = p.y - e.y,
        dz = p.z - e.z;
      sim.player.yaw = Math.atan2(-dx, -dz);
      sim.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    };
    const waitReady = async (points) => {
      const start = performance.now();
      while (!points.every((p) => world.isReady(p.x, p.z, p.y))) {
        assert(performance.now() - start < 60000, "Load timeout");
        await new Promise(requestAnimationFrame);
      }
    };
    const teleport = async (p) => {
      sim.player.position = { ...p };
      sim.player.velocity = { x: 0, y: 0, z: 0 };
      world.update(p, game.settings.renderDistance);
      await waitReady(
        [-1, 0, 1].flatMap((dx) =>
          [-1, 0, 1].flatMap((dz) =>
            [-1, 0, 1, 2, 3].map((dy) => ({
              x: p.x + dx,
              y: p.y + dy,
              z: p.z + dz,
            })),
          ),
        ),
      );
    };
    const advance = async (seconds) => {
      for (let i = 0; i < Math.round(seconds * 60); i++) {
        sim.step(1 / 60, idle);
        report.advancedSeconds += 1 / 60;
        if (i % 120 === 0) await new Promise(requestAnimationFrame);
      }
      assert(!sim.player.dead, "Fixture player died");
    };
    const select = (id) => {
      const i = sim.player.inventory.findIndex((s) => s?.id === id);
      assert(i >= 0, `Missing ${id}`);
      if (i > 8)
        [sim.player.inventory[8], sim.player.inventory[i]] = [
          sim.player.inventory[i],
          sim.player.inventory[8],
        ];
      sim.player.selected = Math.min(i, 8);
    };
    const place = async (id, p) => {
      await teleport({ x: p.x + 0.5, y: p.y, z: p.z + 2.5 });
      select(id);
      look({ x: p.x + 0.5, y: p.y, z: p.z + 0.5 });
      assert(sim.target()?.normal.y === 1, `No top face for ${id}`);
      sim.interact();
      assert(
        world.getBlock(p.x, p.y, p.z) === ITEMS[id].block,
        `Place failed ${id}`,
      );
    };
    const checkpoint = async (name) => {
      const before = storage.validateSave(sim.snapshot());
      await storage.saveWorld(before);
      const after = await storage.loadWorld(before.manifest.id);
      assert(
        canonical(before) === canonical(after),
        `Checkpoint mismatch ${name}`,
      );
      report.checkpoints.push({
        name,
        passed: true,
        version: after.manifest.version,
        points: after.progression.points,
      });
    };
    for (const [id, n] of [
      ["diamond_pickaxe", 1],
      ["diamond_sword", 1],
      ["workbench", 1],
      ["furnace", 1],
      ["coal", 2],
      ["planks", 30],
      ["diamond", 2],
      ["obsidian", 4],
      ["lapis_lazuli", 6],
    ])
      grant(id, n);
    await teleport({ x: 0.5, y: 63, z: -179.5 });
    select("diamond_pickaxe");
    for (const x of [0, -1])
      for (const y of [65, 64, 63]) {
        assert(world.getBlock(x, y, -181) === 111, "Natural cane absent");
        sim.breakBlock({ x, y, z: -181 });
      }
    await teleport({ x: 0, y: 63, z: -180.5 });
    await advance(2);
    assert(count("sugar_cane") === 6, "Natural cane pickup mismatch");
    stage("natural-cane", {
      coordinates: [
        [0, 63, -181],
        [-1, 63, -181],
      ],
      collected: 6,
    });
    const base = Math.floor(sim.player.spawn.y) - 1;
    report.workshopY = base + 1;
    await teleport({ x: 0.5, y: base + 1, z: 4.5 });
    await waitReady([
      { x: -8, y: base, z: -8 },
      { x: 8, y: base + 6, z: 8 },
    ]);
    for (let x = -8; x <= 8; x++)
      for (let z = -8; z <= 8; z++) {
        set(x, base, z, 4);
        for (let y = base + 1; y <= base + 6; y++) set(x, y, z, 0);
      }
    for (const x of [-4, -3]) set(x, base, -2, 6);
    await place("sugar_cane", { x: -4, y: base + 1, z: -1 });
    await place("sugar_cane", { x: -3, y: base + 1, z: -1 });
    assert(count("sugar_cane") === 4, "Plant consumption mismatch");
    await teleport({ x: -3, y: base + 1, z: 1.5 });
    for (let round = 0; round < 2; round++) {
      await advance(245);
      for (const x of [-4, -3])
        for (const y of [base + 3, base + 2]) {
          assert(
            world.getBlock(x, y, -1) === 111,
            `Cane did not grow round${round}`,
          );
          sim.breakBlock({ x, y, z: -1 });
        }
      await teleport({ x: -3, y: base + 1, z: -0.3 });
      await advance(2);
    }
    assert(count("sugar_cane") === 12, "Growth pickup mismatch");
    stage("cane-plant-and-grow", {
      rootCount: 2,
      harvested: 12,
      activeSeconds: 490,
    });
    await checkpoint("cane-farm");
    let leatherBefore = count("leather"),
      xpBefore = sim.progression.points;
    for (let i = 0; i < 8; i++) {
      await teleport({ x: 3.5, y: base + 1, z: 4.5 });
      select("diamond_sword");
      const cow = {
        id: crypto.randomUUID(),
        kind: "cow",
        position: { x: 3.5, y: base + 1, z: 2.5 },
        health: 10,
        yaw: 0,
        timer: 10,
      };
      sim.entities.push(cow);
      for (let hit = 0; hit < 3 && sim.entities.includes(cow); hit++) {
        look({ ...cow.position, y: cow.position.y + 0.55 });
        assert(sim.attack(), "Cow attack did not connect");
        await advance(0.6);
      }
      assert(!sim.entities.includes(cow), "Cow survived");
      await teleport({ ...cow.position });
      await advance(1.5);
    }
    assert(
      count("leather") - leatherBefore >= 4,
      "Insufficient cow leather in fixture",
    );
    assert(count("raw_beef") >= 8, "Beef not obtained");
    stage("hunting-and-xp", {
      leather: count("leather"),
      rawBeef: count("raw_beef"),
      experienceEarned: sim.progression.points - xpBefore,
    });
    await place("workbench", { x: 3, y: base + 1, z: -3 });
    await place("furnace", { x: 4, y: base + 1, z: -3 });
    await teleport({ x: 3.5, y: base + 1, z: -0.5 });
    look({ x: 3.5, y: base + 1.5, z: -2.5 });
    sim.interact();
    assert(sim.station === "workbench", "Workbench did not open");
    for (let i = 0; i < 4; i++) sim.craft("paper");
    assert(
      count("paper") === 12 && count("sugar_cane") === 0,
      "Paper material mismatch",
    );
    for (let i = 0; i < 4; i++) sim.craft("book");
    assert(count("book") === 4 && count("paper") === 0, "Book mismatch");
    sim.craft("enchanting_table");
    sim.craft("bookshelf");
    assert(
      count("enchanting_table") === 1 &&
        count("bookshelf") === 1 &&
        count("book") === 0,
      "Table/bookshelf chain failed",
    );
    sim.closeContainer();
    stage("paper-book-table", { booksMade: 4, table: 1, bookshelf: 1 });
    await teleport({ x: 4.5, y: base + 1, z: -0.5 });
    look({ x: 4.5, y: base + 1.5, z: -2.5 });
    sim.interact();
    assert(sim.container?.kind === "furnace", "No furnace");
    const transfer = (id, n, index) => {
      const i = sim.player.inventory.findIndex((s) => s?.id === id);
      assert(
        i >= 0 && sim.player.inventory[i].count >= n,
        "Furnace input absent",
      );
      sim.player.inventory[i].count -= n;
      if (!sim.player.inventory[i].count) sim.player.inventory[i] = null;
      sim.container.slots[index] = { id, count: n };
    };
    transfer("raw_beef", 2, 0);
    transfer("coal", 1, 1);
    await advance(20.2);
    assert(
      sim.container.slots[2]?.id === "cooked_beef" &&
        sim.container.slots[2].count === 2,
      "Cooking failed",
    );
    assert(
      Math.abs(sim.container.experience - 0.7) < 1e-9,
      "Furnace XP bank mismatch",
    );
    await checkpoint("unclaimed-furnace-xp");
    sim.clickSlot("container", 2, false, true);
    assert(
      sim.container.experience === 0 && count("cooked_beef") === 2,
      "Output claim failed",
    );
    sim.closeContainer();
    await advance(1);
    const hunger = sim.player.hunger;
    select("cooked_beef");
    look({ x: 4.5, y: base + 8, z: 0 });
    sim.interact();
    await advance(1.7);
    assert(
      count("cooked_beef") === 1 && sim.player.hunger > hunger,
      "Steak eating failed",
    );
    stage("cook-eat-and-claim", {
      bankBefore: 0.7,
      bankAfter: 0,
      cookedRemaining: 1,
    });
    await place("enchanting_table", { x: 0, y: base + 1, z: 0 });
    await place("bookshelf", { x: -2, y: base + 1, z: 0 });
    const craftedShelfKey = "-2,0";
    let placed = 1;
    for (const p of BOOKSHELF_OFFSETS) {
      if (`${p.x},${p.z}` === craftedShelfKey && p.y === 0) continue;
      if (placed >= 15) break;
      set(p.x, base + 1 + p.y, p.z, 113);
      placed++;
    }
    report.earnedExperience = sim.progression.points;
    report.supplementedExperience = Math.max(
      0,
      experienceForLevel(30) - sim.progression.points,
    );
    sim.progression.points = experienceForLevel(30);
    sim.progression.enchantmentSeed = 0;
    await teleport({ x: 0.5, y: base + 1, z: 1.6 });
    look({ x: 0.5, y: base + 1.4, z: 0.5 });
    sim.interact();
    assert(sim.station === "enchanting", "Table interaction failed");
    sim.clickSlot(
      "inventory",
      sim.player.inventory.findIndex((s) => s?.id === "diamond_pickaxe"),
      false,
      true,
    );
    sim.clickSlot(
      "inventory",
      sim.player.inventory.findIndex((s) => s?.id === "lapis_lazuli"),
      false,
      true,
    );
    const view = sim.getEnchanting();
    assert(
      view.bookshelves === 15 &&
        view.offers[2].requiredLevel === 30 &&
        view.offers[2].available,
      "Offer incorrect",
    );
    report.beforePurchase = {
      points: sim.progression.points,
      lapis: sim.craftSlots[1].count,
      seed: sim.progression.enchantmentSeed,
      offers: view.offers,
    };
    stage("enchanting-ui-ready", { view });
    game.showOverlay("enchanting");
    report.worldId = sim.manifest.id;
    report.prepared = true;
    report.initialPlayedSeconds = initialPlayedSeconds;
    report.finishedAt = new Date().toISOString();
  } catch (error) {
    report.errors.push(String(error));
    game?.showOverlay("pause");
  }
  return report;
}

/** Invoke after the visible third offer button has actually been clicked. */
export async function finishBrowserEnchanting() {
  const game = window.__voxelGame,
    sim = game.simulation,
    r = window.__enchantingAcceptance;
  const assert = (ok, m) => {
    if (!ok) throw Error(m);
  };
  try {
    const { experienceStatus } = await import("/src/game/experience.ts"),
      storage = await import("/src/game/storage.ts");
    assert(r.prepared && sim.manifest.id === r.worldId, "Wrong fixture");
    assert(
      sim.craftSlots[0]?.enchantments?.efficiency === 4,
      "UI did not apply hinted enchantment",
    );
    assert(
      sim.craftSlots[1]?.count === 3 &&
        experienceStatus(sim.progression.points).level === 27,
      "UI costs incorrect",
    );
    assert(
      sim.progression.enchantmentSeed !== r.beforePurchase.seed,
      "Seed not advanced",
    );
    r.stages.push({
      name: "actual-offer-button",
      passed: true,
      enchantments: { ...sim.craftSlots[0].enchantments },
      points: sim.progression.points,
      lapis: sim.craftSlots[1].count,
    });
    sim.closeContainer();
    game.showOverlay("pause");
    await game.save();
    const data = storage.validateSave(sim.snapshot()),
      stored = await storage.loadWorld(sim.manifest.id);
    assert(
      JSON.stringify(data.progression) === JSON.stringify(stored.progression),
      "XP persistence differs",
    );
    r.checkpoints.push({
      name: "enchanted-equipment",
      passed: true,
      version: stored.manifest.version,
      points: stored.progression.points,
    });
    r.passed = true;
    r.finishedAt = new Date().toISOString();
    window.__enchantingSaved = data;
  } catch (error) {
    r.errors.push(String(error));
  }
  return r;
}
