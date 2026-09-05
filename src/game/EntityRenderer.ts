import * as THREE from "three";
import type { DropState, EntityKind, EntityState, Vec3 } from "./types";
import { ITEMS } from "./registry";

export interface ExperienceOrbVisual {
  id: string;
  position: Vec3;
  value: number;
  age: number;
}

interface MobModel {
  group: THREE.Group;
  legs: THREE.Mesh[];
  head: THREE.Group;
  kind: EntityKind;
  previous: Vec3;
  fleece?: THREE.Mesh;
  loveMarker?: THREE.Group;
}
export class EntityRenderer {
  private mobs = new Map<string, MobModel>();
  private drops = new Map<string, THREE.Group>();
  private orbs = new Map<string, THREE.Group>();
  private box = new THREE.BoxGeometry(1, 1, 1);
  private plane = new THREE.PlaneGeometry(1, 1);
  private orbGeometry = new THREE.OctahedronGeometry(1, 0);
  private orbCore = new THREE.MeshBasicMaterial({
    color: 0xc6f665,
    toneMapped: false,
  });
  private orbGlow = new THREE.MeshBasicMaterial({
    color: 0xa2ed48,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  private textures: THREE.Texture[] = [];
  private materials: THREE.Material[] = [];
  private faceMaterials: THREE.MeshLambertMaterial[] = [];
  constructor(private scene: THREE.Scene) {
    this.materials.push(this.orbCore, this.orbGlow);
    for (let i = 0; i < 4; i++) {
      const tex = new THREE.TextureLoader().load("/assets/mob-atlas.png");
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.repeat.set(0.5, 0.5);
      tex.offset.set((i % 2) * 0.5, 1 - (Math.floor(i / 2) + 1) * 0.5);
      this.textures.push(tex);
      const mat = new THREE.MeshLambertMaterial({ map: tex });
      this.faceMaterials.push(mat);
      this.materials.push(mat);
    }
  }
  private mat(color: number) {
    const mat = new THREE.MeshLambertMaterial({ color });
    this.materials.push(mat);
    return mat;
  }
  private block(
    parent: THREE.Object3D,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ) {
    const mesh = new THREE.Mesh(this.box, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    parent.add(mesh);
    return mesh;
  }
  private build(e: EntityState): MobModel {
    const group = new THREE.Group(),
      head = new THREE.Group();
    const legs: THREE.Mesh[] = [];
    let fleece: THREE.Mesh | undefined;
    let loveMarker: THREE.Group | undefined;
    group.name = `mob:${e.id}`;
    head.name = "head";
    group.add(head);
    const kind = e.kind;
    if (kind === "pig" || kind === "sheep" || kind === "cow") {
      const wool = kind === "sheep",
        cow = kind === "cow",
        body = this.mat(cow ? 0xe3ded0 : wool ? 0xbfa18b : 0xdb9d95),
        foot = this.mat(cow ? 0x4d453f : wool ? 0x897c69 : 0xb57872);
      this.block(
        group,
        body,
        0,
        cow ? 0.86 : 0.74,
        0,
        cow ? 0.86 : 0.78,
        cow ? 0.72 : 0.66,
        cow ? 1.23 : 1.05,
      );
      head.position.set(0, cow ? 1.09 : 0.98, cow ? 0.7 : 0.59);
      this.block(head, body, 0, 0, 0, 0.55, 0.55, 0.48);
      for (const x of [-0.25, 0.25])
        for (const z of [-0.33, 0.33])
          legs.push(this.block(group, foot, x, 0.26, z, 0.22, 0.52, 0.24));
      if (cow) {
        const dark = this.mat(0x302f2b),
          nose = this.mat(0xb69a91),
          horn = this.mat(0xd4c4a0);
        for (const side of [-1, 1]) {
          this.block(
            group,
            dark,
            side * 0.434,
            0.98,
            -0.28,
            0.014,
            0.37,
            0.46,
          ).name = "cow-patch";
          this.block(
            group,
            dark,
            side * 0.434,
            0.66,
            0.3,
            0.014,
            0.25,
            0.31,
          ).name = "cow-patch";
          this.block(
            group,
            dark,
            side * 0.3,
            1.225,
            -0.18,
            0.26,
            0.015,
            0.55,
          ).name = "cow-patch";
          this.block(
            head,
            dark,
            side * 0.19,
            0.05,
            0.245,
            0.085,
            0.085,
            0.018,
          ).name = "cow-eye";
          this.block(head, body, side * 0.34, 0.1, 0, 0.15, 0.13, 0.18);
          this.block(
            head,
            horn,
            side * 0.19,
            0.34,
            -0.055,
            0.075,
            0.18,
            0.085,
          ).name = "cow-horn";
          this.block(head, dark, side * 0.13, -0.15, 0.359, 0.07, 0.055, 0.015);
        }
        this.block(head, nose, 0, -0.14, 0.29, 0.46, 0.2, 0.12).name =
          "cow-muzzle";
        this.block(group, nose, 0, 0.46, -0.2, 0.32, 0.14, 0.34);
        this.block(group, dark, 0, 0.79, -0.66, 0.06, 0.53, 0.065);
      } else {
        const face = new THREE.Mesh(
          this.plane,
          this.faceMaterials[wool ? 1 : 0],
        );
        face.position.z = 0.245;
        face.scale.set(0.55, 0.55, 1);
        head.add(face);
      }
      if (wool) {
        fleece = this.block(
          group,
          this.mat(0xf8f5e7),
          0,
          0.84,
          -0.02,
          0.86,
          0.67,
          1.03,
        );
        fleece.name = "fleece";
      }
      loveMarker = new THREE.Group();
      loveMarker.name = "love-marker";
      loveMarker.visible = false;
      const heart = this.mat(0xda665d);
      this.block(loveMarker, heart, -0.065, 0.08, 0, 0.1, 0.1, 0.035);
      this.block(loveMarker, heart, 0.065, 0.08, 0, 0.1, 0.1, 0.035);
      this.block(loveMarker, heart, 0, 0.015, 0, 0.23, 0.1, 0.035);
      this.block(loveMarker, heart, 0, -0.06, 0, 0.13, 0.065, 0.035);
      this.block(loveMarker, heart, 0, -0.11, 0, 0.05, 0.045, 0.035);
      group.add(loveMarker);
    } else {
      const creepy = kind === "creeper",
        skin = this.mat(creepy ? 0x6f9854 : 0x759460),
        shirt = this.mat(creepy ? 0x6f9854 : 0x507b79),
        pants = this.mat(creepy ? 0x4a6840 : 0x485866);
      if (creepy) {
        this.block(group, skin, 0, 0.9, 0, 0.55, 0.82, 0.4);
        for (const x of [-0.23, 0.23])
          for (const z of [-0.2, 0.2])
            legs.push(this.block(group, pants, x, 0.22, z, 0.25, 0.44, 0.3));
      } else {
        this.block(group, shirt, 0, 1.05, 0, 0.57, 0.67, 0.32);
        legs.push(
          this.block(group, pants, -0.15, 0.4, 0, 0.25, 0.8, 0.29),
          this.block(group, pants, 0.15, 0.4, 0, 0.25, 0.8, 0.29),
        );
        this.block(group, skin, -0.43, 1.22, 0.32, 0.22, 0.23, 0.68);
        this.block(group, skin, 0.43, 1.22, 0.32, 0.22, 0.23, 0.68);
      }
      head.position.set(0, 1.61, 0);
      this.block(head, skin, 0, 0, 0, 0.58, 0.58, 0.58);
      const face = new THREE.Mesh(
        this.plane,
        this.faceMaterials[creepy ? 3 : 2],
      );
      face.position.z = 0.294;
      face.scale.set(0.58, 0.58, 1);
      head.add(face);
    }
    this.scene.add(group);
    return {
      group,
      legs,
      head,
      kind,
      previous: { ...e.position },
      fleece,
      loveMarker,
    };
  }
  update(
    entities: EntityState[],
    drops: DropState[],
    player: Vec3,
    elapsed: number,
    orbs: readonly ExperienceOrbVisual[] = [],
  ) {
    const live = new Set(entities.map((e) => e.id));
    for (const [id, m] of this.mobs) {
      if (!live.has(id)) {
        this.scene.remove(m.group);
        this.disposeModel(m.group);
        this.mobs.delete(id);
      }
    }
    for (const e of entities) {
      let model = this.mobs.get(e.id);
      if (!model) {
        model = this.build(e);
        this.mobs.set(e.id, model);
      }
      const p = e.position;
      model.group.position.set(p.x, p.y, p.z);
      model.group.rotation.y = e.yaw;
      const moving =
        Math.hypot(p.x - model.previous.x, p.z - model.previous.z) > 0.001;
      model.legs.forEach((leg, i) => {
        leg.rotation.x = moving
          ? Math.sin(elapsed * 9 + (i % 2) * Math.PI) * 0.5
          : Math.sin(elapsed * 1.5) * 0.015;
      });
      model.head.rotation.y = Math.sin(elapsed * 0.7) * 0.04;
      const baby = (e.age ?? 0) < 0;
      const size = baby ? 0.5 : 1;
      model.head.scale.setScalar(baby ? 1.12 : 1);
      if (model.fleece) model.fleece.visible = !e.sheared;
      if (model.loveMarker) {
        model.loveMarker.visible = (e.love ?? 0) > 0;
        model.loveMarker.position.y =
          (e.kind === "cow" ? 1.75 : 1.62) + Math.sin(elapsed * 3) * 0.055;
        model.loveMarker.rotation.y =
          Math.atan2(player.x - p.x, player.z - p.z) - e.yaw;
      }
      const pulse = e.fuse ? 1 + Math.sin(elapsed * 30) * 0.035 * e.fuse : 1;
      model.group.scale.setScalar(size * pulse);
      model.previous = { ...p };
      model.group.visible = Math.hypot(p.x - player.x, p.z - player.z) < 90;
    }
    const dropIds = new Set(drops.map((d) => d.id));
    for (const [id, m] of this.drops) {
      if (!dropIds.has(id)) {
        this.scene.remove(m);
        this.disposeModel(m);
        this.drops.delete(id);
      }
    }
    for (const d of drops) {
      let m = this.drops.get(d.id);
      if (!m) {
        m = new THREE.Group();
        const item = ITEMS[d.stack.id];
        const mat = this.mat(
          Number.parseInt((item?.color ?? "#c9b383").replace("#", ""), 16),
        );
        const mesh = new THREE.Mesh(this.box, mat);
        mesh.scale.setScalar(0.2);
        m.add(mesh);
        this.scene.add(m);
        this.drops.set(d.id, m);
      }
      m.position.set(
        d.position.x,
        d.position.y + 0.16 + Math.sin(elapsed * 2.5) * 0.05,
        d.position.z,
      );
      m.rotation.y = elapsed * 1.1;
    }
    const orbIds = new Set(orbs.map((orb) => orb.id));
    for (const [id, group] of this.orbs)
      if (!orbIds.has(id)) {
        this.scene.remove(group);
        this.orbs.delete(id);
      }
    this.orbCore.color.setHSL(
      0.235 + Math.sin(elapsed * 2) * 0.025,
      0.86,
      0.65,
    );
    for (const orb of orbs) {
      let group = this.orbs.get(orb.id);
      if (!group) {
        group = new THREE.Group();
        group.name = `xp:${orb.id}`;
        const core = new THREE.Mesh(this.orbGeometry, this.orbCore),
          glow = new THREE.Mesh(this.orbGeometry, this.orbGlow);
        glow.scale.setScalar(1.8);
        group.add(core, glow);
        this.orbs.set(orb.id, group);
        this.scene.add(group);
      }
      const size = Math.min(
        0.17,
        0.08 + Math.log2(Math.max(1, orb.value) + 1) * 0.014,
      );
      group.scale.setScalar(
        size * (1 + Math.sin(elapsed * 4 + orb.age) * 0.07),
      );
      group.rotation.y = elapsed * 1.8;
      group.position.set(
        orb.position.x,
        orb.position.y + Math.sin(elapsed * 3 + orb.age) * 0.035,
        orb.position.z,
      );
      group.visible =
        Math.hypot(
          orb.position.x - player.x,
          orb.position.y - player.y,
          orb.position.z - player.z,
        ) < 90;
    }
  }
  private disposeModel(object: THREE.Object3D) {
    const disposed = new Set<THREE.Material>();
    object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats)
          if (
            !disposed.has(mat) &&
            !this.faceMaterials.includes(mat as THREE.MeshLambertMaterial)
          ) {
            disposed.add(mat);
            mat.dispose();
            const i = this.materials.indexOf(mat);
            if (i >= 0) this.materials.splice(i, 1);
          }
      }
    });
  }
  dispose() {
    for (const m of this.mobs.values()) {
      this.scene.remove(m.group);
      this.disposeModel(m.group);
    }
    for (const m of this.drops.values()) {
      this.scene.remove(m);
      this.disposeModel(m);
    }
    this.mobs.clear();
    this.drops.clear();
    for (const group of this.orbs.values()) this.scene.remove(group);
    this.orbs.clear();
    this.box.dispose();
    this.plane.dispose();
    this.orbGeometry.dispose();
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
  }
}
