#!/usr/bin/env node
/** Rebuild the Java 1.21.1 audit catalog. No game assets, npm installs, or game tests. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'docs/parity');
const args = new Set(process.argv.slice(2));
for (const arg of args) if (!['--check', '--fetch', '--self-test'].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
if (args.has('--check') && args.has('--fetch')) throw new Error('--check is offline/read-only; run --fetch separately.');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const lock = JSON.parse(await fs.readFile(path.join(directory, 'sources.lock.json'), 'utf8'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(lock.target.edition === 'Java' && lock.target.version === '1.21.1', 'Unexpected target');
assert(/^[a-f0-9]{40}$/.test(lock.upstream.commit), 'Source must be pinned to a Git commit');
const sourceData = {};
for (const [name, source] of Object.entries(lock.files)) {
  const expected = `https://raw.githubusercontent.com/PrismarineJS/minecraft-data/${lock.upstream.commit}/${source.path}`;
  assert(source.url === expected, `Unpinned source URL: ${name}`);
  assert(source.file === `sources/${source.path.replaceAll('/', '__')}`, `Unsafe cache path: ${name}`);
  if (args.has('--fetch')) {
    let downloaded;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(source.url, { signal: AbortSignal.timeout(30000) });
        assert(response.ok, `HTTP ${response.status}: ${source.url}`);
        downloaded = Buffer.from(await response.arrayBuffer());
        break;
      } catch (error) { if (attempt === 2) throw error; }
    }
    assert(hash(downloaded) === source.sha256 && downloaded.length === source.bytes, `Downloaded source hash/size mismatch: ${name}`);
    await fs.mkdir(path.dirname(path.join(directory, source.file)), { recursive: true });
    await fs.writeFile(path.join(directory, source.file), downloaded);
  }
  const bytes = await fs.readFile(path.join(directory, source.file));
  assert(hash(bytes) === source.sha256 && bytes.length === source.bytes, `Cached source hash/size mismatch: ${name}`);
  sourceData[name] = source.path.endsWith('.json') ? JSON.parse(bytes) : bytes.toString('utf8');
}
assert(sourceData.version.minecraftVersion === '1.21.1', 'Source version mismatch');
for (const [name, source] of Object.entries(lock.files)) {
  if (source.mappedVersion) assert(sourceData.dataPaths.pc['1.21.1'][name] === `pc/${source.mappedVersion}`, `Wrong version mapping: ${name}`);
}

// Execute only the project's existing data modules after TS erases type-only imports.
// No filesystem/network/process is exposed to these modules; unknown imports fail closed.
const allowedModules = new Set(['src/game/registry.ts', 'src/game/recipes.ts', 'src/game/inventory.ts']);
const modules = new Map();
const localSources = {};
async function loadLocal(relative) {
  assert(allowedModules.has(relative), `Unexpected local import: ${relative}`);
  if (modules.has(relative)) return modules.get(relative).exports;
  const content = await fs.readFile(path.join(root, relative), 'utf8');
  localSources[relative] = { sha256: hash(content), bytes: Buffer.byteLength(content) };
  const compiled = ts.transpileModule(content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const dependencies = new Map();
  for (const match of compiled.matchAll(/require\("(\.[^"]+)"\)/g)) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), `${match[1]}.ts`));
    dependencies.set(match[1], await loadLocal(resolved));
  }
  const module = { exports: {} };
  modules.set(relative, module);
  vm.runInNewContext(compiled, { exports: module.exports, module, require: (name) => {
    assert(dependencies.has(name), `Forbidden runtime import: ${name}`);
    return dependencies.get(name);
  } }, { filename: relative, timeout: 1000 });
  return module.exports;
}
const { BLOCKS, ITEMS, ENTITIES } = await loadLocal('src/game/registry.ts');
const { RECIPES, SMELTING } = await loadLocal('src/game/recipes.ts');
assert(Object.keys(BLOCKS).length > 0 && RECIPES.length > 0, 'Empty local registries');

const aliases = {
  grass: 'grass_block', log: 'oak_log', leaves: 'oak_leaves', planks: 'oak_planks', workbench: 'crafting_table',
  door: 'oak_door', door_open: 'oak_door', door_top: 'oak_door', door_top_open: 'oak_door',
  slab: 'oak_slab', bed: 'white_bed', bed_head: 'white_bed', wool: 'white_wool',
  raw_pork: 'porkchop', cooked_pork: 'cooked_porkchop', raw_mutton: 'mutton', wet_farmland: 'farmland',
};
const cropNames = { wheat: 'wheat', carrot: 'carrots', potato: 'potatoes', beetroot: 'beetroots' };
function canonical(localId) {
  const crop = /^(wheat|carrot|potato|beetroot)_crop_\d+$/.exec(localId);
  return `minecraft:${crop ? cropNames[crop[1]] : /^composter_[1-8]$/.test(localId) ? 'composter' : aliases[localId] ?? localId.replace(/^wood_/, 'wooden_').replace(/^gold_(pickaxe|axe|shovel|sword|hoe|helmet|chestplate|leggings|boots)$/, 'golden_$1')}`;
}
const baselineBlocks = new Set(Object.values(BLOCKS).filter((entry) => entry.id <= 27).map((entry) => canonical(entry.key)));
const baselineItems = new Set([
  ...Object.values(BLOCKS).filter((entry) => entry.id <= 24 && entry.id !== 19 && entry.id !== 0).map((entry) => canonical(entry.key)),
  ...['stick', 'coal', 'charcoal', 'raw_iron', 'iron_ingot', 'raw_pork', 'cooked_pork', 'raw_mutton', 'cooked_mutton', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'].map(canonical),
  ...['wood', 'stone', 'iron'].flatMap((material) => ['pickaxe', 'axe', 'shovel', 'sword'].map((tool) => canonical(`${material}_${tool}`))),
]);
const baselineEntities = new Set(['minecraft:pig', 'minecraft:sheep', 'minecraft:zombie', 'minecraft:creeper']);
const advancedPattern = /(?:^|_)(?:nether|netherite|netherrack|crimson|warped|basalt|blackstone|soul|quartz|glowstone|blaze|ghast|piglin|hoglin|zoglin|magma|wither|end|ender|purpur|chorus|shulker|elytra|dragon|redstone|repeater|comparator|piston|observer|dispenser|dropper|hopper|lever|button|pressure_plate|tripwire|target|daylight_detector|crafter|sculk|enchanting|brewing|beacon|conduit)(?:_|$)/;
function stageFor(domain, id, reference = {}) {
  if ((domain === 'blocks' && baselineBlocks.has(id)) || (['items', 'foods'].includes(domain) && baselineItems.has(id)) || (domain === 'entities' && baselineEntities.has(id)))
    return { stage: 'M1', stageBasis: 'existing-iron-survival-scope' };
  if (['enchantments', 'effects', 'attributes', 'instruments'].includes(domain) || reference.dimension === 'nether' || reference.dimension === 'end' || advancedPattern.test(id.replace('minecraft:', '')))
    return { stage: 'M3', stageBasis: 'planned-advanced-systems-review-required' };
  if (['sounds', 'particles'].includes(domain)) return { stage: 'M4', stageBasis: 'cross-stage-presentation-final-audit' };
  return { stage: 'M2', stageBasis: 'mainworld-content-backlog-review-required' };
}
const localReference = (entry, domain) => ({ id: String(domain === 'blocks' ? entry.id : entry.id ?? entry.kind), key: entry.key ?? entry.id ?? entry.kind, source: 'src/game/registry.ts' });
const localGroups = { blocks: new Map(), items: new Map(), entities: new Map() };
for (const [domain, definitions] of Object.entries({ blocks: BLOCKS, items: ITEMS, entities: ENTITIES })) {
  for (const entry of Object.values(definitions)) {
    const id = canonical(entry.key ?? entry.id ?? entry.kind);
    const references = localGroups[domain].get(id) ?? [];
    references.push(localReference(entry, domain));
    localGroups[domain].set(id, references);
  }
}
const templates = {
  blocks: ['obtain-place-break-drops', 'all-declared-states-collision-interaction', 'light-fluid-neighbor-updates', 'save-unload-reload'],
  items: ['obtain-stack-split-container', 'use-durability-remainder-components', 'death-drop-and-save-roundtrip'],
  entities: ['spawn-despawn-and-persistence', 'movement-ai-interactions', 'damage-loot-and-state-variants'],
  biomes: ['seeded-generation-and-boundaries', 'terrain-climate-features-spawn', 'save-unload-reload'],
  recipes: ['valid-input-exact-output', 'invalid-input-no-consumption', 'shift-mirror-or-shapeless-permutation', 'full-inventory-and-save-conservation'],
  foods: ['hunger-saturation-and-eating-time', 'effects-remainders-full-hunger-rule', 'save-and-death-conservation'],
  enchantments: ['acquisition-levels-conflicts', 'equipment-effect-and-durability', 'save-and-transfer'],
  effects: ['apply-amplifier-duration', 'stack-replace-remove-and-death', 'gameplay-effect-and-save'],
  attributes: ['base-bounds-and-modifiers', 'equipment-effect-and-removal', 'save-roundtrip'],
  particles: ['event-trigger-and-required-parameters', 'original-rendering-distance-and-settings'],
  sounds: ['event-trigger-and-category', 'original-audio-attenuation-volume-subtitles'],
  instruments: ['note-pitch-instrument-selection', 'redstone-trigger-and-original-audio'],
};
const catalog = {};
const idFor = (domain, record) => domain === 'attributes' ? record.resource : domain === 'instruments' ? `prismarine:instrument/${record.name}` : `minecraft:${domain === 'effects' ? record.name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase() : record.name}`;
for (const domain of Object.keys(templates).filter((domain) => domain !== 'recipes')) {
  assert(Array.isArray(sourceData[domain]), `Expected source array: ${domain}`);
  catalog[domain] = sourceData[domain].map((record, sourceIndex) => {
    const id = idFor(domain, record);
    const references = localGroups[domain]?.get(id) ?? (domain === 'foods' ? localGroups.items.get(id) ?? [] : []);
    return {
      id,
      idBasis: domain === 'effects' ? 'normalized-third-party-name-not-official-registry-report' : domain === 'instruments' ? 'synthetic-note-block-enum-not-resource-location' : 'third-party-resource-name',
      upstreamNumericId: record.id ?? null,
      ...stageFor(domain, id, record),
      implementation: { status: references.length ? 'partial-unverified' : 'not-mapped', localDefinitions: references },
      acceptance: { id: `java-1.21.1/${domain}/${id}`, template: domain, targetId: id, status: 'not-run', requiredChecks: templates[domain] },
      source: { file: domain, pointer: `/${sourceIndex}`, mappedVersion: lock.files[domain].mappedVersion },
      reference: record,
    };
  });
}

const itemIds = new Map(sourceData.items.map((item) => [item.id, `minecraft:${item.name}`]));
function resolveIngredient(id) {
  if (id === null || id === -1) return null;
  assert(itemIds.has(id), `Unknown recipe ingredient/result ID: ${id}`);
  return itemIds.get(id);
}
function trimShape(shape) {
  let rows = shape.map((row) => [...row]);
  while (rows.length && rows[0].every((value) => !value)) rows.shift();
  while (rows.length && rows.at(-1).every((value) => !value)) rows.pop();
  const width = Math.max(0, ...rows.map((row) => row.length));
  rows = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? null));
  while (rows.length && rows.every((row) => !row[0])) rows = rows.map((row) => row.slice(1));
  while (rows.length && rows[0].length && rows.every((row) => !row.at(-1))) rows = rows.map((row) => row.slice(0, -1));
  return rows;
}
function recipeSignature(recipe) {
  const input = recipe.kind === 'shaped'
    ? [JSON.stringify(trimShape(recipe.shape)), JSON.stringify(trimShape(recipe.shape).map((row) => row.slice().reverse()))].sort()[0]
    : JSON.stringify(recipe.ingredients.slice().sort());
  return JSON.stringify([recipe.kind, input, recipe.output.id, recipe.output.count]);
}
const localRecipes = RECIPES.map((recipe) => ({
  id: recipe.id,
  source: 'src/game/recipes.ts',
  kind: recipe.pattern ? 'shaped' : 'shapeless',
  ...(recipe.pattern ? { shape: recipe.pattern.map((row) => [...row].map((key) => recipe.keys?.[key] ? canonical(recipe.keys[key]) : null)) } : { ingredients: Object.entries(recipe.ingredients).flatMap(([id, count]) => Array.from({ length: count }, () => canonical(id))) }),
  output: { id: canonical(recipe.output.id), count: recipe.output.count },
  station: recipe.station,
}));
const localSignatures = new Map();
for (const recipe of localRecipes) {
  const signature = recipeSignature(recipe);
  localSignatures.set(signature, [...(localSignatures.get(signature) ?? []), recipe.id]);
}
catalog.recipes = [];
for (const [resultKey, records] of Object.entries(sourceData.recipes)) {
  for (const [sourceIndex, record] of records.entries()) {
    const normalized = {
      kind: record.inShape ? 'shaped' : 'shapeless',
      ...(record.inShape ? { shape: record.inShape.map((row) => row.map(resolveIngredient)) } : { ingredients: record.ingredients.map(resolveIngredient) }),
      output: { id: resolveIngredient(record.result.id), count: record.result.count },
    };
    assert(Number(resultKey) === record.result.id, `Recipe result group mismatch: ${resultKey}`);
    const signature = recipeSignature(normalized);
    const matching = localSignatures.get(signature) ?? [];
    const outputCandidates = localRecipes.filter((recipe) => recipe.output.id === normalized.output.id).map((recipe) => recipe.id);
    const id = `prismarine:recipe/${record.result.id}/${hash(JSON.stringify(record)).slice(0, 20)}`;
    catalog.recipes.push({
      id, idBasis: 'synthetic-source-record-hash-not-minecraft-recipe-resource-location',
      ...stageFor('items', normalized.output.id),
      implementation: { status: matching.length ? 'definition-match-unverified' : outputCandidates.length ? 'output-candidate-unverified' : 'not-mapped', localRecipes: matching, outputCandidates },
      acceptance: { id: `java-1.21.1/recipes/${id}`, template: 'recipes', targetId: id, status: 'not-run', requiredChecks: templates.recipes },
      source: { file: 'recipes', pointer: `/${resultKey}/${sourceIndex}`, mappedVersion: lock.files.recipes.mappedVersion },
      reference: normalized,
    });
  }
}
// All locally present smelting recipes remain visible, although this upstream recipes file has none.
const localSmelting = Object.entries(SMELTING).map(([input, result]) => ({
  id: `local:smelting/${input}`, input: canonical(input), output: { id: canonical(result.output), count: result.count },
  source: 'src/game/recipes.ts', status: 'local-definition-reference-domain-missing', acceptance: 'not-run',
}));
const unmatchedLocal = Object.fromEntries(Object.entries(localGroups).map(([domain, groups]) => {
  const ids = new Set(catalog[domain].map((entry) => entry.id));
  return [domain, [...groups.entries()].filter(([id]) => !ids.has(id)).map(([id, localDefinitions]) => ({ id, localDefinitions, status: 'no-reference-entry-review-required' }))];
}));

const gaps = [
  { id: 'dimensions', status: 'missing', stage: 'M3', reason: 'dataPaths has no dimension registry dataset; biome.dimension labels do not enumerate dimension types, generators, or portals.', gate: 'Pin Java 1.21.1 dimension and dimension_type resource IDs and definitions; verify height, scale, time, respawn and portal transitions separately.' },
  { id: 'structures', status: 'missing', stage: 'M2', reason: 'No structure/structure_set/template_pool dataset selected by this source.', gate: 'Obtain fixed-version resource IDs and generation/loot/encounter definitions; enumerate each structure, variants and dimension; test seeded location, exploration and reload.' },
  { id: 'official-recipe-resource-ids', status: 'missing', stage: 'M2', reason: 'recipes.json stores expanded crafting combinations keyed by numeric output IDs; official recipe resource locations and tags are absent.', gate: 'Pin resource-location recipes and tag expansion; deduplicate logical recipes without mistaking ingredient variants for separate official recipes.' },
  { id: 'non-crafting-recipes', status: 'missing', stage: 'M2', reason: 'All 1470 source records use inShape or ingredients; there is no smelting, blasting, smoking, campfire, stonecutting, smithing, brewing or special-recipe serializer catalog.', gate: 'Add every recipe type, serializer, timing, experience and remainder behavior; reconcile the existing local smelting definitions.' },
  { id: 'block-states-individual-acceptance', status: 'missing', stage: 'M2', reason: 'Block state ranges and property schemas are retained, but no per-state runtime acceptance is inferred from local numeric block aliases.', gate: 'Expand and validate each state combination and neighbor transition; fixed-facing doors/beds and partial farmland states cannot pass the whole block.' },
  { id: 'worldgen-registries-tags', status: 'missing', stage: 'M2', reason: 'Biome records do not include all configured/placed features, carvers, noise, density functions, tags, processors or presets.', gate: 'Pin each worldgen registry and tag; test generation relations and resource reachability across representative seeds.' },
  { id: 'loot-tables-trades-spawns', status: 'missing', stage: 'M2', reason: 'dataPaths maps blockLoot/entityLoot to 1.20; these older summaries were deliberately not counted as fixed 1.21.1 loot/trade/spawn coverage.', gate: 'Obtain fixed-version loot tables, predicates, item modifiers, spawn rules and villager trades; verify conditions, random ranges and progression.' },
  { id: 'commands', status: 'missing', stage: 'M4', reason: 'dataPaths points commands to 1.20.3; no command nodes have been counted as Java 1.21.1 semantics.', gate: 'Pin the 1.21.1 command tree; verify each argument, selector, permission, feedback, completion and state mutation with authority/reconnect tests.' },
  { id: 'data-components-advancements-statistics', status: 'missing', stage: 'M4', reason: 'No complete item-component, advancement, criterion, statistic, recipe-book, scoreboard, gamerule or data-pack catalog is included.', gate: 'Enumerate fixed-version registries and behavior entry points, then test persistence and all user-observable transitions.' },
  { id: 'non-data-behavior', status: 'missing', stage: 'M4', reason: 'Registry entries cannot enumerate gameplay algorithms, redstone semantics, UI interactions, modes or multiplayer consistency.', gate: 'Close the separately itemized behavior backlog and publish entry-specific automated plus real-browser evidence; see BEHAVIORS.md.' },
];

const statuses = new Set(['partial-unverified', 'definition-match-unverified', 'output-candidate-unverified', 'not-mapped']);
function validateCatalog(domains) {
  const caseIds = new Set();
  for (const [domain, entries] of Object.entries(domains)) {
    const seen = new Set();
    for (const entry of entries) {
      assert(!seen.has(entry.id), `Duplicate ${domain} ID: ${entry.id}`); seen.add(entry.id);
      assert(/^minecraft:[a-z0-9_.\/-]+$|^prismarine:[a-z0-9_.\/-]+$/.test(entry.id), `Invalid ID: ${entry.id}`);
      assert(['M1', 'M2', 'M3', 'M4'].includes(entry.stage), `Invalid stage: ${entry.id}`);
      assert(statuses.has(entry.implementation.status), `Invalid implementation status: ${entry.id}`);
      assert(entry.acceptance.status === 'not-run', `No entry-specific acceptance result may be fabricated: ${entry.id}`);
      assert(entry.acceptance.targetId === entry.id && entry.acceptance.requiredChecks.length > 0, `Missing acceptance case: ${entry.id}`);
      assert(!caseIds.has(entry.acceptance.id), `Duplicate acceptance case: ${entry.acceptance.id}`); caseIds.add(entry.acceptance.id);
      const record = entry.source.pointer.split('/').slice(1).reduce((value, key) => value?.[key], sourceData[entry.source.file]);
      assert(record !== undefined, `Unresolvable source pointer: ${entry.id}`);
    }
    const expected = domain === 'recipes' ? Object.values(sourceData.recipes).reduce((count, records) => count + records.length, 0) : sourceData[domain].length;
    assert(entries.length === expected, `Source count mismatch: ${domain}`);
  }
  const states = new Set();
  for (const block of sourceData.blocks) {
    assert(Number.isSafeInteger(block.minStateId) && block.maxStateId >= block.minStateId, `Invalid state range: ${block.name}`);
    assert(block.defaultState >= block.minStateId && block.defaultState <= block.maxStateId, `Invalid default state: ${block.name}`);
    assert(block.states.reduce((product, property) => product * property.num_values, 1) === block.maxStateId - block.minStateId + 1, `State property product mismatch: ${block.name}`);
    for (let state = block.minStateId; state <= block.maxStateId; state++) {
      assert(!states.has(state), `Overlapping block state ID: ${state}`); states.add(state);
    }
  }
  return { entries: caseIds.size, blockStateIdsInRanges: states.size };
}
const validation = validateCatalog(catalog);
const behaviorText = await fs.readFile(path.join(directory, 'BEHAVIORS.md'), 'utf8');
const behaviorCases = behaviorText.split('\n').flatMap((line, index) => {
  const match = /^\| (B-[A-Z]+-\d+) \| (M[1-4]) \| (.+) \|$/.exec(line);
  return match ? [{ id: match[1], stage: match[2], status: 'not-run', acceptance: match[3], source: { file: 'docs/parity/BEHAVIORS.md', line: index + 1 } }] : [];
});
const behaviorIds = new Set();
const declaredBehaviorRows = behaviorText.split('\n').filter((line) => /^\| B-/.test(line));
assert(behaviorCases.length === declaredBehaviorRows.length && behaviorCases.length > 0, 'Invalid behavior row/stage');
for (const entry of behaviorCases) {
  assert(!behaviorIds.has(entry.id), `Duplicate behavior case: ${entry.id}`); behaviorIds.add(entry.id);
}
const selfTests = [];
if (args.has('--self-test')) {
  const first = catalog.blocks[0];
  for (const [name, entries] of [
    ['reject duplicate IDs', [first, first]],
    ['reject invalid stage', [{ ...first, stage: 'M9' }]],
    ['reject fabricated acceptance pass', [{ ...first, acceptance: { ...first.acceptance, status: 'passed' } }]],
    ['reject missing source pointer', [{ ...first, source: { ...first.source, pointer: '/999999' } }]],
    ['reject incomplete source counts', [first]],
  ]) {
    let rejected = false;
    try { validateCatalog({ blocks: entries }); } catch { rejected = true; }
    assert(rejected, `Validator mutation survived: ${name}`); selfTests.push(name);
  }
  assert(recipeSignature({ kind: 'shaped', shape: [['a', 'a'], ['a', 'b'], [null, 'b']], output: { id: 'c', count: 1 } }) === recipeSignature({ kind: 'shaped', shape: [['a', 'a'], ['b', 'a'], ['b', null]], output: { id: 'c', count: 1 } }), 'Mirrored recipes must normalize equally');
  assert(recipeSignature({ kind: 'shapeless', ingredients: ['a', 'b'], output: { id: 'c', count: 1 } }) !== recipeSignature({ kind: 'shapeless', ingredients: ['a', 'b', 'b'], output: { id: 'c', count: 1 } }), 'Recipe input multiplicity must matter');
  selfTests.push('recipe mirror equivalence', 'recipe ingredient multiplicity');
  assert(canonical('gold_pickaxe') === 'minecraft:golden_pickaxe' && canonical('gold_chestplate') === 'minecraft:golden_chestplate' && canonical('gold_block') === 'minecraft:gold_block' && canonical('gold_ingot') === 'minecraft:gold_ingot', 'Gold equipment aliases must not rename gold materials');
  selfTests.push('gold equipment aliases preserve material IDs');
}

const countBy = (entries, callback) => Object.fromEntries([...new Set(entries.map(callback))].sort().map((key) => [key, entries.filter((entry) => callback(entry) === key).length]));
const index = {
  schemaVersion: 1, target: lock.target, sourceCommit: lock.upstream.commit,
  sourceAuthority: 'Third-party curated data. Counts prove faithful enumeration of pinned files only, not Mojang official completeness or functional parity.',
  generatedBy: 'node scripts/build-parity-catalog.mjs', deterministic: true,
  localSourceSnapshot: Object.fromEntries(Object.entries(localSources).sort()),
  totals: { ...validation, acceptedEntries: 0, missingDomains: gaps.length },
  behaviorBacklog: { file: 'behavior-cases.json', count: behaviorCases.length, acceptedCases: 0, sourceSha256: hash(behaviorText) },
  domains: Object.fromEntries(Object.entries(catalog).map(([domain, entries]) => [domain, {
    file: `catalogs/${domain}.json`, count: entries.length,
    referenceCoverage: 'all-records-in-pinned-third-party-file', mappedVersion: lock.files[domain].mappedVersion,
    stageCounts: countBy(entries, (entry) => entry.stage), implementationCounts: countBy(entries, (entry) => entry.implementation.status), acceptancePassed: 0,
  }])),
  missing: gaps,
};
const localEvidence = {
  sourceSnapshot: index.localSourceSnapshot,
  statusRule: 'Definition matches and existing test names are leads, not executed per-entry acceptance. No acceptance is promoted by this generator.',
  aliases, cropAliases: cropNames, composterAlias: 'composter_1..composter_8 -> minecraft:composter; state acceptance remains unverified',
  counts: { blocks: Object.keys(BLOCKS).length, items: Object.keys(ITEMS).length, entities: Object.keys(ENTITIES).length, craftingRecipes: RECIPES.length, smeltingRecipes: Object.keys(SMELTING).length },
  unmatchedLocal, craftingRecipes: localRecipes, smeltingRecipes: localSmelting,
  localRecipeLinks: localRecipes.map((recipe) => ({ id: recipe.id, exactSourceRecords: catalog.recipes.filter((entry) => entry.implementation.localRecipes.includes(recipe.id)).map((entry) => entry.id), acceptance: 'not-run' })),
  candidateTestFiles: ['tests/rules.test.ts', 'tests/simulation.test.ts', 'tests/survival-systems.test.ts', 'tests/engine.test.ts', 'tests/engine-world.test.ts', 'tests/storage.test.ts'],
  candidateTestRule: 'Locate relevant cases in these files; file existence does not certify any catalog row. Agriculture additions in this snapshot remain unverified.',
};
const outputs = new Map([
  ['index.json', json(index)], ['local-evidence.json', json(localEvidence)],
  ['behavior-cases.json', json(behaviorCases)],
  ...Object.entries(catalog).map(([domain, entries]) => [`catalogs/${domain}.json`, json(entries)]),
]);
for (const [file, content] of outputs) {
  if (args.has('--check')) {
    const existing = await fs.readFile(path.join(directory, file), 'utf8').catch(() => null);
    assert(existing === content, `Stale/missing catalog: docs/parity/${file}. Re-run node scripts/build-parity-catalog.mjs`);
  } else {
    await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await fs.writeFile(path.join(directory, file), content);
  }
}
console.log(json({ status: args.has('--check') ? 'checked' : 'generated', target: 'Java 1.21.1', sourceCommit: lock.upstream.commit, domains: Object.fromEntries(Object.entries(catalog).map(([domain, entries]) => [domain, entries.length])), ...validation, acceptedEntries: 0, missingDomains: gaps.length, behaviorCases: behaviorCases.length, selfTests }));
