import type { FarmState } from "./farming";
export type Vec3 = { x: number; y: number; z: number };
export type GameMode = "survival" | "creative";
export type ItemStack = { id: string; count: number; durability?: number };
export type Slot = ItemStack | null;
export type ArmorSlot = "head" | "chest" | "legs" | "feet";
export interface PlayerState {
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  health: number;
  hunger: number;
  oxygen: number;
  inventory: Slot[];
  armor: Record<ArmorSlot, Slot>;
  selected: number;
  spawn: Vec3;
  bedSpawn?: Vec3;
  dead: boolean;
  flying: boolean;
}
export type EntityKind = "pig" | "sheep" | "zombie" | "creeper";
export interface EntityState {
  id: string;
  kind: EntityKind;
  position: Vec3;
  health: number;
  yaw: number;
  timer: number;
  fuse?: number;
  /** Seconds until adulthood (negative), love and breeding cooldown. */
  age?: number;
  love?: number;
  breedCooldown?: number;
  courtship?: number;
  sheared?: boolean;
  woolTimer?: number;
}
export interface DropState {
  id: string;
  stack: ItemStack;
  position: Vec3;
  age: number;
}
export interface BlockChange extends Vec3 {
  id: number;
}
export type ContainerState =
  | { kind: "chest"; slots: Slot[] }
  | {
      kind: "furnace";
      slots: Slot[];
      burn: number;
      burnTotal: number;
      progress: number;
    };
export interface SaveManifest {
  version: 1 | 2;
  generatorVersion: 1 | 2;
  id: string;
  name: string;
  seed: string;
  mode: GameMode;
  createdAt: number;
  updatedAt: number;
  playedSeconds: number;
}
export interface SaveData {
  manifest: SaveManifest;
  player: PlayerState;
  changes: BlockChange[];
  containers: Record<string, ContainerState>;
  entities: EntityState[];
  drops: DropState[];
  time: number;
  farming?: FarmState;
}
export interface Settings {
  renderDistance: number;
  volume: number;
  sensitivity: number;
  fov: number;
  quality: "low" | "medium" | "high";
}
export interface BlockDefinition {
  id: number;
  key: string;
  name: string;
  solid: boolean;
  opaque: boolean;
  hardness: number;
  texture: number;
  topTexture?: number;
  bottomTexture?: number;
  drop?: string;
  tool?: "pickaxe" | "axe" | "shovel";
  tier?: number;
  shape?: "cube" | "slab" | "door" | "ladder" | "torch" | "bed" | "crop" | "farmland";
}
export interface ItemDefinition {
  id: string;
  name: string;
  category: "building" | "tools" | "materials" | "food";
  maxStack: number;
  block?: number;
  texture?: number;
  color?: string;
  tool?: "pickaxe" | "axe" | "shovel" | "sword" | "hoe";
  tier?: number;
  maxDurability?: number;
  damage?: number;
  food?: number;
  foodRemainder?: string;
  fuel?: number;
  armorSlot?: ArmorSlot;
  armorPoints?: number;
}
export interface RecipeDefinition {
  id: string;
  name: string;
  pattern?: string[];
  keys?: Record<string, string>;
  ingredients?: Record<string, number>;
  output: ItemStack;
  station: "inventory" | "workbench";
}
export interface EntityDefinition {
  kind: EntityKind;
  name: string;
  health: number;
  speed: number;
  hostile: boolean;
  drops: ItemStack[];
}
export interface WorldPort {
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, id: number): void;
  isReady(x: number, z: number): boolean;
  getSurface(x: number, z: number): number;
  getChanges(): BlockChange[];
}
export type GameCommand =
  | { type: "select"; index: number }
  | { type: "attack" }
  | { type: "interact" }
  | { type: "drop" }
  | { type: "respawn" }
  | { type: "craft"; recipeId: string }
  | { type: "setTime"; time: number };
export interface WorldEvent {
  type: "sound" | "toast" | "inventory" | "damage" | "block";
  message?: string;
  sound?: string;
}
export interface GameSnapshot {
  manifest: SaveManifest;
  player: PlayerState;
  time: number;
  target: { name: string; position: Vec3 } | null;
  mining: number;
  saveStatus: "saved" | "saving" | "error" | "dirty";
  message: string;
  fps: number;
  chunks: number;
  ready: boolean;
}
export type Overlay =
  | null
  | "pause"
  | "inventory"
  | "workbench"
  | "chest"
  | "furnace"
  | "death"
  | "settings";
export interface GameUIBridge {
  getSnapshot(): GameSnapshot;
  subscribe(listener: () => void): () => void;
  command(command: GameCommand): void;
  setPaused(paused: boolean): void;
  requestPointerLock(): Promise<void>;
  startMouseFallback(): void;
  openInventory(station?: "inventory" | "workbench"): void;
  getCraftSlots(): Slot[];
  getContainer(): ContainerState | null;
  clickSlot(
    source: "inventory" | "craft" | "container" | "armor",
    index: number | string,
    right?: boolean,
    shift?: boolean,
  ): void;
  getCursor(): Slot;
  takeCraftOutput(): void;
  getCraftOutput(): Slot;
  giveItem(id: string): void;
  getRecipes(): RecipeDefinition[];
  save(): Promise<void>;
  exportCheckpoint(): void;
  dispose(): void;
  updateSettings(settings: Settings): void;
  onOverlay?: (overlay: Overlay) => void;
}
