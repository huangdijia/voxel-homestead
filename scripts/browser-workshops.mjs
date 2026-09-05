/**
 * DEV-only, staged browser acceptance. This module never clicks a DOM element or
 * takes an enchanting/workshop output: the operator must click the real UI between
 * stages. Run only in the fresh, empty survival world guarded below.
 *
 * const { runBrowserWorkshops } = await import('/scripts/browser-workshops.mjs');
 * await runBrowserWorkshops(); // first book offers become visible
 * // Click the indicated offer, then call __workshopFixture.afterBook().
 * // Thereafter follow report.pendingUi and the returned nextMethod.
 */
export async function runBrowserWorkshops() {
  const game = window.__voxelGame;
  const sim = game?.simulation;
  const world = game?.world;
  if (window.__workshopFixture?.worldId === sim?.manifest.id)
    throw Error(
      "This fixture already owns this world; use its nextMethod, not prepare again",
    );

  const report = (window.__workshopAcceptance = {
    version: 1,
    passed: false,
    startedAt: new Date().toISOString(),
    phase: "initializing",
    stages: [],
    checkpoints: [],
    errors: [],
    advancedSeconds: 0,
    miningSeconds: 0,
    pendingUi: null,
    fixture: {
      name: "铁与旧书 · 工坊验收",
      seed: "M2-workshops-20260905",
      mode: "survival",
      saveVersion: 7,
      generatorVersion: 6,
      grants: [
        { id: "workbench", count: 1 },
        { id: "planks", count: 10 },
        { id: "stick", count: 4 },
        { id: "stone", count: 3 },
        { id: "iron_ingot", count: 31 },
        { id: "diamond_pickaxe", count: 1, durability: 100 },
        { id: "diamond", count: 6 },
        { id: "book", count: 3 },
        { id: "lapis_lazuli", count: 9 },
        { id: "obsidian", count: 4 },
        { id: "bookshelf", count: 15 },
      ],
      experienceLevel: 60,
      setup: [
        "Clear a 15 by 11 stone pad near spawn, including nine blocks of headroom; teleport for safe raycasts",
        "All 15 granted shelves and four workstations are placed by actual item use against a raycast face",
        "Craft three iron blocks, an anvil, six stone slabs, a grindstone and an enchanting table from the declared materials",
        "Choose and record the first book seed with a level-30 offer hint suitable for the diamond pickaxe",
        "The ordinary second book uses the real seed advanced by the first purchase",
        "After workshop UI proof, mine and reuse the crafted anvil; a floating stone support is explicit falling-fixture scaffolding",
        "Accelerate only declared fixed simulation ticks; no offline elapsed-time or FPS assertion",
      ],
    },
    limitations: [
      "Assisted rule/UI acceptance, not an unassisted survival run, native keyboard/fullscreen test or performance benchmark",
      "Table and workshop result buttons, plus the name field, must be operated separately through the real DOM",
      "Mid-fall save is loaded through IndexedDB and compared; actual page reload is left to the operator after final save",
      "Named chest/furnace placement is not covered by this bounded browser fixture",
    ],
  });
  const assert = (ok, message) => {
    if (!ok) throw Error(message);
  };
  const canonical = (value) =>
    JSON.stringify(value, (_key, child) =>
      child && typeof child === "object" && !Array.isArray(child)
        ? Object.fromEntries(
            Object.entries(child).sort(([a], [b]) => a.localeCompare(b)),
          )
        : child,
    );
  const clone = (value) => structuredClone(value);
  const fail = (error) => {
    report.errors.push(String(error));
    report.phase = "failed";
    report.failedAt = new Date().toISOString();
    if (window.__voxelGame === game) game?.showOverlay("pause");
    return report;
  };
  try {
    assert(sim && world, "DEV game bridge not available");
    assert(
      sim.manifest.name === report.fixture.name &&
        sim.manifest.seed === report.fixture.seed &&
        sim.manifest.mode === "survival" &&
        sim.manifest.version === 7 &&
        sim.manifest.generatorVersion === 6,
      "Wrong world; fixture requires the exact fresh v7/gen6 named survival world",
    );
    assert(
      world.getChanges().length === 0 &&
        sim.player.inventory.every((slot) => !slot) &&
        Object.values(sim.player.armor).every((slot) => !slot) &&
        sim.craftSlots.every((slot) => !slot) &&
        !sim.cursor,
      "World is not fresh and empty; existing progress will not be overwritten",
    );
    game.showOverlay("pause");
    report.worldId = sim.manifest.id;
    report.initialPlayedSeconds = sim.manifest.playedSeconds;
    const { addItem, countItem } = await import("/src/game/inventory.ts");
    const { ITEMS, BLOCKS } = await import("/src/game/registry.ts");
    const storage = await import("/src/game/storage.ts");
    const { getEnchantingOffers } = await import("/src/game/enchanting.ts");
    const { getAnvilResult } = await import("/src/game/workshops.ts");
    const { workshopBlockState } = await import("/src/engine/shapes.ts");
    const { experienceForLevel, experienceStatus, spendLevels } =
      await import("/src/game/experience.ts");
    const idle = {
      forward: 0,
      right: 0,
      jump: false,
      sprint: false,
      sneak: false,
    };
    const floorY = Math.floor(sim.player.spawn.y) - 1;
    const y = floorY + 1;
    const positions = {
      table: { x: 0, y, z: 0 },
      workbench: { x: 4, y, z: -2 },
      anvil: { x: 4, y, z: 0 },
      grindstone: { x: 4, y, z: 2 },
    };
    report.positions = clone(positions);
    let action = null;
    let firstBook = null;
    let firstMerge = null;
    let phase = "initializing";
    const setPhase = (value) => {
      phase = value;
      report.phase = value;
    };
    const stage = (name, details = {}) =>
      report.stages.push({ name, passed: true, ...details });
    const ownWorld = () =>
      assert(
        window.__voxelGame === game &&
          game.simulation === sim &&
          sim.manifest.id === report.worldId &&
          !sim.player.dead,
        "Fixture world changed, game reloaded, or player died",
      );
    const run = async (expected, task) => {
      try {
        ownWorld();
        assert(phase === expected, `Expected phase ${expected}, got ${phase}`);
        game.showOverlay("pause");
        await task();
        report.playedSeconds = sim.manifest.playedSeconds;
        return report;
      } catch (error) {
        phase = "failed";
        return fail(error);
      }
    };
    const count = (id) => countItem(sim.player.inventory, id);
    const waitReady = async (points) => {
      const started = performance.now();
      while (
        !points.every((point) => world.isReady(point.x, point.z, point.y))
      ) {
        ownWorld();
        assert(performance.now() - started < 55000, "Chunk loading timed out");
        await new Promise(requestAnimationFrame);
      }
    };
    const teleport = async (position) => {
      sim.player.position = clone(position);
      sim.player.velocity = { x: 0, y: 0, z: 0 };
      world.update(position, game.settings.renderDistance);
      await waitReady(
        [-1, 0, 1].flatMap((dx) =>
          [-1, 0, 1].flatMap((dz) =>
            [-1, 0, 1, 2].map((dy) => ({
              x: position.x + dx,
              y: position.y + dy,
              z: position.z + dz,
            })),
          ),
        ),
      );
    };
    const set = (x, yy, z, id) =>
      assert(
        sim.setBlock(x, yy, z, id),
        `Fixture edit failed at ${x},${yy},${z}`,
      );
    const look = (position) => {
      const eye = sim.eye();
      const dx = position.x - eye.x,
        dy = position.y - eye.y,
        dz = position.z - eye.z;
      sim.player.yaw = Math.atan2(-dx, -dz);
      sim.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    };
    const select = (id) => {
      const index = sim.player.inventory.findIndex((slot) => slot?.id === id);
      assert(index >= 0, `Missing inventory item ${id}`);
      if (index > 8)
        [sim.player.inventory[8], sim.player.inventory[index]] = [
          sim.player.inventory[index],
          sim.player.inventory[8],
        ];
      sim.player.selected = Math.min(index, 8);
    };
    const targetAt = (position) => {
      const target = sim.target();
      assert(
        target &&
          target.position.x === position.x &&
          target.position.y === position.y &&
          target.position.z === position.z,
        `Raycast missed ${canonical(position)}; got ${canonical(target)}`,
      );
      return target;
    };
    const place = async (id, position) => {
      sim.closeContainer();
      game.showOverlay("pause");
      // Stand above and behind the target so previously placed neighboring shelves cannot occlude it.
      await teleport({
        x: position.x + 0.5,
        y: position.y + 1.3,
        z: position.z + 1.7,
      });
      select(id);
      look({ x: position.x + 0.5, y: position.y, z: position.z + 0.5 });
      const target = targetAt({ ...position, y: position.y - 1 });
      assert(target.normal.y === 1, `No upward placement face for ${id}`);
      const before = count(id);
      sim.interact();
      const placed = world.getBlock(position.x, position.y, position.z);
      const expected = ITEMS[id].block;
      assert(
        workshopBlockState(expected)
          ? workshopBlockState(placed)?.kind ===
              workshopBlockState(expected).kind &&
              (workshopBlockState(expected).kind !== "anvil" ||
                workshopBlockState(placed).damage ===
                  workshopBlockState(expected).damage)
          : placed === expected,
        `Placed block mismatch for ${id}: ${placed}`,
      );
      assert(
        count(id) === before - 1,
        `Placement did not consume exactly one ${id}`,
      );
    };
    const open = async (kind, position) => {
      sim.closeContainer();
      game.showOverlay("pause");
      await teleport(
        kind === "enchanting"
          ? { x: position.x + 0.5, y: position.y, z: position.z + 1.6 }
          : { x: position.x + 2.1, y: position.y, z: position.z + 0.5 },
      );
      look({ x: position.x + 0.5, y: position.y + 0.65, z: position.z + 0.5 });
      targetAt(position);
      sim.interact();
      assert(sim.station === kind, `Interaction did not open ${kind}`);
      // Prevent unattended simulation during asynchronous checkpoint construction.
      game.showOverlay("pause");
    };
    const moveInput = (id) => {
      const index = sim.player.inventory.findIndex((slot) => slot?.id === id);
      assert(index >= 0, `Missing input ${id}`);
      sim.clickSlot("inventory", index, false, true);
    };
    const advance = async (seconds) => {
      for (let i = 0; i < Math.round(seconds * 60); i++) {
        sim.step(1 / 60, idle);
        report.advancedSeconds += 1 / 60;
        if (i % 120 === 0) await new Promise(requestAnimationFrame);
      }
      ownWorld();
    };
    const stableSave = (save) => {
      const result = clone(save);
      delete result.manifest.updatedAt; // snapshot() stamps the current save attempt.
      return result;
    };
    const checkpoint = async (name) => {
      game.showOverlay("pause");
      const before = storage.validateSave(sim.snapshot());
      await game.save(); // Uses the real serialized checkpoint writer and IndexedDB transaction.
      const after = await storage.loadWorld(report.worldId);
      assert(
        after && canonical(stableSave(before)) === canonical(stableSave(after)),
        `Checkpoint mismatch: ${name}`,
      );
      const bytes = new TextEncoder().encode(canonical(stableSave(after)));
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      ]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      report.checkpoints.push({
        name,
        passed: true,
        version: after.manifest.version,
        generatorVersion: after.manifest.generatorVersion,
        points: after.progression.points,
        changes: after.changes.length,
        sha256WithoutUpdatedAt: digest,
        temporarySlotsFoldedIntoInventory:
          sim.craftSlots.filter(Boolean).length + Number(!!sim.cursor),
      });
      return after;
    };
    const pending = (type, nextMethod, details) => {
      report.pendingUi = { type, nextMethod, ...details };
      game.showOverlay(
        type === "book"
          ? "enchanting"
          : type === "grindstone"
            ? "grindstone"
            : "anvil",
      );
    };
    const experienceTotal = () =>
      sim.progression.points +
      sim.progression.orbs.reduce((sum, orb) => sum + orb.value, 0);
    const locateOutput = (expected) =>
      [sim.cursor, ...sim.player.inventory].find(
        (slot) => slot && canonical(slot) === canonical(expected),
      );

    const prepareBook = async (second = false) => {
      await open("enchanting", positions.table);
      const beforeBooks = count("book");
      moveInput("book");
      moveInput("lapis_lazuli");
      assert(
        sim.craftSlots[0]?.id === "book" &&
          sim.craftSlots[0].count === 1 &&
          count("book") === beforeBooks - 1,
        "Table shift-click did not isolate one ordinary book",
      );
      if (!second) {
        const accepted = new Set([
          "efficiency",
          "unbreaking",
          "fortune",
          "silk_touch",
        ]);
        const originalSeed = sim.progression.enchantmentSeed;
        let selected = null;
        for (let seed = 0; seed < 4096; seed++) {
          const offer = getEnchantingOffers(
            sim.craftSlots[0],
            15,
            seed,
            sim.progression.points,
            sim.craftSlots[1].count,
          )[2];
          if (offer.available && accepted.has(offer.hint?.id)) {
            selected = seed;
            break;
          }
        }
        assert(
          selected !== null,
          "No compatible reproducible book offer found",
        );
        sim.progression.enchantmentSeed = selected;
        report.fixture.bookSeed = {
          original: originalSeed,
          selected,
          criterion:
            "First seed from 0 whose third hint applies to a diamond pickaxe",
        };
      }
      const view = sim.getEnchanting();
      assert(
        view?.bookshelves === 15 &&
          view.offers[2].available &&
          view.offers[2].requiredLevel === 30,
        "Fifteen shelves did not provide an available level-30 book offer",
      );
      action = {
        kind: "book",
        second,
        points: sim.progression.points,
        seed: sim.progression.enchantmentSeed,
        lapis: sim.craftSlots[1].count,
        offer: clone(view.offers[2]),
        input: clone(sim.craftSlots[0]),
      };
      await checkpoint(
        second ? "second-book-before-ui" : "ordinary-book-before-ui",
      );
      setPhase(second ? "second-book-ui" : "first-book-ui");
      pending("book", second ? "afterSecondBook" : "afterBook", {
        option: 2,
        instruction: "Click the visible third enchanting offer button",
        view: clone(view),
        fixtureSeed: action.seed,
        pointsBefore: action.points,
        lapisBefore: action.lapis,
      });
    };
    const confirmBook = async () => {
      assert(action?.kind === "book", "No book action pending");
      const enchanted = sim.craftSlots[0];
      assert(
        enchanted?.id === "enchanted_book" &&
          enchanted.count === 1 &&
          enchanted.enchantments?.[action.offer.hint.id] ===
            action.offer.hint.level,
        "The real table UI has not produced the hinted enchanted book",
      );
      assert(
        sim.craftSlots[1]?.count === action.lapis - action.offer.lapisCost,
        "Book purchase lapis consumption differs",
      );
      assert(
        Math.abs(
          sim.progression.points -
            spendLevels(action.points, action.offer.levelCost),
        ) < 1e-7,
        "Book purchase level cost differs",
      );
      assert(
        sim.progression.enchantmentSeed !== action.seed,
        "Book purchase did not advance its seed",
      );
      stage(
        action.second
          ? "second-book-real-offer-button"
          : "first-book-real-offer-button",
        {
          output: clone(enchanted),
          pointsBefore: action.points,
          pointsAfter: sim.progression.points,
          lapisCost: action.offer.lapisCost,
          seedBefore: action.seed,
          seedAfter: sim.progression.enchantmentSeed,
        },
      );
      const result = clone(enchanted);
      sim.closeContainer();
      await checkpoint(
        action.second ? "second-book-after-ui" : "first-book-after-ui",
      );
      return result;
    };
    const prepareWorkshop = async (
      operation,
      leftId,
      rightId = null,
      name = null,
    ) => {
      const kind = operation === "grind" ? "grindstone" : "anvil";
      await open(kind, positions[kind]);
      moveInput(leftId);
      if (rightId) moveInput(rightId);
      const current = sim.getWorkshop();
      const expected =
        operation === "rename"
          ? getAnvilResult(
              sim.craftSlots[0],
              sim.craftSlots[1],
              name,
              sim.progression.points,
              false,
            )
          : current;
      assert(
        expected?.available && expected.output,
        `Unavailable workshop fixture ${operation}: ${canonical(expected)}`,
      );
      action = {
        kind,
        operation,
        points: sim.progression.points,
        experienceTotal: experienceTotal(),
        left: clone(sim.craftSlots[0]),
        right: clone(sim.craftSlots[1]),
        expected: clone(expected),
        anvilId:
          kind === "anvil"
            ? world.getBlock(positions.anvil.x, y, positions.anvil.z)
            : null,
      };
      await checkpoint(`${operation}-before-ui`);
      setPhase(`${operation}-ui`);
      const nextMethod = {
        merge: "afterMerge",
        rename: "afterRename",
        repair: "afterRepair",
        grind: "finish",
      }[operation];
      pending(kind, nextMethod, {
        operation,
        instruction:
          operation === "rename"
            ? `Use the visible name field to enter “${name}”, then click the visible result slot`
            : "Click the visible workshop result slot (ordinary click or Shift + click)",
        ...(name ? { name } : {}),
        expectedOutput: clone(expected.output),
        expectedLevelCost: expected.levelCost,
        expectedMaterialCost: expected.materialCost,
        expectedExperience: [expected.experienceMin, expected.experienceMax],
      });
    };
    const confirmWorkshop = async () => {
      assert(
        action?.kind === "anvil" || action?.kind === "grindstone",
        "No workshop result pending",
      );
      assert(
        !sim.craftSlots[0],
        "Workshop left input was not consumed by a real UI result click",
      );
      const remaining =
        (action.right?.count ?? 0) - action.expected.materialCost;
      assert(
        (sim.craftSlots[1]?.count ?? 0) === remaining,
        "Workshop right material count differs",
      );
      assert(
        locateOutput(action.expected.output),
        `Expected result is absent from cursor/inventory: ${canonical(action.expected.output)}`,
      );
      if (action.kind === "anvil") {
        assert(
          Math.abs(
            sim.progression.points -
              spendLevels(action.points, action.expected.levelCost),
          ) < 1e-7,
          "Anvil level cost differs",
        );
        const id = world.getBlock(positions.anvil.x, y, positions.anvil.z);
        assert(
          id === action.anvilId ||
            id === action.anvilId + 2 ||
            (action.anvilId >= 118 && id === 0),
          "Anvil damage stage changed unexpectedly",
        );
      } else {
        const gain = experienceTotal() - action.experienceTotal;
        assert(
          gain >= action.expected.experienceMin - 1e-7 &&
            gain <= action.expected.experienceMax + 1e-7,
          `Grindstone XP outside quoted range: ${gain}`,
        );
        report.grindExperience = {
          awarded: gain,
          min: action.expected.experienceMin,
          max: action.expected.experienceMax,
        };
      }
      stage(`${action.operation}-real-result-button`, {
        output: clone(action.expected.output),
        levelCost: action.expected.levelCost,
        materialCost: action.expected.materialCost,
        pointsAfter: sim.progression.points,
        anvilIdAfter:
          action.kind === "anvil"
            ? world.getBlock(positions.anvil.x, y, positions.anvil.z)
            : null,
      });
      sim.closeContainer();
      await checkpoint(`${action.operation}-after-ui`);
    };
    const mine = async (position) => {
      select("diamond_pickaxe");
      look({ x: position.x + 0.5, y: position.y + 0.65, z: position.z + 0.5 });
      targetAt(position);
      const original = world.getBlock(position.x, position.y, position.z);
      let mined = false;
      for (let i = 0; i < 1800; i++) {
        report.miningSeconds += 1 / 60;
        if (sim.mine(1 / 60)) {
          mined = true;
          break;
        }
      }
      assert(
        mined &&
          world.getBlock(position.x, position.y, position.z) !== original,
        "Mining did not break the aimed block",
      );
    };
    const finishFall = async () => {
      const originalId = world.getBlock(
        positions.anvil.x,
        y,
        positions.anvil.z,
      );
      assert(
        workshopBlockState(originalId)?.kind === "anvil",
        "The crafted anvil broke during the three real uses; no substitute will be silently granted",
      );
      await teleport({
        x: positions.anvil.x + 2.1,
        y,
        z: positions.anvil.z + 0.5,
      });
      await mine(positions.anvil);
      await teleport({
        x: positions.anvil.x + 0.5,
        y,
        z: positions.anvil.z + 0.5,
      });
      await advance(1.5);
      const id = BLOCKS[originalId].drop;
      assert(
        count(id) === 1,
        "The crafted anvil drop was not picked up exactly once",
      );
      const support = { x: 6, y: y + 5, z: 3 };
      set(support.x, support.y, support.z, 3);
      const start = { ...support, y: support.y + 1 };
      await place(id, start);
      const placedId = world.getBlock(start.x, start.y, start.z);
      await teleport({ x: support.x + 2.1, y: support.y, z: support.z + 0.5 });
      await mine(support);
      await teleport({ x: 6.5, y, z: 5.5 });
      let falling = null;
      for (let i = 0; i < 40; i++) {
        await advance(0.1);
        falling = sim.natural
          .snapshot()
          .anvilFalls?.find(
            (point) => point.x === start.x && point.z === start.z,
          );
        if (falling) break;
      }
      assert(
        falling && falling.distance > 0 && falling.y > y,
        "Could not observe the anvil before landing",
      );
      const inFlight = await checkpoint("anvil-in-flight-before-landing");
      window.__workshopFallingSaved = clone(inFlight);
      for (let i = 0; i < 80; i++) {
        await advance(0.1);
        const state = sim.natural.snapshot();
        if (
          !state.anvilFalls?.length &&
          !state.falling.some((point) => point.id >= 114 && point.id <= 119)
        )
          break;
      }
      const landedId = world.getBlock(start.x, y, start.z);
      assert(
        landedId === placedId ||
          landedId === placedId + 2 ||
          (placedId >= 118 && landedId === 0),
        `Anvil landing or wear state differs: ${placedId} -> ${landedId}`,
      );
      assert(
        !sim.natural.snapshot().anvilFalls?.length,
        "Anvil distance record remained after landing",
      );
      assert(
        ["anvil", "chipped_anvil", "damaged_anvil"].every(
          (key) => count(key) === 0,
        ),
        "Reused anvil duplicated in inventory",
      );
      stage("mine-reuse-fall-and-midfall-checkpoint", {
        initialUsedAnvil: originalId,
        relocatedAnvil: placedId,
        start,
        landing: { x: start.x, y, z: start.z },
        checkpointDistance: falling.distance,
        checkpointPosition: clone(falling),
        landedId,
        reusedCraftedAnvil: true,
        extraAnvilGrants: 0,
      });
    };

    const api = (window.__workshopFixture = {
      worldId: report.worldId,
      prepare: () =>
        run("initializing", async () => {
          for (const grant of report.fixture.grants)
            assert(
              !addItem(sim.player.inventory, clone(grant)),
              `Fixture grant overflow: ${grant.id}`,
            );
          sim.progression.points = experienceForLevel(60);
          report.fixture.experiencePoints = sim.progression.points;
          await teleport({ x: 6.5, y, z: 4.5 });
          await waitReady(
            [-6, 8].flatMap((x) =>
              [-5, 5].flatMap((z) =>
                [floorY, y + 9].map((yy) => ({ x, y: yy, z })),
              ),
            ),
          );
          for (let x = -6; x <= 8; x++)
            for (let z = -5; z <= 5; z++) {
              set(x, floorY, z, 3);
              for (let yy = y; yy <= y + 8; yy++) set(x, yy, z, 0);
            }
          await place("workbench", positions.workbench);
          await open("workbench", positions.workbench);
          for (let i = 0; i < 3; i++) sim.craft("iron_block");
          assert(
            count("iron_block") === 3 && count("iron_ingot") === 4,
            "Iron-block recipe quantities differ",
          );
          for (const recipe of [
            "anvil",
            "stone_slab",
            "grindstone",
            "enchanting_table",
          ])
            sim.craft(recipe);
          assert(
            count("anvil") === 1 &&
              count("grindstone") === 1 &&
              count("stone_slab") === 5 &&
              count("enchanting_table") === 1 &&
              count("iron_ingot") === 0 &&
              count("iron_block") === 0 &&
              count("stone") === 0 &&
              count("book") === 2 &&
              count("diamond") === 4 &&
              count("planks") === 8 &&
              count("stick") === 2 &&
              count("obsidian") === 0,
            "Crafting chain did not consume the declared quantities",
          );
          sim.closeContainer();
          await place("anvil", positions.anvil);
          await place("grindstone", positions.grindstone);
          await place("enchanting_table", positions.table);
          const shelves = [];
          for (let x = -2; x <= 2; x++)
            for (let z = -2; z <= 2; z++) {
              if (
                (Math.abs(x) !== 2 && Math.abs(z) !== 2) ||
                (x === 0 && z === 2)
              )
                continue;
              await place("bookshelf", { x, y, z });
              shelves.push({ x, y, z });
            }
          assert(
            shelves.length === 15 && count("bookshelf") === 0,
            "Shelf placement quantities differ",
          );
          report.fixture.placedShelves = shelves;
          stage("real-recipes-and-raycast-placement", {
            ironIngotsConsumed: 31,
            stoneSlabsMade: 6,
            slabsConsumedByGrindstone: 1,
            tables: 1,
            anvils: 1,
            grindstones: 1,
            shelves: 15,
            diamondPickaxeInitialDurability: sim.player.inventory.find(
              (slot) => slot?.id === "diamond_pickaxe",
            )?.durability,
          });
          await checkpoint("crafted-workshop");
          await prepareBook(false);
        }),
      afterBook: () =>
        run("first-book-ui", async () => {
          firstBook = await confirmBook();
          await prepareWorkshop("merge", "diamond_pickaxe", "enchanted_book");
          firstMerge = clone(action.expected.output);
        }),
      afterMerge: () =>
        run("merge-ui", async () => {
          await confirmWorkshop();
          assert(
            count("enchanted_book") === 0,
            "Applied enchanted book was not consumed",
          );
          assert(
            firstMerge.durability === 100 && firstBook.enchantments,
            "Applying a book unexpectedly repaired the fixture tool",
          );
          await prepareWorkshop(
            "rename",
            "diamond_pickaxe",
            null,
            "远行者的镐",
          );
        }),
      afterRename: () =>
        run("rename-ui", async () => {
          await confirmWorkshop();
          const pickaxe = sim.player.inventory.find(
            (slot) => slot?.id === "diamond_pickaxe",
          );
          assert(
            pickaxe?.customName === "远行者的镐" &&
              pickaxe.repairCost === firstMerge.repairCost,
            "Naming changed the prior-work penalty",
          );
          await prepareWorkshop("repair", "diamond_pickaxe", "diamond");
          assert(
            action.expected.materialCost === 4 &&
              action.expected.output.durability === 1561,
            "Damaged diamond pickaxe did not quote four diamonds and full durability",
          );
        }),
      afterRepair: () =>
        run("repair-ui", async () => {
          await confirmWorkshop();
          const pickaxe = sim.player.inventory.find(
            (slot) => slot?.id === "diamond_pickaxe",
          );
          assert(
            pickaxe?.durability === 1561 &&
              count("diamond") === 0 &&
              canonical(pickaxe.enchantments) ===
                canonical(firstMerge.enchantments),
            "Material repair failed to preserve enchantments or consume diamonds",
          );
          report.repairedTool = clone(pickaxe);
          await prepareBook(true);
        }),
      afterSecondBook: () =>
        run("second-book-ui", async () => {
          report.secondBook = await confirmBook();
          assert(
            count("book") === 0 && count("lapis_lazuli") === 3,
            "Second book conversion quantities differ",
          );
          await prepareWorkshop("grind", "enchanted_book");
        }),
      finish: () =>
        run("grind-ui", async () => {
          await confirmWorkshop();
          assert(
            count("book") === 1 && count("enchanted_book") === 0,
            "Disenchantment did not return exactly one ordinary book",
          );
          await advance(1.5);
          await finishFall();
          await teleport({ x: 5.7, y, z: 4.8 });
          look({ x: 0.5, y: y + 0.6, z: 0.5 });
          const final = await checkpoint("final-workshop-save");
          window.__workshopSaved = clone(final);
          report.final = {
            version: final.manifest.version,
            generatorVersion: final.manifest.generatorVersion,
            points: final.progression.points,
            level: experienceStatus(final.progression.points).level,
            pickaxe: clone(
              final.player.inventory.find(
                (slot) => slot?.id === "diamond_pickaxe",
              ),
            ),
            ordinaryBooks: count("book"),
            lapis: count("lapis_lazuli"),
            changes: final.changes.length,
            playedSeconds: final.manifest.playedSeconds,
          };
          report.passed = true;
          report.pendingUi = null;
          report.finishedAt = new Date().toISOString();
          setPhase("complete");
          game.showOverlay("pause");
        }),
      inspect: () => ({
        worldId: report.worldId,
        phase,
        pendingUi: clone(report.pendingUi),
        station: sim.station,
        slots: clone(sim.craftSlots),
        cursor: clone(sim.cursor),
        points: sim.progression.points,
        level: experienceStatus(sim.progression.points).level,
        workshop: clone(sim.getWorkshop()),
        enchanting: clone(sim.getEnchanting()),
      }),
    });
    return await api.prepare();
  } catch (error) {
    return fail(error);
  }
}
