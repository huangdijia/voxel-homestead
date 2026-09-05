import * as THREE from "three";
import type {
  ContainerState,
  EnchantingView,
  WorkshopView,
  GameCommand,
  GameSnapshot,
  GameUIBridge,
  Overlay,
  RecipeDefinition,
  SaveData,
  Settings,
  Slot,
  Vec3,
  WorldEvent,
} from "./types";
import { VoxelWorld } from "../engine/world";
import { selectionBoxes, progressionBlockParts } from "../engine/shapes";
import { Simulation, createNewSave } from "./Simulation";
import { GameAudio } from "./audio";
import { EntityRenderer } from "./EntityRenderer";
import { BLOCKS, ITEMS } from "./registry";
import { mineralAppearance } from "./mineral-appearance";
import { downloadSave, saveWorld } from "./storage";
import { CheckpointWriter } from "./checkpoint-writer";
import { RECIPES } from "./recipes";

export const DEFAULT_SETTINGS: Settings = {
  renderDistance: 6,
  volume: 0.45,
  sensitivity: 1,
  fov: 75,
  quality: "medium",
};
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

function createRenderer(canvas: HTMLCanvasElement, settings: Settings) {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance",
    });
  } catch {
    throw new Error(
      "这个浏览器暂时无法启动 WebGL2。请打开硬件加速，或使用新版 Chrome / Edge / Safari。",
    );
  }
  renderer.setPixelRatio(
    settings.quality === "high"
      ? Math.min(window.devicePixelRatio, 2)
      : settings.quality === "low"
        ? 0.75
        : 1,
  );
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  return renderer;
}
function createSky(scene: THREE.Scene) {
  const ambient = new THREE.HemisphereLight(0xe3f3ff, 0x8a876b, 2.25);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.65);
  sun.position.set(70, 120, 40);
  scene.add(sun);
  const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xfff3c5 });
  const sunMesh = new THREE.Mesh(new THREE.BoxGeometry(9, 9, 1), sunMaterial);
  scene.add(sunMesh);
  const moonMaterial = new THREE.MeshBasicMaterial({ color: 0xe2edfa });
  const moon = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 1), moonMaterial);
  scene.add(moon);
  const clouds = new THREE.Group(),
    cloudMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.86,
    });
  const cloudGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 28; i++) {
    const m = new THREE.Mesh(cloudGeo, cloudMaterial);
    m.position.set(
      ((i * 37) % 240) - 120,
      65 + (i % 3) * 3,
      ((i * 71) % 240) - 120,
    );
    m.scale.set(12 + (i % 4) * 7, 1.5 + (i % 2), 5 + (i % 3) * 4);
    clouds.add(m);
  }
  scene.add(clouds);
  return {
    ambient,
    sun,
    sunMesh,
    moon,
    clouds,
    dispose() {
      sunMesh.geometry.dispose();
      moon.geometry.dispose();
      sunMaterial.dispose();
      moonMaterial.dispose();
      cloudGeo.dispose();
      cloudMaterial.dispose();
    },
  };
}

export class Game implements GameUIBridge {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly world: VoxelWorld;
  readonly simulation: Simulation;
  private entityRenderer: EntityRenderer;
  private audio = new GameAudio();
  private sky: ReturnType<typeof createSky>;
  private listeners = new Set<() => void>();
  private snapshotValue: GameSnapshot;
  private keys = new Set<string>();
  private paused = true;
  private overlay: Overlay = "pause";
  private primary = false;
  private mouseFallback = false;
  private rightDrag = 0;
  private rightHeld = false;
  private disposed = false;
  private controlEpoch = 0;
  private fullscreenTarget: HTMLElement | null = null;
  private fullscreenOwned = false;
  private fullscreenWanted = false;
  private raf = 0;
  private last = 0;
  private accumulator = 0;
  private previousEye: Vec3 | null = null;
  private elapsed = 0;
  private notifyTimer = 0;
  private streamTimer = 0;
  private autoSaveTimer = 0;
  private saveStatus: GameSnapshot["saveStatus"] = "saved";
  private checkpointWriter = new CheckpointWriter<SaveData>(saveWorld);
  private saveGeneration = 0;
  private message = "点击画面，开始你的方块旅程";
  private messageExpiry = 0;
  private jumpTime = 0;
  private handSwing = 0;
  private hitDelay = 0;
  private fps = 60;
  private frames: number[] = [];
  private loadingStart = performance.now();
  private resizeObserver: ResizeObserver;
  private cleanup: (() => void)[] = [];
  private settings: Settings;
  private selection: THREE.LineSegments;
  private hand = new THREE.Group();
  private handId = "";
  private handMaterials: THREE.Material[] = [];
  private handGeometry = new THREE.BoxGeometry(1, 1, 1);
  private fog = new THREE.Fog(0xa7cfe0, 45, 110);
  onOverlay?: (overlay: Overlay) => void;
  constructor(
    private canvas: HTMLCanvasElement,
    data: SaveData,
    settings: Settings,
  ) {
    this.settings = { ...settings };
    this.renderer = createRenderer(canvas, settings);
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 280);
    this.camera.rotation.order = "YXZ";
    this.scene.background = new THREE.Color(0xa9d5eb);
    this.scene.fog = this.fog;
    this.sky = createSky(this.scene);
    this.world = new VoxelWorld(
      this.scene,
      data.manifest.seed,
      data.changes,
      data.manifest.id,
      data.manifest.generatorVersion,
    );
    this.simulation = new Simulation(this.world, data, (e) =>
      this.handleEvent(e),
    );
    this.simulation.onOpen = (o) => this.showOverlay(o);
    this.entityRenderer = new EntityRenderer(this.scene);
    this.audio.volume = settings.volume;
    this.selection = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({
        color: 0x19281b,
        transparent: true,
        opacity: 0.85,
      }),
    );
    this.scene.add(this.selection);
    this.camera.add(this.hand);
    this.scene.add(this.camera);
    this.snapshotValue = this.buildSnapshot();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.listen(document, "keydown", this.keyDown as EventListener);
    this.listen(document, "keyup", ((e: KeyboardEvent) => {
      this.keys.delete(e.code);
    }) as EventListener);
    this.listen(document, "mousemove", this.mouseMove as EventListener);
    this.listen(canvas, "mousedown", this.mouseDown as EventListener);
    this.listen(document, "mouseup", ((e: MouseEvent) => {
      if (e.button === 0) {
        this.primary = false;
        this.simulation.mining = 0;
      }
      if (e.button === 2 && this.mouseFallback) {
        if (this.rightHeld && this.rightDrag < 4 && !this.paused) {
          this.simulation.interact();
          this.handSwing = 1;
          this.publish();
        }
        this.rightHeld = false;
      }
    }) as EventListener);
    this.listen(canvas, "contextmenu", (e: Event) => e.preventDefault());
    this.listen(
      canvas,
      "wheel",
      ((e: WheelEvent) => {
        if (!this.paused) {
          e.preventDefault();
          this.command({
            type: "select",
            index:
              (this.simulation.player.selected + (e.deltaY > 0 ? 1 : 8)) % 9,
          });
        }
      }) as EventListener,
      { passive: false },
    );
    this.listen(document, "pointerlockchange", (() => {
      if (document.pointerLockElement !== canvas && !this.paused)
        this.showOverlay("pause");
    }) as EventListener);
    this.listen(document, "fullscreenchange", () => this.fullscreenChanged());
    this.listen(window, "blur", (() => {
      if (this.overlay !== "pause" && this.overlay !== "death")
        this.showOverlay("pause");
    }) as EventListener);
    this.listen(document, "visibilitychange", (() => {
      if (document.hidden && this.overlay !== "pause") {
        this.showOverlay("pause");
        void this.save().catch(() => {});
      }
    }) as EventListener);
    this.listen(canvas, "webglcontextlost", ((e: Event) => {
      e.preventDefault();
      this.showOverlay("pause");
      this.message = "图形连接中断。请保存世界后刷新页面。";
      this.messageExpiry = Infinity;
      this.publish();
    }) as EventListener);
    this.raf = requestAnimationFrame(this.frame);
    if (import.meta.env.DEV)
      (window as unknown as { __voxelGame?: Game }).__voxelGame = this;
  }
  private listen(
    target: EventTarget,
    event: string,
    fn: EventListener,
    options?: AddEventListenerOptions,
  ) {
    target.addEventListener(event, fn, options);
    this.cleanup.push(() => target.removeEventListener(event, fn, options));
  }
  private resize() {
    const width = this.canvas.clientWidth || window.innerWidth,
      height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
  private handleEvent(event: WorldEvent) {
    if (event.sound) this.audio.play(event.sound);
    if (event.message) {
      this.message = event.message;
      this.messageExpiry = this.elapsed + 5;
    }
    if (event.type === "damage") {
      this.canvas.classList.add("hurt-flash");
      setTimeout(() => this.canvas.classList.remove("hurt-flash"), 300);
    }
    this.publish();
  }
  private keyDown = (e: KeyboardEvent) => {
    if (
      (e.target as HTMLElement)?.matches("input,textarea,select") &&
      e.code !== "Escape"
    )
      return;
    if (e.code === "Escape") {
      if (
        !this.paused ||
        [
          "inventory",
          "workbench",
          "chest",
          "furnace",
          "enchanting",
          "anvil",
          "grindstone",
        ].includes(this.overlay ?? "")
      ) {
        e.preventDefault();
        e.stopPropagation();
        this.simulation.closeContainer();
        this.showOverlay("pause");
      }
      return;
    }
    if (e.code === "KeyE" && !e.repeat) {
      if (!this.paused) {
        e.preventDefault();
        e.stopPropagation();
        this.openInventory();
      }
      return;
    }
    if (this.paused) return;
    if (
      [
        "Space",
        "Tab",
        "KeyW",
        "KeyA",
        "KeyS",
        "KeyD",
        "ShiftLeft",
        "ShiftRight",
        "ControlLeft",
        "ControlRight",
      ].includes(e.code)
    )
      e.preventDefault();
    if (e.code === "Space" && !e.repeat) {
      const now = performance.now();
      if (this.simulation.creative && now - this.jumpTime < 300)
        this.simulation.player.flying = !this.simulation.player.flying;
      this.jumpTime = now;
    }
    if (e.code.startsWith("Digit")) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 9) this.command({ type: "select", index: n - 1 });
    }
    if (e.code === "KeyQ" && !e.repeat) this.command({ type: "drop" });
    if (e.code === "KeyF" && !e.repeat && this.simulation.creative) {
      this.simulation.player.flying = !this.simulation.player.flying;
      this.publish();
    }
    this.keys.add(e.code);
  };
  private mouseMove = (e: MouseEvent) => {
    if (this.paused) return;
    if (this.mouseFallback) {
      if (!this.rightHeld) return;
      this.rightDrag += Math.abs(e.movementX) + Math.abs(e.movementY);
    } else if (document.pointerLockElement !== this.canvas) return;
    const p = this.simulation.player;
    p.yaw -= e.movementX * 0.002 * this.settings.sensitivity;
    p.pitch = clamp(
      p.pitch - e.movementY * 0.002 * this.settings.sensitivity,
      -Math.PI / 2 + 0.01,
      Math.PI / 2 - 0.01,
    );
  };
  private mouseDown = (e: MouseEvent) => {
    if (this.paused) return;
    if (!this.mouseFallback && document.pointerLockElement !== this.canvas) {
      void this.requestPointerLock().catch(() => {});
      return;
    }
    this.audio.unlock();
    if (e.button === 0) {
      this.primary = true;
      this.handSwing = 1;
      if (this.simulation.attack()) this.hitDelay = 0.45;
    }
    if (e.button === 2 && this.mouseFallback) {
      this.rightHeld = true;
      this.rightDrag = 0;
      return;
    }
    if (e.button === 2) {
      this.simulation.interact();
      this.handSwing = 1;
      this.publish();
    }
  };
  private frame = (now: number) => {
    if (this.disposed) return;
    const rawDt = this.last ? (now - this.last) / 1000 : 0,
      dt = Math.min(0.1, rawDt);
    this.last = now;
    this.elapsed += dt;
    if (rawDt > 0) {
      this.fps = this.fps * 0.94 + (1 / rawDt) * 0.06;
      this.frames.push(rawDt * 1000);
      if (this.frames.length > 54000) this.frames.shift();
    }
    const sim = this.simulation;
    this.streamTimer += dt;
    if (this.streamTimer > 0.12 || !this.world.ready) {
      this.world.update(sim.player.position, this.settings.renderDistance);
      this.streamTimer = 0;
    }
    const inventoryOpen = [
      "inventory",
      "workbench",
      "chest",
      "furnace",
      "enchanting",
      "anvil",
      "grindstone",
    ].includes(this.overlay ?? "");
    if ((!this.paused || inventoryOpen) && this.world.ready) {
      this.accumulator = Math.min(0.12, this.accumulator + dt);
      while (this.accumulator >= 1 / 60) {
        this.previousEye = sim.eye();
        sim.step(1 / 60, {
          forward:
            Number(this.keys.has("KeyW")) - Number(this.keys.has("KeyS")),
          right: Number(this.keys.has("KeyD")) - Number(this.keys.has("KeyA")),
          jump: this.keys.has("Space"),
          sneak: this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"),
          sprint: this.keys.has("ControlLeft") || this.keys.has("ControlRight"),
        });
        this.accumulator -= 1 / 60;
      }
      this.hitDelay = Math.max(0, this.hitDelay - dt);
      if (!this.paused && this.primary && this.hitDelay <= 0) {
        if (sim.attack()) {
          this.hitDelay = 0.45;
          this.handSwing = 1;
        } else {
          sim.mine(dt);
          this.handSwing = Math.max(this.handSwing, 0.3);
        }
      }
      if (sim.player.dead && this.overlay !== "death")
        this.showOverlay("death");
      this.autoSaveTimer += dt;
      if (this.autoSaveTimer >= 5) {
        this.autoSaveTimer = 0;
        void this.save().catch(() => {});
      }
      if (this.saveStatus === "saved") this.saveStatus = "dirty";
    } else this.accumulator = 0;
    this.updateVisuals(dt);
    this.renderer.render(this.scene, this.camera);
    this.notifyTimer += dt;
    if (this.notifyTimer > 0.1) {
      this.notifyTimer = 0;
      this.publish();
    }
    this.raf = requestAnimationFrame(this.frame);
  };
  private updateVisuals(dt: number) {
    const sim = this.simulation,
      p = sim.player,
      eye = sim.eye();
    const previous = this.previousEye;
    const alpha = clamp(this.accumulator * 60, 0, 1);
    if (
      !this.paused &&
      previous &&
      Math.hypot(eye.x - previous.x, eye.y - previous.y, eye.z - previous.z) < 3
    ) {
      this.camera.position.set(
        previous.x + (eye.x - previous.x) * alpha,
        previous.y + (eye.y - previous.y) * alpha,
        previous.z + (eye.z - previous.z) * alpha,
      );
    } else this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(p.pitch, p.yaw, 0, "YXZ");
    const day = Math.max(
      0,
      Math.min(1, (Math.sin((sim.time / 24000) * Math.PI * 2) + 0.2) * 1.8),
    );
    const skyColor = new THREE.Color(0x13223d).lerp(
      new THREE.Color(0xa8d6ec),
      day,
    );
    (this.scene.background as THREE.Color).copy(skyColor);
    this.fog.color.copy(skyColor);
    this.fog.near = this.settings.renderDistance * 9;
    this.fog.far = this.settings.renderDistance * 16 - 2;
    this.sky.ambient.intensity = 0.27 + day * 1.65;
    this.sky.sun.intensity = 0.1 + day * 1.5;
    const angle = (sim.time / 24000) * Math.PI * 2;
    this.sky.sun.position.set(
      p.position.x + Math.cos(angle) * 90,
      p.position.y + Math.sin(angle) * 110,
      p.position.z - 60,
    );
    this.sky.sun.target.position.set(p.position.x, p.position.y, p.position.z);
    this.sky.sun.target.updateMatrixWorld();
    this.sky.sunMesh.position.set(
      p.position.x + Math.cos(angle) * 120,
      p.position.y + Math.sin(angle) * 120,
      p.position.z - 100,
    );
    this.sky.sunMesh.lookAt(this.camera.position);
    this.sky.sunMesh.visible = day > 0.1;
    this.sky.moon.position.set(
      p.position.x - Math.cos(angle) * 120,
      p.position.y - Math.sin(angle) * 120,
      p.position.z - 100,
    );
    this.sky.moon.lookAt(this.camera.position);
    this.sky.moon.visible = day < 0.4;
    this.sky.clouds.position.set(
      Math.floor(p.position.x / 200) * 200 +
        Math.sin(this.elapsed * 0.002) * 10,
      sim.manifest.generatorVersion >= 5 ? 192 - 65 : 0,
      Math.floor(p.position.z / 200) * 200,
    );
    this.sky.clouds.visible = this.settings.quality !== "low";
    const t = sim.target();
    this.selection.visible = !!t && !this.paused && t.id !== 6;
    if (t) {
      const boxes = selectionBoxes(t.id);
      const min = [0, 1, 2].map((axis) =>
        Math.min(...boxes.map((box) => box[axis])),
      );
      const max = [3, 4, 5].map((axis) =>
        Math.max(...boxes.map((box) => box[axis])),
      );
      this.selection.position.set(
        t.position.x + (min[0] + max[0]) / 2,
        t.position.y + (min[1] + max[1]) / 2,
        t.position.z + (min[2] + max[2]) / 2,
      );
      this.selection.scale.set(
        max[0] - min[0],
        max[1] - min[1],
        max[2] - min[2],
      );
    }
    this.entityRenderer.update(
      sim.entities,
      sim.drops,
      p.position,
      this.elapsed,
      sim.progression.orbs,
    );
    this.updateHand(dt);
  }
  private updateHand(dt: number) {
    const sim = this.simulation,
      held = sim.held,
      id = held?.id ?? "empty",
      enchanted =
        !!held?.enchantments &&
        Object.values(held.enchantments).some((level) => level > 0),
      appearanceId = id + (enchanted ? ":enchanted" : "");
    if (appearanceId !== this.handId) {
      this.handId = appearanceId;
      this.hand.clear();
      this.hand.rotation.set(0, 0, 0);
      this.handMaterials.forEach((m) => m.dispose());
      this.handMaterials = [];
      const add = (
        color: number,
        x: number,
        y: number,
        z: number,
        sx: number,
        sy: number,
        sz: number,
      ) => {
        const mat = new THREE.MeshLambertMaterial({ color, depthTest: false });
        this.handMaterials.push(mat);
        const box = new THREE.Mesh(this.handGeometry, mat);
        box.position.set(x, y, z);
        box.scale.set(sx, sy, sz);
        box.renderOrder = 100;
        this.hand.add(box);
      };
      const item = held ? ITEMS[held.id] : null;
      if (item?.tool) {
        const metal = new THREE.Color(item.color ?? "#b9945a").getHex();
        add(0x997247, 0, 0, 0, 0.055, 0.39, 0.055);
        if (item.tool === "sword") add(metal, 0, 0.29, 0, 0.08, 0.34, 0.035);
        else if (item.tool === "pickaxe")
          add(metal, 0, 0.24, 0, 0.33, 0.075, 0.055);
        else if (item.tool === "axe") {
          add(metal, 0.08, 0.2, 0, 0.18, 0.18, 0.06);
        } else if (item.tool === "hoe") {
          add(metal, 0.06, 0.23, 0, 0.19, 0.07, 0.055);
          add(metal, 0.14, 0.18, 0, 0.055, 0.11, 0.055);
        } else add(metal, 0, 0.22, 0, 0.14, 0.17, 0.055);
        this.hand.rotation.z = -0.4;
      } else if (
        item?.block !== undefined &&
        progressionBlockParts(item.block).length
      ) {
        const materials = new Map<string, THREE.MeshLambertMaterial>();
        for (const part of progressionBlockParts(item.block)) {
          const key = `${part.tile}:${part.tint.join(",")}`;
          let material = materials.get(key);
          if (!material) {
            material = new THREE.MeshLambertMaterial({
              map: atlasTile(part.tile),
              color: new THREE.Color(...part.tint),
              depthTest: false,
            });
            materials.set(key, material);
            this.handMaterials.push(material);
          }
          const mesh = new THREE.Mesh(this.handGeometry, material),
            b = part.box;
          mesh.position.set(
            ((b[0] + b[3]) / 2 - 0.5) * 0.32,
            ((b[1] + b[4]) / 2 - 0.5) * 0.32,
            ((b[2] + b[5]) / 2 - 0.5) * 0.32,
          );
          mesh.scale.set(
            (b[3] - b[0]) * 0.32,
            (b[4] - b[1]) * 0.32,
            (b[5] - b[2]) * 0.32,
          );
          mesh.renderOrder = 100;
          this.hand.add(mesh);
        }
        this.hand.rotation.set(0.12, 0.4, -0.16);
      } else if (item?.block !== undefined) {
        const block = BLOCKS[item.block],
          mineral = mineralAppearance(item.block);
        const mat = new THREE.MeshLambertMaterial({
          map: atlasTile(mineral?.tile ?? block?.texture ?? 0),
          color: mineral ? new THREE.Color(...mineral.base) : 0xffffff,
          depthTest: false,
        });
        this.handMaterials.push(mat);
        const mesh = new THREE.Mesh(this.handGeometry, mat);
        mesh.scale.setScalar(0.25);
        mesh.renderOrder = 100;
        this.hand.add(mesh);
        if (mineral) {
          // One additional mesh for all crystal details, sharing the same atlas
          // and palette as terrain. Single-sided quads cannot show back-face
          // grains through the block even though the hand ignores world depth.
          const positions: number[] = [],
            normals: number[] = [],
            uvs: number[] = [],
            colors: number[] = [],
            indices: number[] = [];
          const source = this.handGeometry.getAttribute("position"),
            sourceNormals = this.handGeometry.getAttribute("normal"),
            sourceIndices = this.handGeometry.index!;
          const patch = (
            face: number,
            u: number,
            v: number,
            width: number,
            height: number,
            tint: number[],
            lift = 0.0015,
          ) => {
            const first = face * 4,
              base = positions.length / 3;
            const p0 = new THREE.Vector3().fromBufferAttribute(source, first),
              alongU = new THREE.Vector3()
                .fromBufferAttribute(source, first + 1)
                .sub(p0),
              alongV = new THREE.Vector3()
                .fromBufferAttribute(source, first + 2)
                .sub(p0),
              normal = new THREE.Vector3().fromBufferAttribute(
                sourceNormals,
                first,
              );
            for (const [pu, pv] of [
              [u, v],
              [u + width, v],
              [u, v + height],
              [u + width, v + height],
            ]) {
              const point = p0
                .clone()
                .addScaledVector(alongU, pu)
                .addScaledVector(alongV, pv)
                .addScaledVector(normal, lift);
              positions.push(point.x, point.y, point.z);
              normals.push(normal.x, normal.y, normal.z);
              uvs.push(pu, 1 - pv);
              colors.push(...tint);
            }
            for (let index = face * 6; index < face * 6 + 6; index++)
              indices.push(base + sourceIndices.getX(index) - first);
          };
          for (let face = 0; face < 6; face++) {
            if (mineral.kind === "ore" || mineral.kind === "raw") {
              for (const [u, v, w, h] of mineral.kind === "raw"
                ? [
                    [0.05, 0.08, 0.39, 0.31],
                    [0.53, 0.14, 0.39, 0.4],
                    [0.19, 0.52, 0.34, 0.39],
                    [0.65, 0.67, 0.26, 0.26],
                  ]
                : [
                    [0.14, 0.16, 0.18, 0.12],
                    [0.58, 0.3, 0.18, 0.21],
                    [0.31, 0.64, 0.26, 0.12],
                    [0.73, 0.73, 0.1, 0.12],
                  ]) {
                patch(face, u, v, w, h, mineral.grain);
                patch(
                  face,
                  u + w * 0.18,
                  v + h * 0.58,
                  w * 0.6,
                  h * 0.42,
                  mineral.highlight,
                  0.0025,
                );
              }
            } else if (mineral.kind === "slate") {
              patch(face, 0, 0.25, 1, 0.055, mineral.grain);
              patch(face, 0.22, 0.69, 0.78, 0.055, mineral.grain);
            } else {
              patch(face, 0.08, 0.08, 0.84, 0.84, mineral.grain);
              patch(face, 0.08, 0.84, 0.84, 0.08, mineral.highlight, 0.0025);
              patch(face, 0.08, 0.15, 0.07, 0.69, mineral.highlight, 0.0025);
              patch(face, 0.66, 0.22, 0.14, 0.09, mineral.highlight, 0.0025);
            }
          }
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(positions, 3),
          );
          geometry.setAttribute(
            "normal",
            new THREE.Float32BufferAttribute(normals, 3),
          );
          geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
          geometry.setAttribute(
            "color",
            new THREE.Float32BufferAttribute(colors, 3),
          );
          geometry.setIndex(indices);
          const details = new THREE.MeshLambertMaterial({
            map: atlasTile(15),
            vertexColors: true,
            depthTest: false,
          });
          // Both item switches and Game.dispose already dispose handMaterials.
          details.addEventListener("dispose", () => geometry.dispose());
          this.handMaterials.push(details);
          const crystals = new THREE.Mesh(geometry, details);
          crystals.scale.setScalar(0.25);
          crystals.renderOrder = 101;
          this.hand.add(crystals);
        }
        this.hand.rotation.set(0.1, -0.5, 0.1);
      } else if (item) {
        add(
          Number.parseInt((item.color ?? "#c9ad75").slice(1), 16),
          0,
          0,
          0,
          0.14,
          0.23,
          0.055,
        );
        this.hand.rotation.z = -0.35;
      } else {
        add(0xba8d70, 0, 0.03, 0, 0.17, 0.3, 0.17);
        add(0x657a57, 0, -0.2, 0, 0.18, 0.22, 0.18);
        this.hand.rotation.z = -0.28;
      }
    }
    for (const material of this.handMaterials)
      if (material instanceof THREE.MeshLambertMaterial) {
        material.emissive.setHex(enchanted ? 0x542478 : 0x000000);
        material.emissiveIntensity = enchanted
          ? 0.2 + (Math.sin(this.elapsed * 2.4) + 1) * 0.12
          : 0;
      }
    this.handSwing = Math.max(0, this.handSwing - dt * 4);
    const moving =
      !this.paused &&
      Math.abs(sim.player.velocity.x) + Math.abs(sim.player.velocity.z) > 0;
    this.hand.position.set(
      0.37 - Math.sin(this.handSwing * Math.PI) * 0.15,
      -0.3 -
        Math.sin(this.handSwing * Math.PI) * 0.09 +
        (moving ? Math.sin(this.elapsed * 9) * 0.015 : 0),
      -0.58,
    );
    this.hand.visible = !this.paused && !sim.player.dead;
  }
  private buildSnapshot(): GameSnapshot {
    const sim = this.simulation,
      t = sim.target();
    return {
      progression: { points: sim.progression.points },
      manifest: { ...sim.manifest },
      player: structuredClone(sim.player),
      time: sim.time,
      target: t
        ? { name: BLOCKS[t.id]?.name ?? "方块", position: { ...t.position } }
        : null,
      mining: sim.mining,
      saveStatus: this.saveStatus,
      message:
        this.elapsed < this.messageExpiry || this.messageExpiry === 0
          ? this.message
          : "",
      fps: Math.round(this.fps),
      chunks: this.world.stats.chunks,
      ready: this.world.ready,
    };
  }
  private publish() {
    if (this.disposed) return;
    this.snapshotValue = this.buildSnapshot();
    this.listeners.forEach((fn) => fn());
  }
  getSnapshot = () => this.snapshotValue;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  command(command: GameCommand) {
    const sim = this.simulation;
    switch (command.type) {
      case "select":
        sim.player.selected = clamp(Math.floor(command.index), 0, 8);
        this.audio.play("equip");
        break;
      case "attack":
        sim.attack();
        break;
      case "interact":
        sim.interact();
        break;
      case "drop":
        sim.dropSelected();
        break;
      case "respawn":
        sim.respawn();
        this.setPaused(true);
        break;
      case "craft":
        sim.craft(command.recipeId);
        break;
      case "enchant":
        sim.enchant(command.option);
        break;
      case "workshopName":
        sim.setWorkshopName(command.name);
        break;
      case "takeWorkshopOutput":
        sim.takeWorkshopOutput(command.shift ?? false);
        break;
      case "setTime":
        if (sim.creative) sim.time = ((command.time % 24000) + 24000) % 24000;
        break;
    }
    this.publish();
  }
  private showOverlay(overlay: Overlay) {
    this.controlEpoch++;
    this.overlay = overlay;
    this.paused = overlay !== null;
    this.keys.clear();
    this.primary = false;
    this.simulation.mining = 0;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    if (overlay === "pause" || overlay === "death" || overlay === "settings")
      this.exitGameFullscreen();
    this.onOverlay?.(overlay);
    this.publish();
  }
  setPaused(paused: boolean) {
    if (paused) {
      this.controlEpoch++;
      this.exitGameFullscreen();
      if (document.pointerLockElement === this.canvas)
        document.exitPointerLock();
    }
    if (!paused) {
      this.simulation.closeContainer();
      this.overlay = null;
    }
    this.paused = paused;
    this.keys.clear();
    this.primary = false;
    this.accumulator = 0;
    this.publish();
  }
  /** The app container includes the HUD and overlays, unlike a fullscreen canvas. */
  private requestGameFullscreen(): Promise<string | null> {
    const target =
      this.canvas.closest<HTMLElement>(".app") ?? document.documentElement;
    this.fullscreenTarget = target;
    this.fullscreenWanted = true;
    if (document.fullscreenElement === target) {
      this.fullscreenOwned = true;
      return Promise.resolve(null);
    }
    const unavailable = "未能进入全屏，已使用窗口模式。Esc 可暂停游戏。";
    if (
      document.fullscreenElement ||
      typeof target.requestFullscreen !== "function"
    ) {
      this.fullscreenWanted = false;
      return Promise.resolve(unavailable);
    }
    try {
      return Promise.resolve(target.requestFullscreen()).then(
        () => {
          this.fullscreenOwned = document.fullscreenElement === target;
          if (!this.fullscreenWanted || this.disposed)
            this.exitGameFullscreen();
          return this.fullscreenOwned ? null : unavailable;
        },
        () => unavailable,
      );
    } catch {
      return Promise.resolve(unavailable);
    }
  }
  private exitGameFullscreen() {
    this.fullscreenWanted = false;
    if (
      this.fullscreenTarget &&
      document.fullscreenElement === this.fullscreenTarget
    ) {
      try {
        void document.exitFullscreen().catch(() => {});
      } catch {}
    }
  }
  private fullscreenChanged() {
    if (
      this.fullscreenTarget &&
      document.fullscreenElement === this.fullscreenTarget
    ) {
      this.fullscreenOwned = true;
      if (!this.fullscreenWanted || this.disposed) this.exitGameFullscreen();
      return;
    }
    if (!this.fullscreenOwned) return;
    this.fullscreenOwned = false;
    this.fullscreenWanted = false;
    // Native Esc may be consumed by the browser before any keydown reaches us.
    if (!this.disposed && this.overlay !== "death") {
      this.simulation.closeContainer();
      this.showOverlay("pause");
    }
  }
  private acquirePointerLock(): Promise<void> {
    if (document.pointerLockElement === this.canvas) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = (error?: unknown) => {
        clearTimeout(timer);
        document.removeEventListener("pointerlockchange", changed);
        document.removeEventListener("pointerlockerror", failed);
        if (error) reject(error);
        else resolve();
      };
      const changed = () => {
        if (document.pointerLockElement === this.canvas) finish();
      };
      const failed = () => finish(new Error("鼠标锁定未启用"));
      const timer = setTimeout(
        () => finish(new Error("鼠标锁定请求超时")),
        8000,
      );
      document.addEventListener("pointerlockchange", changed);
      document.addEventListener("pointerlockerror", failed);
      try {
        const result = this.canvas.requestPointerLock();
        // Safari may return void and deliver the result only through events.
        if (result && typeof result.then === "function")
          result.then(changed, finish);
        changed();
      } catch (error) {
        finish(error);
      }
    });
  }
  async requestPointerLock() {
    if (this.disposed) return;
    const epoch = ++this.controlEpoch;
    this.audio.unlock();
    if (this.mouseFallback) {
      const fullscreen = this.requestGameFullscreen();
      this.setPaused(false);
      this.onOverlay?.(null);
      this.publish();
      const warning = await fullscreen;
      if (epoch !== this.controlEpoch || this.disposed)
        throw new DOMException("进入游戏已取消", "AbortError");
      if (warning) {
        this.message = warning;
        this.messageExpiry = this.elapsed + 8;
        this.publish();
      }
      return;
    }
    try {
      // Pointer lock must be requested BEFORE fullscreen consumes user activation.
      // Both calls occur synchronously in the original click/keyboard handler.
      const pointer = this.acquirePointerLock();
      const fullscreen = this.requestGameFullscreen();
      const [, warning] = await Promise.all([pointer, fullscreen]);
      if (epoch !== this.controlEpoch || this.disposed) {
        if (document.pointerLockElement === this.canvas)
          document.exitPointerLock();
        throw new DOMException("进入游戏已取消", "AbortError");
      }
      if (document.pointerLockElement === this.canvas) {
        this.setPaused(false);
        this.onOverlay?.(null);
        this.message =
          warning ??
          "WASD 移动 · 左键挖掘 · 右键使用 · E 背包 · Esc 暂停并退出全屏";
        this.messageExpiry = this.elapsed + 6;
        this.publish();
      } else {
        throw new Error("鼠标锁定未启用");
      }
    } catch (error) {
      if (epoch !== this.controlEpoch || this.disposed)
        throw new DOMException("进入游戏已取消", "AbortError");
      this.paused = true;
      this.overlay = "pause";
      this.exitGameFullscreen();
      this.message = "鼠标锁定未成功，请点击「继续游戏」重试。";
      this.messageExpiry = Infinity;
      this.onOverlay?.("pause");
      this.publish();
      throw error;
    }
  }
  startMouseFallback() {
    if (this.disposed) return;
    this.mouseFallback = true;
    this.audio.unlock();
    const epoch = ++this.controlEpoch;
    const fullscreen = this.requestGameFullscreen();
    this.setPaused(false);
    this.onOverlay?.(null);
    this.message = "拖动视角：按住右键环顾 · 轻点右键使用 · 左键挖掘";
    this.messageExpiry = this.elapsed + 10;
    this.publish();
    void fullscreen.then((warning) => {
      if (warning && epoch === this.controlEpoch && !this.disposed) {
        this.message = `${warning} 按住右键环顾。`;
        this.messageExpiry = this.elapsed + 10;
        this.publish();
      }
    });
  }
  openInventory(station: "inventory" | "workbench" = "inventory") {
    this.simulation.startCraft(station);
    this.showOverlay(station);
  }
  getCraftSlots() {
    return this.simulation.craftSlots;
  }
  getEnchanting(): EnchantingView | null {
    return this.simulation.getEnchanting();
  }
  getWorkshop(): WorkshopView | null {
    return this.simulation.getWorkshop();
  }
  getContainer(): ContainerState | null {
    return this.simulation.container;
  }
  clickSlot(
    source: "inventory" | "craft" | "container" | "armor",
    index: number | string,
    right = false,
    shift = false,
  ) {
    this.simulation.clickSlot(source, index, right, shift);
    this.publish();
  }
  getCursor(): Slot {
    return this.simulation.cursor;
  }
  takeCraftOutput() {
    if (["enchanting", "anvil", "grindstone"].includes(this.simulation.station))
      return;
    this.simulation.takeCraftOutput();
    this.publish();
  }
  getCraftOutput(): Slot {
    if (["enchanting", "anvil", "grindstone"].includes(this.simulation.station))
      return null;
    return this.simulation.craftOutput;
  }
  giveItem(id: string, enchantment?: string) {
    this.simulation.giveItem(id, enchantment);
    this.publish();
  }
  getRecipes(): RecipeDefinition[] {
    if (["enchanting", "anvil", "grindstone"].includes(this.simulation.station))
      return [];
    return RECIPES.filter(
      (r) =>
        this.simulation.station === "workbench" || r.station === "inventory",
    );
  }
  exportCheckpoint(): void {
    downloadSave(this.simulation.snapshot());
  }
  save(): Promise<void> {
    const data = this.simulation.snapshot(),
      generation = ++this.saveGeneration;
    this.saveStatus = "saving";
    this.publish();
    const promise = this.checkpointWriter.enqueue(data);
    return promise
      .then(() => {
        if (generation === this.saveGeneration) {
          this.simulation.manifest.updatedAt = data.manifest.updatedAt;
          this.saveStatus = "saved";
          this.publish();
        }
      })
      .catch((error: unknown) => {
        if (generation === this.saveGeneration) {
          this.saveStatus = "error";
          this.message = `保存失败：${error instanceof Error ? error.message : "请导出备份并检查浏览器存储空间"}`;
          this.messageExpiry = Infinity;
          this.publish();
        }
        throw error;
      });
  }
  updateSettings(settings: Settings) {
    this.settings = {
      ...settings,
      renderDistance: clamp(settings.renderDistance, 2, 6),
      sensitivity: clamp(settings.sensitivity, 0.2, 3),
      fov: clamp(settings.fov, 50, 110),
    };
    this.audio.volume = settings.volume;
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(
      settings.quality === "high"
        ? Math.min(window.devicePixelRatio, 2)
        : settings.quality === "low"
          ? 0.75
          : 1,
    );
    this.resize();
  }
  getMetrics() {
    const sorted = [...this.frames].sort((a, b) => a - b);
    return {
      frames: sorted.length,
      averageFps: sorted.length
        ? 1000 / (sorted.reduce((a, b) => a + b, 0) / sorted.length)
        : 0,
      p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      saveQueue: this.checkpointWriter.pendingCount,
      drawCalls: this.renderer.info.render.calls,
      chunks: this.world.stats.chunks,
      pending: this.world.stats.pending,
    };
  }
  resetMetrics() {
    this.frames = [];
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.controlEpoch++;
    this.exitGameFullscreen();
    cancelAnimationFrame(this.raf);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.cleanup.forEach((f) => f());
    this.resizeObserver.disconnect();
    this.listeners.clear();
    this.world.dispose();
    this.entityRenderer.dispose();
    this.sky.dispose();
    this.selection.geometry.dispose();
    (this.selection.material as THREE.Material).dispose();
    this.handGeometry.dispose();
    this.handMaterials.forEach((m) => m.dispose());
    this.audio.dispose();
    for (const texture of handTextures.values()) texture.dispose();
    handTextures.clear();
    this.renderer.dispose();
    if (import.meta.env.DEV)
      delete (window as unknown as { __voxelGame?: Game }).__voxelGame;
  }
}
const handTextures = new Map<number, THREE.Texture>();
function atlasTile(index: number) {
  let t = handTextures.get(index);
  if (t) return t;
  t = new THREE.TextureLoader().load("/assets/terrain-atlas.png");
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.repeat.set(0.249, 0.249);
  t.offset.set(
    (index % 4) / 4 + 0.0005,
    1 - (Math.floor(index / 4) + 1) / 4 + 0.0005,
  );
  handTextures.set(index, t);
  return t;
}

/** The menu uses the same terrain renderer as the playable world. */
export function createPreview(canvas: HTMLCanvasElement): () => void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = createRenderer(canvas, { ...DEFAULT_SETTINGS, quality: "low" });
  } catch {
    return () => {};
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbadce4);
  scene.fog = new THREE.Fog(0xbadce4, 45, 108);
  const sky = createSky(scene),
    camera = new THREE.PerspectiveCamera(55, 1, 0.1, 240);
  const world = new VoxelWorld(scene, "方块纪行 · 山风", [], "preview");
  const center = { x: 8, y: world.getSurface(8, 8) + 10, z: 8 };
  let raf = 0,
    disposed = false,
    last = 0;
  let elapsed = 0;
  const resize = () => {
    const w = canvas.clientWidth || innerWidth,
      h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  const frame = (now: number) => {
    if (disposed) return;
    elapsed += last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    camera.position.set(
      center.x + Math.cos(elapsed * 0.014) * 27,
      center.y + 8,
      center.z + Math.sin(elapsed * 0.014) * 27,
    );
    camera.lookAt(center.x - 7, center.y - 5, center.z - 15);
    world.update(center, 5);
    sky.sunMesh.position.set(-90, 110, -100);
    sky.sunMesh.lookAt(camera.position);
    sky.moon.visible = false;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    observer.disconnect();
    world.dispose();
    sky.dispose();
    renderer.dispose();
  };
}
