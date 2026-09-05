/** DEV-only integration fixture. Run in the named, fresh generator-5 survival world.
 * Grants an iron pickaxe, two planks, one door and two torches; clears a declared
 * mining gallery and builds a sky platform. Natural diamond targets are untouched.
 * Teleports and accelerated 60 Hz simulation are explicit test scaffolding.
 */
export async function runBrowserHeight() {
  const game = window.__voxelGame;
  const report = (window.__heightAcceptance = {
    version: 1,
    passed: false,
    startedAt: new Date().toISOString(),
    stages: [],
    checkpoints: [],
    errors: [],
    advancedSeconds: 0,
    fixture: [
      "Fresh survival world; grants iron pickaxe, 2 planks, 1 door and 2 torches",
      "Cleared deep gallery, bedrock access, sky platform/pedestal and a remote roof",
      "Teleports and accelerated 60 Hz simulation; no diamond or ore grants",
    ],
    limitations: [
      "Not an unassisted survival playthrough or browser FPS benchmark",
    ],
  });
  const assert = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const canonical = (value) =>
    JSON.stringify(value, (_key, entry) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? Object.fromEntries(
            Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)),
          )
        : entry,
    );
  try {
    const sim = game?.simulation,
      world = game?.world;
    assert(
      sim?.manifest.name === "深地与云端 · 高度验收" &&
        sim.manifest.seed === "M2-height-20260905" &&
        sim.manifest.generatorVersion === 5 &&
        sim.manifest.mode === "survival",
      "Wrong fixture world",
    );
    assert(
      world.getChanges().length === 0 && sim.player.inventory.every((s) => !s),
      "Fixture must start empty",
    );
    game.showOverlay("pause");
    const initialPlayedSeconds = sim.manifest.playedSeconds;
    report.initialPlayedSeconds = initialPlayedSeconds;
    const { sampleBlock } = await import("/src/engine/generator.ts");
    const storage = await import("/src/game/storage.ts");
    const started = performance.now();
    const stage = (name, values = {}) =>
      report.stages.push({ name, passed: true, ...values });
    const count = (id) =>
      sim.player.inventory.reduce(
        (n, s) => n + (s?.id === id ? s.count : 0),
        0,
      );
    const set = (x, y, z, id) =>
      assert(sim.setBlock(x, y, z, id), `Edit rejected: ${x},${y},${z}`);
    const look = (p) => {
      const e = sim.eye(),
        dx = p.x - e.x,
        dy = p.y - e.y,
        dz = p.z - e.z;
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
    const readyBox = async (min, max) => {
      const points = [];
      for (let cx = Math.floor(min.x / 16); cx <= Math.floor(max.x / 16); cx++)
        for (
          let cy = Math.floor(min.y / 16);
          cy <= Math.floor(max.y / 16);
          cy++
        )
          for (
            let cz = Math.floor(min.z / 16);
            cz <= Math.floor(max.z / 16);
            cz++
          )
            points.push({ x: cx * 16, y: cy * 16, z: cz * 16 });
      const start = performance.now();
      while (!points.every((p) => world.isReady(p.x, p.z, p.y))) {
        assert(
          performance.now() - start < 60000,
          "Fixture region loading timed out",
        );
        await new Promise(requestAnimationFrame);
      }
    };
    const teleport = async (p) => {
      sim.player.position = { ...p };
      sim.player.velocity = { x: 0, y: 0, z: 0 };
      world.update(p, game.settings.renderDistance);
      const start = performance.now();
      while (
        ![-1, 0, 1].every((dx) =>
          [-1, 0, 1].every((dz) =>
            [-1, 0, 1, 2, 3].every((dy) =>
              world.isReady(p.x + dx, p.z + dz, p.y + dy),
            ),
          ),
        )
      ) {
        assert(
          performance.now() - start < 60000,
          "Vertical chunk loading timed out",
        );
        await new Promise(requestAnimationFrame);
      }
      assert(
        world.stats.chunks <= 2197 && world.stats.pending <= 2198,
        "Unbounded section window",
      );
    };
    const checkpoint = async (name) => {
      const before = storage.validateSave(sim.snapshot());
      await storage.saveWorld(before);
      const after = await storage.loadWorld(before.manifest.id);
      assert(
        canonical(before) === canonical(after),
        `Checkpoint differs: ${name}`,
      );
      report.checkpoints.push({
        name,
        same: true,
        version: after.manifest.version,
        generator: after.manifest.generatorVersion,
        changes: after.changes.length,
      });
    };
    stage("new-world", {
      id: sim.manifest.id,
      version: sim.manifest.version,
      generator: 5,
      spawn: { ...sim.player.spawn },
      stats: { ...world.stats },
    });
    sim.player.inventory[0] = { id: "iron_pickaxe", count: 1, durability: 250 };
    sim.player.inventory[1] = { id: "planks", count: 2 };
    sim.player.inventory[2] = { id: "door", count: 1 };
    sim.player.inventory[3] = { id: "torch", count: 2 };
    sim.player.hunger = 10;
    const diamonds = [-10, -11, -12].map((x) => ({ x, y: -33, z: 2 }));
    for (const p of diamonds)
      assert(
        sampleBlock(sim.manifest.seed, p.x, p.y, p.z, 5) === 98,
        "Natural diamond changed",
      );
    await teleport({ x: -8.5, y: -34, z: 2.5 });
    for (let x = -14; x <= -7; x++)
      for (let y = -35; y <= -30; y++)
        for (let z = 0; z <= 4; z++) {
          if (world.getBlock(x, y, z) === 98) continue;
          set(x, y, z, y === -35 ? 90 : 0);
        }
    set(-8, -34, 1, 16);
    set(-13, -34, 3, 16);
    const mining = [];
    for (const p of diamonds) {
      await teleport({ x: -8.5, y: -34, z: 2.5 });
      sim.player.selected = 0;
      look({ x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });
      assert(
        canonical(sim.target()?.position) === canonical(p),
        "Deep diamond target obstructed",
      );
      let frames = 0;
      while (world.getBlock(p.x, p.y, p.z) === 98) {
        assert(++frames < 180, "Deep mining took too long");
        sim.mine(1 / 60);
        tick();
        if (frames % 30 === 0) await new Promise(requestAnimationFrame);
      }
      mining.push({ ...p, seconds: frames / 60 });
      await teleport({ x: p.x + 0.5, y: -34, z: 2.5 });
      await advance(1);
    }
    assert(
      count("diamond") === 3 && sim.player.inventory[0].durability === 247,
      "Deep mining conservation failed",
    );
    stage("natural-deep-mining", {
      mining,
      diamonds: 3,
      durability: 247,
      health: sim.player.health,
    });
    await checkpoint("deep-diamonds");
    await teleport({ x: 8.5, y: -63, z: 8.5 });
    assert(
      world.getBlock(8, -64, 8) === 24 && world.getBlock(8, -65, 8) === 0,
      "Bedrock/void boundary mismatch",
    );
    set(8, -63, 8, 0);
    set(8, -62, 8, 0);
    await advance(0.2);
    assert(!sim.player.dead, "Legacy void threshold still kills player");
    const before = world.getChanges().length;
    assert(
      !sim.setBlock(8, -65, 8, 11) && world.getChanges().length === before,
      "Out-of-range edit mutated world",
    );
    stage("bottom-boundary", {
      position: { ...sim.player.position },
      bedrock: 24,
      belowWorld: 0,
      alive: true,
    });
    await teleport({ x: 0.5, y: 318, z: 3.5 });
    await readyBox({ x: -2, y: 317, z: -2 }, { x: 3, y: 319, z: 4 });
    for (let x = -2; x <= 3; x++)
      for (let z = -2; z <= 4; z++) set(x, 317, z, 3);
    set(0, 318, 0, 3);
    sim.player.selected = 1;
    look({ x: 0.5, y: 319, z: 0.5 });
    assert(sim.target()?.normal.y === 1, "Upper placement needs top face");
    sim.interact();
    assert(
      world.getBlock(0, 319, 0) === 11 && count("planks") === 1,
      "Cannot place at 319",
    );
    await teleport({ x: 0.5, y: 320.6, z: 2.5 });
    look({ x: 0.5, y: 320, z: 0.5 });
    assert(
      sim.target()?.position.y === 319 && sim.target()?.normal.y === 1,
      "Ceiling target missing",
    );
    sim.interact();
    assert(
      world.getBlock(0, 320, 0) === 0 && count("planks") === 1,
      "Ceiling placement consumed item",
    );
    await teleport({ x: 2.5, y: 318, z: 3.5 });
    sim.player.selected = 2;
    look({ x: 2.5, y: 318, z: 0.5 });
    sim.interact();
    assert(
      world.getBlock(2, 318, 0) === 18 && world.getBlock(2, 319, 0) === 25,
      "Top-height door missing",
    );
    stage("upper-placement", {
      highestBlock: 319,
      rejected: 320,
      remainingPlanks: 1,
      door: [318, 319],
    });
    await readyBox({ x: 10, y: 300, z: 10 }, { x: 10, y: 300, z: 10 });
    set(10, 300, 10, 3);
    await checkpoint("deep-and-high-edits");
    await teleport({ ...sim.player.spawn });
    assert(
      !world.isReady(10, 10, 300),
      "Roof should be outside resident window",
    );
    assert(!world.hasSkyAccess(10, 128, 10), "Unloaded roof lost its shadow");
    world.setBlock(10, 300, 10, 0);
    assert(world.hasSkyAccess(10, 128, 10), "Removed roof left stale shadow");
    stage("remote-roof-and-return", {
      roofResident: false,
      cacheInvalidated: true,
      stats: { ...world.stats },
    });
    await teleport({ x: 2.5, y: 318, z: 3.5 });
    assert(
      world.getBlock(0, 319, 0) === 11 && world.getBlock(2, 319, 0) === 25,
      "Vertical return lost edits",
    );
    sim.player.selected = 0;
    look({ x: 0.5, y: 319, z: 0.5 });
    game.showOverlay("pause");
    await game.save();
    await checkpoint("vertical-return");
    assert(
      Math.abs(
        sim.manifest.playedSeconds -
          initialPlayedSeconds -
          report.advancedSeconds,
      ) < 1e-6,
      "Main loop advanced during controlled simulation",
    );
    report.worldId = sim.manifest.id;
    report.wallSeconds = (performance.now() - started) / 1000;
    report.passed = true;
  } catch (error) {
    report.errors.push(String(error));
  }
  game?.showOverlay("pause");
  report.finishedAt = new Date().toISOString();
  return report;
}
