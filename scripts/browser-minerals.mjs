/** DEV-only game integration fixture, run only in the named fresh survival world.
 * Grants iron tools, sticks, workbench, torches, water bucket and a safe access gallery.
 * Diamond ore and lava targets are sampled from generator 4 and never placed by this script.
 * Mining uses real 60 Hz progress; this is not a manual playthrough or FPS benchmark.
 */
export async function runBrowserMinerals() {
  const game = window.__voxelGame;
  const report = {
    version: 1,
    passed: false,
    startedAt: new Date().toISOString(),
    stages: [],
    checkpoints: [],
    errors: [],
    advancedSeconds: 0,
    fixtureGrants: [
      "Survival world, iron pickaxe, 2 sticks, 1 workbench, 6 torches, water bucket",
      "Player teleports and a cleared access gallery; no diamond, diamond equipment, lava or obsidian grants",
      "Accelerated 60 Hz mining/simulation; main render loop remains paused",
    ],
    limitations: [
      "Programmatic game integration, not an unassisted manual survival playthrough or FPS benchmark",
    ],
  };
  window.__mineralsAcceptance = report;
  const assert = (v, m) => {
    if (!v) throw Error(m);
  };
  const canonical = (v) =>
    JSON.stringify(v, (_k, o) =>
      o && typeof o === "object" && !Array.isArray(o)
        ? Object.fromEntries(
            Object.entries(o).sort(([a], [b]) => a.localeCompare(b)),
          )
        : o,
    );
  try {
    const sim = game?.simulation,
      world = game?.world;
    assert(
      sim?.manifest.name === "深岩与钻石 · 采矿验收" &&
        sim.manifest.seed === "M2-minerals-20260905",
      "Wrong world",
    );
    assert(
      sim.manifest.mode === "survival" &&
        sim.manifest.generatorVersion === 4 &&
        world.getChanges().length === 0,
      "Not a fresh generator-4 survival world",
    );
    game.setPaused(true);
    const { sampleBlock } = await import("/src/engine/generator.ts"),
      { ITEMS } = await import("/src/game/registry.ts"),
      storage = await import("/src/game/storage.ts");
    const count = (id) =>
      sim.player.inventory.reduce(
        (n, s) => n + (s?.id === id ? s.count : 0),
        0,
      );
    const stage = (name, details = {}) =>
      report.stages.push({ name, passed: true, ...details });
    const set = (x, y, z, id) =>
      assert(sim.setBlock(x, y, z, id), `Cannot edit ${x},${y},${z}`);
    const look = (point) => {
      const e = sim.eye(),
        dx = point.x - e.x,
        dy = point.y - e.y,
        dz = point.z - e.z;
      sim.player.yaw = Math.atan2(-dx, -dz);
      sim.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    };
    const idle = {
      forward: 0,
      right: 0,
      jump: false,
      sprint: false,
      sneak: false,
    };
    const tick = () => {
      sim.step(1 / 60, idle);
      report.advancedSeconds += 1 / 60;
    };
    const advance = async (seconds) => {
      for (let i = 0; i < Math.round(seconds * 60); i++) {
        tick();
        if (i % 30 === 0) await new Promise(requestAnimationFrame);
      }
    };
    const checkpoint = async (name) => {
      const before = storage.validateSave(sim.snapshot());
      await storage.saveWorld(before);
      const after = await storage.loadWorld(before.manifest.id);
      assert(
        canonical(before) === canonical(after),
        `Checkpoint ${name} differs`,
      );
      report.checkpoints.push({
        name,
        same: true,
        inventory: before.player.inventory,
        changes: before.changes.length,
      });
    };
    const mine = async (p) => {
      look({ x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });
      assert(
        sim.target()?.position.x === p.x &&
          sim.target()?.position.y === p.y &&
          sim.target()?.position.z === p.z,
        "Mining target obstructed",
      );
      let ticks = 0;
      while (world.getBlock(p.x, p.y, p.z) !== 0) {
        assert(ticks++ < 21000, "Mining timeout");
        sim.mine(1 / 60);
        tick();
        if (ticks % 30 === 0) await new Promise(requestAnimationFrame);
      }
      return ticks / 60;
    };
    const hold = (id) => {
      const i = sim.player.inventory.findIndex((s) => s?.id === id);
      assert(i >= 0, `Missing ${id}`);
      sim.player.selected = i;
    };
    const teleport = async (p) => {
      sim.player.position = { ...p };
      sim.player.velocity = { x: 0, y: 0, z: 0 };
      const t = performance.now();
      while (!world.isReady(p.x, p.z)) {
        assert(performance.now() - t < 20000, "Chunk load timeout");
        await new Promise(requestAnimationFrame);
      }
    };
    const diamonds = [];
    for (let x = -5; x <= -1; x++)
      for (let y = 6; y <= 9; y++)
        for (let z = 5; z <= 9; z++)
          if (sampleBlock(sim.manifest.seed, x, y, z, 4) === 88)
            diamonds.push({ x, y, z });
    assert(diamonds.length >= 3, "Natural nearby diamond cluster missing");
    const targets = [
      { x: -3, y: 9, z: 7 },
      { x: -3, y: 8, z: 7 },
      { x: -2, y: 8, z: 7 },
    ];
    report.naturalDiamonds = targets;
    await teleport({ x: -3.5, y: 10, z: 10.5 });
    for (let x = -7; x <= 1; x++)
      for (let y = 5; y <= 13; y++)
        for (let z = 3; z <= 12; z++) {
          const original = world.getBlock(x, y, z);
          if ([88, 98].includes(original)) continue;
          if (y === 5) set(x, y, z, 3);
          else if (original) set(x, y, z, 0);
        }
    sim.player.inventory[0] = { id: "iron_pickaxe", count: 1, durability: 250 };
    sim.player.inventory[1] = { id: "stick", count: 2 };
    sim.player.inventory[2] = { id: "workbench", count: 1 };
    sim.player.inventory[3] = { id: "water_bucket", count: 1 };
    sim.player.inventory[4] = { id: "torch", count: 6 };
    set(-6, 6, 7, 16);
    set(0, 6, 7, 16);
    sim.player.hunger = 10;
    stage("preflight", {
      mode: sim.manifest.mode,
      saveVersion: sim.manifest.version,
      generator: 4,
      naturalCluster: diamonds.length,
    });
    const mining = [];
    for (const p of targets) {
      assert(
        world.getBlock(p.x, p.y, p.z) === 88 &&
          sampleBlock(sim.manifest.seed, p.x, p.y, p.z, 4) === 88,
        "Diamond was not natural",
      );
      set(-4, 7, 7, 3);
      for (let y = 8; y <= 11; y++) set(-4, y, 7, 0);
      await teleport({ x: -3.5, y: 8, z: 7.5 });
      hold("iron_pickaxe");
      const seconds = await mine(p);
      mining.push({ ...p, seconds });
      // Return the drop to the safe gallery floor under the mined face for pickup.
      await teleport({ x: p.x + 0.5, y: p.y + 0.05, z: p.z + 0.5 });
      await advance(1);
    }
    assert(
      count("diamond") === 3,
      "Mined diamonds were not picked up exactly once",
    );
    stage("natural-diamond-mining", {
      mining,
      diamonds: count("diamond"),
      ironDurability: sim.player.inventory.find((s) => s?.id === "iron_pickaxe")
        ?.durability,
    });
    await checkpoint("three-natural-diamonds");
    await teleport({ x: -5.5, y: 6, z: 11.5 });
    hold("workbench");
    look({ x: -5.5, y: 5.5, z: 9.5 });
    sim.interact();
    assert(world.getBlock(-6, 6, 9) === 13, "Workbench was not placed");
    look({ x: -5.5, y: 6.5, z: 9.5 });
    sim.interact();
    assert(sim.station === "workbench", "Workbench did not open");
    sim.craft("diamond_pickaxe");
    assert(
      count("diamond") === 0 &&
        count("stick") === 0 &&
        count("diamond_pickaxe") === 1,
      "Diamond pick recipe conservation failed",
    );
    sim.closeContainer();
    game.showOverlay("pause");
    hold("diamond_pickaxe");
    assert(
      sim.held.durability === ITEMS.diamond_pickaxe.maxDurability,
      "New tool durability missing",
    );
    stage("craft-diamond-pickaxe");
    // Find a nearby natural source at the top of the deep lava band, then create a declared dry approach.
    let lava;
    outer: for (let radius = 10; radius <= 40; radius++)
      for (let x = -radius; x <= radius; x++)
        for (let z = -radius; z <= radius; z++) {
          if (Math.max(Math.abs(x), Math.abs(z)) !== radius) continue;
          if (sampleBlock(sim.manifest.seed, x, -5, z, 4) === 76) {
            lava = { x, y: -5, z };
            break outer;
          }
        }
    assert(lava, "Natural lava missing");
    report.naturalLava = lava;
    await teleport({ x: lava.x + 0.5, y: -4, z: lava.z + 3.5 });
    for (let x = lava.x - 2; x <= lava.x + 2; x++)
      for (let z = lava.z - 2; z <= lava.z + 4; z++)
        for (let y = -6; y <= 0; y++) {
          if (x === lava.x && y === -5 && z === lava.z) continue;
          const rim =
            x === lava.x - 2 ||
            x === lava.x + 2 ||
            z === lava.z - 2 ||
            z === lava.z + 4;
          if (y === -6 || (y === -5 && (rim || z > lava.z))) set(x, y, z, 90);
          else if (world.getBlock(x, y, z)) set(x, y, z, 0);
        }
    assert(
      world.getBlock(lava.x, -5, lava.z) === 76,
      "Original lava source lost",
    );
    await teleport({ x: lava.x + 0.5, y: -4, z: lava.z + 2.5 });
    hold("water_bucket");
    look({ x: lava.x + 0.5, y: -5.1, z: lava.z + 1.5 });
    sim.interact();
    assert(
      count("bucket") === 1 && count("water_bucket") === 0,
      "Water bucket was not emptied",
    );
    await advance(2);
    assert(
      world.getBlock(lava.x, -5, lava.z) === 81,
      "Water did not cast natural lava to obsidian",
    );
    stage("cast-natural-lava-to-obsidian");
    // Remove the poured water using the same empty bucket before mining.
    hold("bucket");
    look({ x: lava.x + 0.5, y: -3.6, z: lava.z + 1.5 });
    sim.interact();
    await advance(3);
    hold("diamond_pickaxe");
    const obsidianSeconds = await mine(lava);
    await teleport({ x: lava.x + 0.5, y: -5, z: lava.z + 0.5 });
    await advance(1);
    assert(
      count("obsidian") === 1 && sim.held.durability === 1560,
      "Obsidian drop or tool wear mismatch",
    );
    stage("harvest-obsidian", {
      seconds: obsidianSeconds,
      obsidian: count("obsidian"),
      diamondDurability: sim.held.durability,
    });
    await teleport({ x: -5.5, y: 6, z: 11.5 });
    hold("diamond_pickaxe");
    look({ x: -3, y: 7, z: 7 });
    await checkpoint("diamond-pick-and-obsidian");
    assert(
      Math.abs(sim.manifest.playedSeconds - report.advancedSeconds) < 1e-7,
      "Unexpected render-loop simulation during fixture",
    );
    report.passed = true;
    report.saveId = sim.manifest.id;
    report.viewport = {
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
    };
    game.publish();
  } catch (error) {
    report.errors.push(String(error));
  }
  report.finishedAt = new Date().toISOString();
  return report;
}
