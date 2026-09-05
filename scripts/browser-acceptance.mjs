/**
 * DEV-only browser acceptance harness. This file does not start a browser.
 *
 * Node/CDP usage:
 *   import { browserAcceptanceExpression } from './scripts/browser-acceptance.mjs';
 *   const result = await session.send('Runtime.evaluate', {
 *     expression: browserAcceptanceExpression({ fullIron: true }),
 *     awaitPromise: true, returnByValue: true,
 *   });
 *
 * In an already opened Vite DEV page, run:
 *   const { runBrowserAcceptance } = await import('/scripts/browser-acceptance.mjs');
 *   await runBrowserAcceptance();
 *
 * Requires a NEW, empty survival world in window.__voxelGame. Explicit fixtures
 * position the player, build a small test platform, and place raw resource
 * blocks nearby. Tools, armor, stations, charcoal, torches, the bed and door
 * must all be earned through actual mining / recipe / furnace / placement rules.
 * It advances Simulation.step at 20 Hz faster than wall time, so this is an
 * automated integration check, NOT a manual empty-inventory playthrough or FPS
 * benchmark. The shelter shell added at the end is a labelled screenshot fixture.
 */
export async function runBrowserAcceptance(options = {}) {
  const fullIron = options.fullIron !== false;
  const renderDistance = Math.max(2, Math.min(6, options.renderDistance ?? 2));
  const maxWallMs = Math.max(10_000, Math.min(120_000, options.maxWallMs ?? 55_000));
  const game = window.__voxelGame;
  if (!game?.simulation || !game?.world) throw new Error('Open a Vite DEV game first: window.__voxelGame is required.');
  const sim = game.simulation, world = game.world;
  const started = performance.now();
  const report = {
    version: 1, passed: false, verification: 'Automated real Game + VoxelWorld integration; explicitly placed developer fixtures; accelerated simulation, not manual playthrough.',
    world: { id: sim.manifest.id, name: sim.manifest.name, seed: sim.manifest.seed, mode: sim.manifest.mode },
    fixture: { rawResourceBlocks: {}, directInventoryGrants: 0, shellBlocks: 0 },
    simulation: { fixedStepSeconds: .05, advancedSeconds: 0, fullIron },
    stages: [], saves: [], settings: { renderDistance }, errors: [],
  };
  window.__voxelAcceptanceReport = report;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const pause = () => { window.dispatchEvent(new Event('blur')); game.setPaused(true); };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const deadline = () => assert(performance.now() - started < maxWallMs, `Acceptance exceeded ${maxWallMs} ms; partial report retained.`);
  const bagCount = id => sim.player.inventory.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);
  const summarize = save => {
    const totals = {};
    const add = slot => { if (slot) totals[slot.id] = (totals[slot.id] ?? 0) + slot.count; };
    save.player.inventory.forEach(add); Object.values(save.player.armor).forEach(add);
    Object.values(save.containers).forEach(c => c.slots.forEach(add)); save.drops.forEach(d => add(d.stack));
    return Object.fromEntries(Object.entries(totals).sort(([a], [b]) => a.localeCompare(b)));
  };
  const stage = (name, details = {}) => {
    const save = sim.snapshot();
    report.stages.push({ name, totals: summarize(save), inventory: save.player.inventory.filter(Boolean), armor: save.player.armor, time: sim.time, ...details });
  };
  const canonical = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
  let sequence = 0;
  const advance = async seconds => {
    const steps = Math.ceil(seconds / .05 - 1e-8);
    for (let i = 0; i < steps; i++) {
      sim.step(.05, { forward: 0, right: 0, jump: false, sneak: false, sprint: false });
      report.simulation.advancedSeconds += .05;
      assert(!sim.player.dead, 'Fixture player unexpectedly died.');
      if (++sequence % 100 === 0) { deadline(); await tick(); }
    }
  };
  const waitForWorld = async (settled = false) => {
    const waiting = performance.now();
    while (!world.isReady(sim.player.position.x, sim.player.position.z) || (settled && world.stats.pending > 0)) {
      deadline(); assert(performance.now() - waiting < 30_000, 'Worker did not make the fixture area ready within 30 seconds.');
      world.update(sim.player.position, renderDistance);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    // Let a real RAF publish/render the finished worker meshes.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  };
  const stand = (x, y, z) => {
    sim.player.position = { x, y, z }; sim.player.velocity = { x: 0, y: 0, z: 0 }; sim.player.flying = false;
    world.update(sim.player.position, renderDistance);
  };
  const aim = point => {
    const eye = sim.eye(), dx = point.x - eye.x, dy = point.y - eye.y, dz = point.z - eye.z;
    sim.player.yaw = Math.atan2(-dx, -dz); sim.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  };
  const select = id => {
    assert(!sim.cursor, 'Unexpected cursor item before selecting.');
    let index = sim.player.inventory.findIndex(s => s?.id === id);
    assert(index >= 0, `Missing earned item ${id}.`);
    if (index > 8) {
      game.clickSlot('inventory', index); game.clickSlot('inventory', 0);
      if (sim.cursor) game.clickSlot('inventory', index);
      index = 0;
    }
    game.command({ type: 'select', index });
  };

  try {
    assert(sim.manifest.mode === 'survival', 'Create a fresh SURVIVAL fixture world; do not run in an existing creative/performance world.');
    assert(sim.player.inventory.every(s => s === null) && Object.values(sim.player.armor).every(s => s === null) && !sim.cursor && sim.craftSlots.every(s => !s) && sim.drops.length === 0 && Object.keys(sim.containers).length === 0, 'Refusing to modify a non-empty world. Create a fresh survival fixture world first.');
    pause();
    game.updateSettings({ renderDistance, volume: 0, sensitivity: 1, fov: 75, quality: 'medium' });
    sim.time = 1000;
    const x = Math.floor(sim.player.position.x), z = Math.floor(sim.player.position.z);
    let highest = Math.floor(sim.player.position.y);
    for (let dx = -6; dx <= 6; dx++) for (let dz = -7; dz <= 4; dz++) highest = Math.max(highest, world.getSurface(x + dx, z + dz));
    const floor = Math.min(80, highest + 4), feet = floor + 1;
    const origin = { x: x + .5, y: feet, z: z + .5 };
    report.fixture.platform = { xMin: x - 6, xMax: x + 6, zMin: z - 7, zMax: z + 4, floorY: floor };
    report.fixture.playerPositionIsDeveloperFixture = true;
    for (let dx = -6; dx <= 6; dx++) for (let dz = -7; dz <= 4; dz++) {
      world.setBlock(x + dx, floor, z + dz, 1);
      for (let dy = 1; dy <= 6; dy++) if (world.getBlock(x + dx, floor + dy, z + dz)) world.setBlock(x + dx, floor + dy, z + dz, 0);
    }
    stand(origin.x, origin.y, origin.z); sim.player.spawn = { ...origin };
    await waitForWorld();
    stage('empty_inventory', { inventoryEmpty: true });

    const rawSpot = { x, y: feet, z: z - 1 };
    const mineResources = async (blockId, itemId, count) => {
      stand(origin.x, origin.y, origin.z); await waitForWorld();
      const before = bagCount(itemId);
      report.fixture.rawResourceBlocks[itemId] = (report.fixture.rawResourceBlocks[itemId] ?? 0) + count;
      for (let n = 0; n < count; n++) {
        world.setBlock(rawSpot.x, rawSpot.y, rawSpot.z, blockId);
        aim({ x: rawSpot.x + .5, y: rawSpot.y + .5, z: rawSpot.z + .5 });
        assert(sim.target()?.id === blockId, `Raycast does not select fixture resource ${itemId}.`);
        let broken = false;
        for (let step = 0; step < 300 && !broken; step++) { broken = sim.mine(.05); await advance(.05); }
        assert(broken && world.getBlock(rawSpot.x, rawSpot.y, rawSpot.z) === 0, `Failed to mine ${itemId}.`);
        await advance(.75);
        assert(bagCount(itemId) === before + n + 1, `Drop pickup mismatch for ${itemId}: expected ${before + n + 1}, got ${bagCount(itemId)}.`);
      }
    };
    const craft = (recipeId, itemId = recipeId, count = 1) => {
      const before = bagCount(itemId); game.command({ type: 'craft', recipeId });
      assert(bagCount(itemId) === before + count, `Craft ${recipeId} failed: ${sim.lastMessage}`);
    };
    const place = async (itemId, blockId, p) => {
      sim.closeContainer(); select(itemId); stand(p.x + .5, feet, p.z + 2.5); await waitForWorld();
      aim({ x: p.x + .5, y: floor + .999, z: p.z + .5 });
      const before = bagCount(itemId); game.command({ type: 'interact' }); pause();
      assert(world.getBlock(p.x, p.y, p.z) === blockId && bagCount(itemId) === before - 1, `Failed to place earned ${itemId}: ${sim.lastMessage}`);
    };
    const open = async (p, expectedKind) => {
      stand(p.x + .5, feet, p.z + 2.5); await waitForWorld(); aim({ x: p.x + .5, y: p.y + .5, z: p.z + .5 });
      game.command({ type: 'interact' }); pause();
      if (expectedKind === 'workbench') assert(sim.station === 'workbench', 'Workbench interaction did not enable 3x3 recipes.');
      else assert(game.getContainer()?.kind === expectedKind, `Failed to open ${expectedKind}.`);
    };
    const transferToContainer = (id, count, index) => {
      const before = bagCount(id), source = sim.player.inventory.findIndex(s => s?.id === id && s.count >= count);
      assert(source >= 0 && !sim.cursor, `Cannot transfer ${count} ${id}.`);
      game.clickSlot('inventory', source);
      for (let i = 0; i < count; i++) game.clickSlot('container', index, true);
      if (sim.cursor) game.clickSlot('inventory', source);
      assert(!sim.cursor && bagCount(id) === before - count, `Container transfer lost or duplicated ${id}.`);
    };
    const takeFurnaceOutput = (id, count) => {
      const container = game.getContainer();
      assert(container?.kind === 'furnace' && container.slots[2]?.id === id && container.slots[2].count === count, `Expected furnace output ${count} ${id}, got ${JSON.stringify(container?.slots?.[2])}.`);
      const before = bagCount(id); game.clickSlot('container', 2, false, true);
      assert(container.slots[2] === null && bagCount(id) === before + count, 'Furnace output transfer did not conserve items.');
    };
    const storage = await import('/src/game/storage.ts');
    const verifySave = async label => {
      pause();
      const expected = storage.validateSave(sim.snapshot());
      await game.save();
      const loaded = await storage.loadWorld(sim.manifest.id);
      assert(loaded, `Missing IndexedDB checkpoint: ${label}.`);
      const state = data => ({ player: data.player, changes: data.changes, containers: data.containers, entities: data.entities, drops: data.drops, time: data.time, playedSeconds: data.manifest.playedSeconds });
      assert(canonical(state(expected)) === canonical(state(loaded)), `IndexedDB state mismatch: ${label}.`);
      report.saves.push({ label, identical: true, totals: summarize(loaded), changes: loaded.changes.length, containers: Object.keys(loaded.containers), savedAt: loaded.manifest.updatedAt });
    };
    const workbench = { x: x - 2, y: feet, z: z - 3 };
    const furnacePosition = { x, y: feet, z: z - 4 };
    const chest = { x: x + 2, y: feet, z: z - 3 };
    const bed = { x: x - 3, y: feet, z: z - 4 };
    const door = { x, y: feet, z: z + 2 };
    report.fixture.interactables = { workbench, furnace: furnacePosition, chest, bed, door };

    // Raw resource fixtures are mined through the same raycast/mining/drop path
    // as a player's held mouse button. No inventory give calls occur.
    await mineResources(7, 'log', 20);
    for (let i = 0; i < 14; i++) craft('planks', 'planks', 4);
    craft('workbench');
    for (let i = 0; i < 6; i++) craft('stick', 'stick', 4);
    await place('workbench', 13, workbench); await open(workbench, 'workbench'); craft('wood_pickaxe'); select('wood_pickaxe');
    stage('wood_tools', { workbenchPlaced: world.getBlock(workbench.x, feet, workbench.z) === 13 });
    await mineResources(3, 'cobblestone', 11);
    await open(workbench, 'workbench'); craft('stone_pickaxe'); craft('furnace');
    await place('furnace', 14, furnacePosition); await open(furnacePosition, 'furnace');
    transferToContainer('log', 1, 0); transferToContainer('planks', 1, 1);
    await advance(5); await verifySave('charcoal_mid_smelting'); await advance(5.1);
    takeFurnaceOutput('charcoal', 1);
    await open(workbench, 'workbench'); craft('torch_charcoal', 'torch', 4);
    assert(bagCount('coal') === 0, 'Coal-free lighting accidentally used coal.');
    stage('coal_free_torches', { torches: bagCount('torch'), coal: bagCount('coal') });

    await open(furnacePosition, 'furnace'); transferToContainer('log', 5, 0); transferToContainer('planks', 5, 1);
    await advance(50.1); takeFurnaceOutput('charcoal', 5);
    select('stone_pickaxe'); const oreCount = fullIron ? 33 : 3;
    await mineResources(10, 'raw_iron', oreCount);
    await open(furnacePosition, 'furnace'); transferToContainer('raw_iron', oreCount, 0);
    // Charcoal production can leave unconsumed planks in the fuel slot. Return
    // those through the normal shift transfer before changing the fuel type.
    if (game.getContainer().slots[1]) game.clickSlot('container', 1, false, true);
    assert(game.getContainer().slots[1] === null, 'Could not return the previous furnace fuel to inventory.');
    transferToContainer('charcoal', 5, 1);
    await advance(5); await verifySave('iron_mid_smelting'); await advance(oreCount * 10 - 5 + .1);
    takeFurnaceOutput('iron_ingot', oreCount);
    stage('iron_smelting', { smeltedIngots: oreCount });
    await open(workbench, 'workbench'); craft('iron_pickaxe');
    if (fullIron) {
      for (const tool of ['axe', 'shovel', 'sword']) craft(`iron_${tool}`);
      for (const armor of ['helmet', 'chestplate', 'leggings', 'boots']) craft(`iron_${armor}`);
      sim.closeContainer();
      for (const id of ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']) {
        const index = sim.player.inventory.findIndex(s => s?.id === id); assert(index >= 0, `Missing crafted ${id}.`); game.clickSlot('inventory', index, false, true);
      }
    }
    stage('iron_equipment_earned', { armorEquipped: Object.values(sim.player.armor).filter(Boolean).length });

    // Wool is an explicitly declared resource-block fixture, not a claimed
    // hunting check. Bed crafting, two-cell placement and sleeping are real.
    select('iron_pickaxe'); await mineResources(23, 'wool', 3);
    await open(workbench, 'workbench'); craft('bed'); craft('chest'); craft('door', 'door', 3);
    await place('bed', 22, bed); assert(world.getBlock(bed.x, bed.y, bed.z + 1) === 27, 'Bed head was not placed.');
    await place('chest', 15, chest);
    await open(chest, 'chest');
    for (const id of ['wood_pickaxe', 'stone_pickaxe']) {
      const index = sim.player.inventory.findIndex(s => s?.id === id); assert(index >= 0, `Missing ${id} to store.`); game.clickSlot('inventory', index, false, true);
    }
    assert(game.getContainer().slots.filter(Boolean).length === 2, 'Expected two used tools in the chest.');
    sim.closeContainer();

    // This shell is injected solely to provide a reviewable scene for UI
    // screenshots. Its materials are intentionally not counted as earned.
    for (let dx = -4; dx <= 4; dx++) for (let dz = -5; dz <= 2; dz++) {
      for (let dy = 1; dy <= 4; dy++) {
        const edge = dx === -4 || dx === 4 || dz === -5 || dz === 2;
        if (dy !== 4 && !edge) continue;
        if (dx === 0 && dz === 2 && dy <= 2) continue;
        const windowOpening = dy === 2 && ((Math.abs(dx) === 4 && dz >= -3 && dz <= -1) || (dz === -5 && Math.abs(dx) <= 1));
        world.setBlock(x + dx, floor + dy, z + dz, windowOpening ? 17 : dy === 4 ? 11 : (Math.abs(dx) === 4 && (dz === -5 || dz === 2)) ? 7 : 11);
        report.fixture.shellBlocks++;
      }
    }
    await place('door', 18, door);
    await place('torch', 16, { x: x - 1, y: feet, z: z - 2 });
    await place('torch', 16, { x: x + 3, y: feet, z: z - 4 });
    sim.time = 14000;
    stand(bed.x + .5, feet, bed.z + 2.5); await waitForWorld(); aim({ x: bed.x + .5, y: bed.y + .3, z: bed.z + .5 });
    game.command({ type: 'interact' }); pause();
    assert(sim.time === 1000 && sim.player.bedSpawn?.x === bed.x && sim.player.bedSpawn?.z === bed.z, `Bed did not sleep/set spawn: ${sim.lastMessage}`);
    stage('shelter_bed_chest', { note: 'Shelter shell is a developer screenshot fixture; earned bed/chest/door/torches are placed by game rules.', sleptToMorning: true });
    sim.closeContainer(); select('iron_pickaxe');
    stand(x + 1.5, feet, z + .5); aim({ x: x - .5, y: feet + 1, z: z - 3.5 });
    await waitForWorld(true);
    await verifySave('finished_fixture');
    game.command({ type: 'select', index: sim.player.selected });
    report.renderer = { chunks: world.stats.chunks, pending: world.stats.pending, drawCalls: game.renderer.info.render.calls, geometries: game.renderer.info.memory.geometries, realMeshesReady: world.ready && world.stats.pending === 0 };
    assert(report.renderer.realMeshesReady && report.renderer.drawCalls > 0, 'Real renderer did not receive finished chunk geometry.');
    report.passed = true;
    report.nextUIActions = 'Continue the game to inspect the earned iron tool and shelter. Open the chest, furnace or inventory for actual UI screenshots. This acceptance did not simulate DOM clicks or manual play.';
  } catch (error) {
    report.errors.push(error instanceof Error ? error.message : String(error));
    report.partialTotals = summarize(sim.snapshot());
  } finally {
    pause();
    report.simulation.advancedSeconds = Math.round(report.simulation.advancedSeconds * 100) / 100;
    report.wallMilliseconds = Math.round(performance.now() - started);
    window.__voxelAcceptanceReport = report;
  }
  return report;
}

/** A self-contained expression for CDP Runtime.evaluate({awaitPromise:true}). */
export function browserAcceptanceExpression(options = {}) {
  return `(${runBrowserAcceptance.toString()})(${JSON.stringify(options)})`;
}
