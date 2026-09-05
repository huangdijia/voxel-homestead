/** DEV-only fixture. Requires the named fresh survival world and the UI-granted rifle.
 * Teleports, controlled 60 Hz input, a target zombie and a temporary wall are explicit
 * scaffolding; screenshots and mouse/keyboard input are exercised by the browser driver.
 */
export async function runBrowserCoast() {
  const game = window.__voxelGame;
  const sim = game?.simulation;
  const report = {
    passed: false,
    stages: [],
    errors: [],
    fixture:
      "Teleports, accelerated movement, one zombie, temporary wall; fresh survival world",
  };
  const assert = (value, message) => {
    if (!value) throw Error(message);
  };
  try {
    assert(
      sim?.manifest.name === "海岸与步枪 · 浏览器验收" &&
        sim.manifest.seed === "coast-20260905" &&
        sim.manifest.generatorVersion === 7 &&
        sim.manifest.mode === "survival",
      "Wrong fixture world",
    );
    assert(
      game.world.getChanges().length === 0 && sim.held?.id === "rifle",
      "Start from an unedited world after pressing G",
    );
    game.showOverlay("pause");
    const stage = (name, evidence) => report.stages.push({ name, evidence });
    const idle = {
      forward: 0,
      right: 0,
      jump: false,
      sprint: false,
      sneak: false,
    };
    const teleport = async (position) => {
      sim.player.position = { ...position };
      sim.player.velocity = { x: 0, y: 0, z: 0 };
      sim.player.yaw = 0;
      sim.player.pitch = 0;
      game.world.update(position, game.settings.renderDistance);
      const started = performance.now();
      while (
        ![-1, 0, 1].every((dx) =>
          [-1, 0, 1].every((dz) =>
            [0, 1, 2].every((dy) =>
              game.world.isReady(
                position.x + dx,
                position.z + dz,
                position.y + dy,
              ),
            ),
          ),
        )
      ) {
        assert(performance.now() - started < 60000, "Chunk loading timeout");
        await new Promise(requestAnimationFrame);
      }
    };
    const advance = async (input, count, done = () => false) => {
      for (let frame = 0; frame < count && !done(); frame++) {
        sim.step(1 / 60, { ...idle, ...input });
        if (frame % 30 === 0) await new Promise(requestAnimationFrame);
      }
    };
    await teleport({ x: 32.5, y: 69, z: -6.5 });
    await advance({ forward: 1 }, 150);
    assert(
      sim.player.position.z < -12 && sim.player.position.y >= 68.9,
      "Villa entry obstructed",
    );
    stage("enter-villa", { ...sim.player.position });
    await teleport({ x: 21.5, y: 69, z: -13.5 });
    const upstairs = () =>
      sim.player.position.y >= 75 && sim.player.position.z < -21;
    await advance({ forward: 1, jump: true }, 600, upstairs);
    assert(upstairs(), "Cannot climb villa stairs");
    stage("stairs", { ...sim.player.position });
    await teleport({ x: 52.5, y: 66, z: -17.5 });
    const outside = () =>
      sim.player.position.y >= 69 && sim.player.position.z > -13;
    await advance({ forward: -1, jump: true }, 600, outside);
    assert(outside(), "Cannot exit pool");
    stage("pool-exit", { ...sim.player.position });
    await teleport({ x: 6.5, y: 69, z: -12.5 });
    const target = {
      id: "coast-target",
      kind: "zombie",
      position: { x: 6.5, y: 69, z: -32.5 },
      health: 20,
      yaw: 0,
      timer: 0,
    };
    sim.entities = [target];
    assert(sim.attack() && target.health === 12, "Distant rifle hit failed");
    await advance({}, 8);
    game.world.setBlock(6, 70, -22, 17);
    const before = target.health;
    assert(sim.attack() && target.health === before, "Rifle penetrated glass");
    assert(
      !sim.mine(10) && game.world.getBlock(6, 70, -22) === 17,
      "Rifle mined the wall",
    );
    game.world.setBlock(6, 70, -22, 0);
    for (let shot = 0; shot < 2; shot++) {
      await advance({}, 8);
      sim.attack();
    }
    assert(
      !sim.entities.some((e) => e.id === target.id),
      "Target survived three hits",
    );
    assert(sim.progression.orbs.length > 0, "Kill lost its experience");
    stage("range-occlusion-kill", {
      distance: 20,
      damage: 8,
      glassStoppedShot: true,
      terrainIntact: true,
    });
    sim.player.pitch = 1.2;
    for (let shot = 0; shot < 100; shot++) {
      await advance({}, 8);
      assert(sim.attack(), "Continuous shot failed");
    }
    assert(
      sim.held?.count === 1 && sim.held.durability === undefined,
      "Infinite weapon consumed resources",
    );
    stage("infinite-ammo", {
      consecutiveShots: 100,
      rifle: structuredClone(sim.held),
    });
    const storage = await import("/src/game/storage.ts");
    const beforeSave = storage.validateSave(sim.snapshot());
    await storage.saveWorld(beforeSave);
    const loaded = await storage.loadWorld(sim.manifest.id);
    assert(
      JSON.stringify(loaded) === JSON.stringify(beforeSave),
      "Checkpoint round trip differs",
    );
    stage("save-reload", {
      identical: true,
      generator: loaded.manifest.generatorVersion,
    });
    await teleport({ x: 8.5, y: 69, z: 3.5 });
    sim.player.yaw = -1.02;
    sim.player.pitch = 0.06;
    await game.save();
    report.worldId = sim.manifest.id;
    report.passed = true;
  } catch (error) {
    report.errors.push(String(error));
  }
  game?.showOverlay("pause");
  window.__coastAcceptance = report;
  return report;
}
