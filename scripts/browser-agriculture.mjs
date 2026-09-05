/**
 * DEV-only real-browser agricultural integration harness. Does not open a browser.
 *
 * CDP: Runtime.evaluate({ expression: browserAgricultureExpression(),
 *   awaitPromise: true, returnByValue: true })
 * Vite page: const { runBrowserAgriculture } = await import('/scripts/browser-agriculture.mjs');
 *   await runBrowserAgriculture();
 *
 * Requires the fresh SURVIVAL world named “麦风农场 · 功能验收”, seed
 * “M2-farming-20260905”. The documented DEV hook is window.__voxelGame,
 * installed by Game.ts only in Vite development builds. Explicit equipment,
 * seeds, leaves, animals, platform and position fixtures are recorded below.
 * This tests actual Game commands / Simulation / VoxelWorld / IndexedDB;
 * it is not a manual, unassisted survival playthrough or a performance test.
 * Business checkpoints precede the separately labelled screenshot fixtures.
 */
export async function runBrowserAgriculture(options = {}) {
  const expectedName = options.expectedName ?? '麦风农场 · 功能验收';
  const expectedSeed = options.expectedSeed ?? 'M2-farming-20260905';
  const renderDistance = Math.max(2, Math.min(6, options.renderDistance ?? 2));
  const maxWallMs = Math.max(10_000, Math.min(120_000, options.maxWallMs ?? 75_000));
  const start = performance.now();
  const report = {
    version: 1, passed: false,
    verification: 'Vite DEV Game + Simulation + VoxelWorld + IndexedDB integration; explicitly granted inputs and staged positions; accelerated simulation.',
    startedAt: new Date().toISOString(), stages: [], results: {}, fixtureGrants: [], finalSaveIds: [], checkpoints: [], errors: [],
    simulation: { fixedStepSeconds: 0.05, advancedSeconds: 0 },
    limitations: [
      'Equipment, five wheat seeds, fertilizer, two pig feed carrots, leaves and four adults are explicit developer inputs; their natural acquisition is not tested here.',
      'Player positioning, elevated grass platform, water source and animal pens are developer fixtures. Commands are invoked programmatically, not via DOM keyboard/mouse events.',
      'Natural growth advances fixed Simulation steps faster than wall time. Rendering performance and full Java 1.21.1 parity are not claimed.',
      'The final four-crop display and inventory additions are screenshot fixtures created only after business assertions pass.',
      'Checkpoint equality uses the real browser IndexedDB save/load path; the browser page is not reloaded by this script.',
    ],
  };
  window.__farmingAcceptance = report;
  let game, sim, world, physics, mutated = false, activeStage = 'preflight';
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const deadline = () => assert(performance.now() - start < maxWallMs, `Agriculture acceptance exceeded ${maxWallMs} ms.`);
  const bounded = (promise, label, timeout = 20_000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeout} ms.`)), timeout);
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
  const yieldFrame = () => bounded(new Promise(resolve => requestAnimationFrame(resolve)), 'Animation frame', 8_000);
  const pause = () => { window.dispatchEvent(new Event('blur')); game.setPaused(true); };
  const canonical = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
  const count = id => sim.player.inventory.reduce((sum, stack) => sum + (stack?.id === id ? stack.count : 0), 0);
  const total = id => count(id) + sim.drops.reduce((sum, drop) => sum + (drop.stack.id === id ? drop.stack.count : 0), 0);
  const inventory = () => sim.player.inventory.filter(Boolean).map(stack => ({ ...stack }));
  const stage = (id, details = {}) => {
    activeStage = id; deadline();
    report.stages.push({ id, passed: true, worldTime: sim.time, inventory: inventory(), ...details });
    report.results[id] = true;
  };
  let stepCount = 0;
  const advance = async seconds => {
    const steps = Math.ceil(seconds / 0.05 - 1e-8);
    for (let i = 0; i < steps; i++) {
      sim.step(0.05, { forward: 0, right: 0, jump: false, sneak: false, sprint: false });
      report.simulation.advancedSeconds += 0.05;
      assert(!sim.player.dead, 'The fixture player died unexpectedly.');
      if (++stepCount % 40 === 0) { deadline(); await yieldFrame(); }
    }
  };
  const ready = async (settled = false) => {
    const waiting = performance.now();
    do {
      deadline();
      assert(performance.now() - waiting < 22_000, 'World workers did not settle within 22 seconds.');
      world.update(sim.player.position, renderDistance);
      await yieldFrame();
    } while (!world.isReady(sim.player.position.x, sim.player.position.z) || (settled && world.stats.pending > 0));
  };
  const stand = async (x, y, z) => {
    sim.player.position = { x, y, z }; sim.player.velocity = { x: 0, y: 0, z: 0 }; sim.player.flying = false;
    await ready();
    assert(!physics.intersectsWorld(world, sim.player.position), `Fixture standing position intersects blocks: ${canonical(sim.player.position)}.`);
  };
  const aim = point => {
    const eye = sim.eye(), dx = point.x - eye.x, dy = point.y - eye.y, dz = point.z - eye.z;
    sim.player.yaw = Math.atan2(-dx, -dz); sim.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  const expectTarget = (position, id, normal) => {
    const target = sim.target();
    assert(target && ['x', 'y', 'z'].every(axis => target.position[axis] === position[axis]) && target.id === id && (!normal || ['x', 'y', 'z'].every(axis => target.normal[axis] === normal[axis])), `Expected target ${canonical({ position, id, normal })}; actual ${canonical(target)}.`);
    return { position: { ...target.position }, id: target.id, normal: { ...target.normal }, distance: target.distance };
  };
  const select = id => {
    assert(!sim.cursor, 'Unexpected cursor stack before selecting an item.');
    let index = sim.player.inventory.findIndex(stack => stack?.id === id);
    assert(index >= 0, `Missing ${id}.`);
    if (index > 8) {
      game.clickSlot('inventory', index); game.clickSlot('inventory', 0);
      if (sim.cursor) game.clickSlot('inventory', index);
      index = 0;
    }
    game.command({ type: 'select', index });
  };
  const interact = () => { game.command({ type: 'interact' }); pause(); };

  try {
    game = window.__voxelGame;
    assert(game?.simulation && game?.world && typeof game.command === 'function' && typeof game.save === 'function', 'Requires the documented Vite DEV window.__voxelGame hook. Open a DEV game first.');
    sim = game.simulation; world = game.world;
    report.world = { id: sim.manifest.id, name: sim.manifest.name, seed: sim.manifest.seed, mode: sim.manifest.mode };
    const initial = sim.snapshot();
    assert(sim.manifest.mode === 'survival' && sim.manifest.name === expectedName && sim.manifest.seed === expectedSeed, `Refusing to modify this world. Create fresh survival world “${expectedName}” with seed “${expectedSeed}”.`);
    assert(initial.player.inventory.every(stack => stack === null) && Object.values(initial.player.armor).every(stack => stack === null) && !sim.cursor && sim.craftSlots.every(stack => !stack), 'Refusing to modify a world with existing inventory or equipment.');
    assert(initial.changes.length === 0 && initial.drops.length === 0 && Object.keys(initial.containers).length === 0 && (initial.farming?.plots.length ?? 0) === 0 && Object.keys(initial.composters ?? {}).length === 0, 'Refusing to modify a previously edited or populated world.');
    assert(!sim.player.dead, 'Fresh-world player must be alive.');
    stage('fresh_empty_world', { emptyInventory: true, blockChanges: 0, initialEntityCount: initial.entities.length });

    pause(); mutated = true;
    const [storage, { addItem }, { ITEMS }, physicsModule] = await bounded(Promise.all([
      import('/src/game/storage.ts'), import('/src/game/inventory.ts'), import('/src/game/registry.ts'), import('/src/engine/physics.ts'),
    ]), 'Load documented game modules');
    physics = physicsModule;
    game.updateSettings({ renderDistance, volume: 0, sensitivity: 1, fov: 75, quality: 'medium' });
    await ready(true);
    sim.time = 1000;
    const x = Math.floor(sim.player.position.x), z = Math.floor(sim.player.position.z);
    let highest = Math.floor(sim.player.position.y);
    for (let dx = -10; dx <= 15; dx++) for (let dz = -16; dz <= 10; dz++) highest = Math.max(highest, world.getSurface(x + dx, z + dz));
    const floor = Math.min(76, highest + 3), feet = floor + 1;
    report.fixturePlatform = { xMin: x - 10, xMax: x + 15, zMin: z - 16, zMax: z + 10, floorY: floor, grassBlocks: 26 * 27, purpose: 'Isolated sky-lit flat terrain for repeatable rule and camera checks.' };
    for (let dx = -10; dx <= 15; dx++) for (let dz = -16; dz <= 10; dz++) {
      sim.setBlock(x + dx, floor, z + dz, 1);
      for (let dy = 1; dy <= 5; dy++) if (world.getBlock(x + dx, floor + dy, z + dz)) sim.setBlock(x + dx, floor + dy, z + dz, 0);
    }
    await stand(x + 0.5, feet, z + 7.5);
    sim.player.spawn = { ...sim.player.position };
    report.fixturePositions = [{ phase: 'business', reason: 'All test interactions use explicit nearby standing positions on the declared platform.' }];
    const grant = (id, amount, phase, reason) => {
      assert(ITEMS[id], `Unknown fixture item ${id}.`);
      const stack = { id, count: amount, ...(ITEMS[id].maxDurability ? { durability: ITEMS[id].maxDurability } : {}) };
      assert(!addItem(sim.player.inventory, stack), `Fixture inventory has no room for ${id}.`);
      report.fixtureGrants.push({ phase, kind: 'inventory', ...stack, reason });
    };
    for (const [id, amount] of [['wood_hoe', 1], ['bucket', 1], ['wheat_seeds', 5], ['bone_meal', 24], ['leaves', 64], ['composter', 1], ['workbench', 1], ['carrot', 2], ['shears', 1]]) grant(id, amount, 'business', 'Declared test input; not naturally earned by this harness.');

    const state = save => ({ player: save.player, changes: save.changes, containers: save.containers, entities: save.entities, drops: save.drops, farming: save.farming, composters: save.composters, time: save.time, playedSeconds: save.manifest.playedSeconds });
    const checkpoint = async label => {
      pause();
      const expected = storage.validateSave(sim.snapshot());
      await bounded(game.save(), `Save ${label}`);
      const loaded = await bounded(storage.loadWorld(sim.manifest.id), `Load ${label}`);
      assert(loaded && canonical(state(expected)) === canonical(state(loaded)), `IndexedDB checkpoint mismatch: ${label}.`);
      report.checkpoints.push({ label, equal: true, saveId: loaded.manifest.id, savedAt: loaded.manifest.updatedAt, farmPlots: loaded.farming.plots.length, composters: loaded.composters, animals: loaded.entities.map(e => ({ id: e.id, kind: e.kind, age: e.age, love: e.love, breedCooldown: e.breedCooldown, sheared: e.sheared })) });
      if (!report.finalSaveIds.includes(loaded.manifest.id)) report.finalSaveIds.push(loaded.manifest.id);
      return loaded;
    };
    const onTop = async (p, item) => {
      select(item); await stand(p.x + 0.5, feet, p.z + 2.3);
      aim({ x: p.x + 0.5, y: p.y + 0.9, z: p.z + 0.5 });
      expectTarget(p, world.getBlock(p.x, p.y, p.z), { x: 0, y: 1, z: 0 });
    };
    const place = async (item, id, p) => {
      await onTop({ ...p, y: p.y - 1 }, item);
      const before = count(item); interact();
      assert(world.getBlock(p.x, p.y, p.z) === id && count(item) === before - 1, `Placing ${item} failed: ${sim.lastMessage}`);
    };

    activeStage = 'till_and_plant';
    const plots = [-2, -1, 0, 1, 2].map(dx => ({ x: x + dx, y: floor, z: z - 8 }));
    for (const p of plots) {
      await onTop(p, 'wood_hoe'); const before = sim.held.durability; interact();
      assert(world.getBlock(p.x, p.y, p.z) === 28 && sim.held.durability === before - 1, 'Hoe must consume exactly one durability and produce dry farmland.');
      await onTop(p, 'wheat_seeds'); const seeds = count('wheat_seeds'); interact();
      assert(world.getBlock(p.x, p.y + 1, p.z) === 30 && count('wheat_seeds') === seeds - 1, 'Planting must consume exactly one seed.');
    }
    stage('till_and_plant', { plots, seedsConsumed: 5, hoeUses: 5 });

    activeStage = 'bucket_irrigation';
    const source = { x: x - 6, y: feet, z: z - 9 }, channel = { x, y: floor, z: z - 6 };
    sim.setBlock(source.x, source.y, source.z, 6);
    sim.setBlock(channel.x, channel.y, channel.z, 0); sim.setBlock(channel.x, channel.y - 1, channel.z, 3);
    report.fixtureGrants.push({ phase: 'business', kind: 'block', id: 6, position: source, reason: 'Single water source fixture; the bucket must move it to the irrigation hole.' });
    select('bucket'); await stand(source.x + 0.5, feet, source.z + 2.3);
    aim({ x: source.x + 0.5, y: source.y + 0.4, z: source.z + 0.5 });
    const sourceTarget = physics.raycastVoxel(world, sim.eye(), sim.direction(), 4.5, true);
    assert(sourceTarget?.id === 6 && ['x', 'y', 'z'].every(axis => sourceTarget.position[axis] === source[axis]), `Water collection ray missed the source: ${canonical(sourceTarget)}.`);
    interact();
    assert(world.getBlock(source.x, source.y, source.z) === 0 && count('bucket') === 0 && count('water_bucket') === 1, 'Water source collection did not conserve the bucket.');
    // The near rim occludes the hole bottom from +2.3. At +1.35 the entire
    // player body remains on the rim while the downward ray reaches the bottom.
    select('water_bucket'); await stand(channel.x + 0.5, feet, channel.z + 1.35);
    aim({ x: channel.x + 0.5, y: channel.y - 0.01, z: channel.z + 0.5 });
    const channelTarget = expectTarget({ ...channel, y: channel.y - 1 }, 3, { x: 0, y: 1, z: 0 });
    interact();
    assert(world.getBlock(channel.x, channel.y, channel.z) === 6 && count('bucket') === 1 && count('water_bucket') === 0, 'Water placement did not move the source and return the bucket.');
    await advance(1);
    assert(plots.every(p => world.getBlock(p.x, p.y, p.z) === 29), 'The transported source did not hydrate all five plots.');
    stage('bucket_irrigation', { source, channel, sourceTarget, channelTarget, wetPlots: 5, totalBuckets: count('bucket') + count('water_bucket') });

    activeStage = 'natural_growth_and_fertilizer';
    const beforeGrowth = plots.map(p => world.getBlock(p.x, p.y + 1, p.z));
    await advance(61);
    const afterGrowth = plots.map(p => world.getBlock(p.x, p.y + 1, p.z));
    assert(afterGrowth.every((id, index) => id > beforeGrowth[index]), 'At least one watered, sky-lit wheat crop failed to grow naturally in 61 accelerated seconds.');
    const fertilizerBefore = count('bone_meal');
    for (const p of plots) {
      select('bone_meal'); await stand(p.x + 0.5, feet, p.z + 1.8);
      for (let tries = 0; world.getBlock(p.x, p.y + 1, p.z) !== 37 && tries < 5; tries++) {
        const block = world.getBlock(p.x, p.y + 1, p.z), height = 0.16 + (block - 30) / 7 * 0.73;
        aim({ x: p.x + 0.5, y: p.y + 1 + height * 0.5, z: p.z + 0.5 });
        expectTarget({ ...p, y: p.y + 1 }, block);
        const before = count('bone_meal'); interact();
        assert(count('bone_meal') === before - 1, 'Successful fertilizing did not consume exactly one bone meal.');
      }
      assert(world.getBlock(p.x, p.y + 1, p.z) === 37, 'Wheat did not reach maturity through fertilizer interactions.');
      const before = count('bone_meal'); interact();
      assert(count('bone_meal') === before, 'Mature wheat incorrectly consumed fertilizer.');
    }
    stage('natural_growth_and_fertilizer', { naturalSeconds: 61, beforeGrowth, afterGrowth, fertilizerConsumed: fertilizerBefore - count('bone_meal'), maturePlants: 5 });

    activeStage = 'harvest_bread_eat';
    for (const p of plots) {
      select('wood_hoe'); await stand(p.x + 0.5, feet, p.z + 1.5);
      aim({ x: p.x + 0.5, y: p.y + 1.4, z: p.z + 0.5 });
      expectTarget({ ...p, y: p.y + 1 }, 37);
      const before = count('wheat');
      let mined = false;
      for (let attempts = 0; attempts < 6 && !mined; attempts++) mined = sim.mine(0.05);
      assert(mined && world.getBlock(p.x, p.y + 1, p.z) === 0, 'Crop mining failed.');
      await advance(0.8);
      assert(count('wheat') === before + 1, 'Harvested wheat was not picked up or did not conserve yield.');
    }
    const workbench = { x: x - 7, y: feet, z: z - 4 }, composter = { x: x - 5, y: feet, z: z - 4 };
    await place('workbench', 13, workbench);
    select('leaves'); await stand(workbench.x + 0.5, feet, workbench.z + 2.3);
    aim({ x: workbench.x + 0.5, y: workbench.y + 0.5, z: workbench.z + 0.5 });
    expectTarget(workbench, 13); interact();
    assert(sim.station === 'workbench', 'Workbench interaction did not enable the bread recipe.');
    game.command({ type: 'craft', recipeId: 'bread' });
    assert(count('bread') === 1 && count('wheat') === 2, 'Bread recipe must consume three of the five harvested wheat.');
    sim.closeContainer(); select('bread');
    const hungerBeforeFixture = sim.player.hunger; sim.player.hunger = 10;
    report.fixtureGrants.push({ phase: 'business', kind: 'player-state', field: 'hunger', before: hungerBeforeFixture, after: 10, reason: 'Controlled hunger prerequisite for the eating assertion.' });
    aim({ x: sim.player.position.x, y: feet + 8, z: sim.player.position.z - 1 }); interact();
    await advance(1.7);
    assert(count('bread') === 0 && sim.player.hunger === 15, 'Eating earned bread failed to consume it and restore five hunger.');
    stage('harvest_bread_eat', { harvestedWheat: 5, breadCrafted: 1, breadEaten: 1, hunger: sim.player.hunger, wheatReservedForSheep: count('wheat') });

    activeStage = 'composter_checkpoint';
    await place('composter', 59, composter);
    select('leaves'); await stand(composter.x + 0.5, feet, composter.z + 2.2);
    aim({ x: composter.x + 0.5, y: composter.y + 0.5, z: composter.z + 0.5 });
    expectTarget(composter, 59);
    const leavesBefore = count('leaves');
    for (let tries = 0; world.getBlock(composter.x, composter.y, composter.z) < 66 && tries < 64; tries++) interact();
    assert(world.getBlock(composter.x, composter.y, composter.z) === 66, '64 declared leaves did not fill the composter.');
    await advance(0.5);
    const key = `${composter.x},${composter.y},${composter.z}`;
    assert(sim.composters[key] > 0 && sim.composters[key] < 1, 'Expected an in-progress compost maturation timer.');
    const middle = await checkpoint('composter_mid_maturation');
    assert(middle.composters[key] === sim.composters[key], 'The compost maturation timer did not survive IndexedDB.');
    await advance(0.55);
    assert(world.getBlock(composter.x, composter.y, composter.z) === 67, 'The saved composter did not finish maturation.');
    expectTarget(composter, 67);
    const boneBefore = total('bone_meal'); interact();
    assert(world.getBlock(composter.x, composter.y, composter.z) === 59 && total('bone_meal') === boneBefore + 1, 'Finished compost did not produce exactly one bone meal.');
    await stand(composter.x + 0.5, feet, composter.z + 1.5); await advance(0.8);
    assert(count('bone_meal') === boneBefore + 1, 'Compost bone meal was not collected.');
    stage('composter_checkpoint', { composter, leavesConsumed: leavesBefore - count('leaves'), savedRemainingSeconds: middle.composters[key], boneMealProduced: 1 });

    activeStage = 'animal_breeding';
    const pen = (left, right) => {
      for (let dx = left; dx <= right; dx++) for (let dz = 0; dz <= 5; dz++)
        if (dx === left || dx === right || dz === 0 || dz === 5) sim.setBlock(x + dx, feet, z + dz, 11);
    };
    pen(-8, -3); pen(-1, 4);
    report.fixturePens = [{ xMin: x - 8, xMax: x - 3, zMin: z, zMax: z + 5 }, { xMin: x - 1, xMax: x + 4, zMin: z, zMax: z + 5 }];
    // Keep naturally spawned animals in this fresh world, but move them away
    // from the four controlled feeding rays. This is explicitly a fixture.
    const movedAnimals = sim.entities.map((entity, index) => {
      const before = { ...entity.position };
      entity.position = { x: x + 13.3 + (index % 2) * 1.3, y: feet, z: z - 1.5 - Math.floor(index / 2) * 1.4 };
      return { id: entity.id, before, after: { ...entity.position } };
    });
    report.fixturePositions.push({ phase: 'business', reason: 'Keep naturally spawned animals away from controlled feeding rays without deleting them.', animals: movedAnimals });
    const parents = [
      { id: 'acceptance-sheep-a', kind: 'sheep', position: { x: x - 6.6, y: feet, z: z + 1.5 } },
      { id: 'acceptance-sheep-b', kind: 'sheep', position: { x: x - 5.3, y: feet, z: z + 1.5 } },
      { id: 'acceptance-pig-a', kind: 'pig', position: { x: x + 0.4, y: feet, z: z + 1.5 } },
      { id: 'acceptance-pig-b', kind: 'pig', position: { x: x + 1.7, y: feet, z: z + 1.5 } },
    ].map(e => ({ ...e, health: e.kind === 'sheep' ? 8 : 10, yaw: 0, timer: 100, age: 0, love: 0, breedCooldown: 0 }));
    sim.entities.push(...parents);
    report.fixtureGrants.push({ phase: 'business', kind: 'animals', entities: structuredClone(parents), reason: 'Four adult breeder fixtures; love, babies and cooldowns are obtained through actual feeding and simulation.' });
    const childrenBefore = new Set(sim.entities.map(e => e.id));
    for (const parent of parents) {
      select(parent.kind === 'sheep' ? 'wheat' : 'carrot');
      await stand(parent.position.x, feet, z + 3.8);
      aim({ ...parent.position, y: feet + 0.55 });
      const before = count(parent.kind === 'sheep' ? 'wheat' : 'carrot'); interact();
      assert(parent.love === 60 && count(parent.kind === 'sheep' ? 'wheat' : 'carrot') === before - 1, `Feeding ${parent.id} failed.`);
    }
    select('wood_hoe'); await advance(3.25);
    const babies = sim.entities.filter(e => !childrenBefore.has(e.id) && (e.age ?? 0) < 0);
    assert(babies.length === 2 && babies.some(e => e.kind === 'sheep') && babies.some(e => e.kind === 'pig'), 'Each fed adult pair must create exactly one baby.');
    assert(parents.every(e => e.breedCooldown > 299 && e.love === 0), 'Parents did not enter the breeding cooldown.');
    await checkpoint('two_babies_and_parent_cooldowns');
    stage('animal_breeding', { fedAdultIds: parents.map(e => e.id), babyIds: babies.map(e => e.id), breedingSeconds: 3.25, cooldowns: parents.map(e => e.breedCooldown) });

    activeStage = 'shearing';
    const sheep = parents[0]; select('shears');
    await stand(sheep.position.x, feet, sheep.position.z + 2.1);
    aim({ ...sheep.position, y: sheep.position.y + 0.55 });
    const woolBefore = total('wool'), durability = sim.held.durability; interact();
    assert(sheep.sheared && total('wool') > woolBefore && sim.held.durability === durability - 1, 'Shearing did not set sheep state, drop wool and consume durability.');
    const produced = total('wool') - woolBefore; interact();
    assert(total('wool') === woolBefore + produced && sim.held.durability === durability - 1, 'Repeated shearing duplicated wool or consumed durability.');
    await stand(sheep.position.x, feet, sheep.position.z + 0.9); await advance(0.8);
    assert(count('wool') === woolBefore + produced, 'Sheared wool was not collected.');
    await checkpoint('business_complete_sheared_sheep');
    stage('shearing', { adultId: sheep.id, woolProduced: produced, durabilityRemaining: sim.player.inventory.find(s => s?.id === 'shears')?.durability, repeatActionConserved: true });
    report.businessPassed = true;

    activeStage = 'visual_fixture';
    const cropRows = [
      { kind: 'wheat', first: 30, stages: 8, dz: -14 },
      { kind: 'carrot', first: 38, stages: 8, dz: -12 },
      { kind: 'potato', first: 46, stages: 8, dz: -10 },
      { kind: 'beetroot', first: 54, stages: 4, dz: -8 },
    ];
    for (const row of cropRows) for (let growth = 0; growth < row.stages; growth++) {
      sim.setBlock(x + 4 + growth, floor, z + row.dz, 29);
      sim.setBlock(x + 4 + growth, feet, z + row.dz, row.first + growth);
    }
    for (const dz of [-13, -9]) for (let dx = 4; dx <= 11; dx++) sim.setBlock(x + dx, floor, z + dz, 6);
    for (let dz = -15; dz <= -7; dz++) for (const dx of [3, 12]) sim.setBlock(x + dx, floor, z + dz, 11);
    for (let dx = 4; dx <= 11; dx++) for (const dz of [-15, -11, -7]) sim.setBlock(x + dx, floor, z + dz, 11);
    for (let dx = 12; dx <= 14; dx++) for (let dz = 2; dz <= 4; dz++) for (let dy = 1; dy <= 2; dy++) sim.setBlock(x + dx, floor + dy, z + dz, 11);
    const visualInventory = [['iron_hoe', 1], ['water_bucket', 1], ['wheat_seeds', 16], ['carrot', 8], ['potato', 8], ['beetroot_seeds', 16], ['bone_meal', 16], ['wheat', 8], ['bread', 3], ['baked_potato', 3], ['beetroot_soup', 1], ['beetroot', 8], ['bowl', 1], ['composter', 1]];
    for (const [id, amount] of visualInventory) grant(id, amount, 'visual_fixture', 'Final inventory presentation only; excluded from the business progression assertions.');
    report.visualFixture = { separateFromBusinessVerification: true, cropRows: cropRows.map(row => ({ ...row, xStart: x + 4, z: z + row.dz, floorY: floor })), manuallyPlacedCropBlocks: 28, retainedBabies: babies.map(e => e.id), shearedAdult: sheep.id, purpose: 'Show all actual crop stages, irrigation, adult/baby models, sheared fleece and the new inventory icons.' };
    sim.closeContainer(); select('iron_hoe');
    await stand(x + 13.5, floor + 3, z + 3.5);
    aim({ x: x + 2.5, y: feet + 0.8, z: z - 7.5 });
    report.visualFixture.observer = { ...sim.player.position, yaw: sim.player.yaw, pitch: sim.player.pitch, support: 'Two-block solid wooden observation platform; player is paused.' };
    await ready(true); await yieldFrame();
    await checkpoint('final_visual_fixture');
    game.command({ type: 'select', index: sim.player.selected });
    report.renderer = { pending: world.stats.pending, chunks: world.stats.chunks, drawCalls: game.renderer.info.render.calls, geometries: game.renderer.info.memory.geometries };
    assert(report.renderer.pending === 0 && report.renderer.drawCalls > 0, 'Actual rendered worker geometry did not finish.');
    stage('visual_fixture', { labelledFixture: true, saveId: sim.manifest.id });
    report.passed = true;
    report.nextUIActions = 'Use the normal Continue button for the real world view, E for inventory and Esc to pause. The final field/inventory is explicitly a visual fixture; business evidence is retained in earlier stages/checkpoints.';
  } catch (error) {
    report.errors.push({ stage: activeStage, message: error instanceof Error ? error.message : String(error) });
    if (sim) report.partialInventory = inventory();
    throw error;
  } finally {
    if (mutated && game) pause();
    report.simulation.advancedSeconds = Math.round(report.simulation.advancedSeconds * 100) / 100;
    report.wallMilliseconds = Math.round(performance.now() - start);
    window.__farmingAcceptance = report;
  }
  return report;
}

/** Self-contained expression; no external closure or hidden page API is needed. */
export function browserAgricultureExpression(options = {}) {
  return `(${runBrowserAgriculture.toString()})(${JSON.stringify(options)})`;
}
