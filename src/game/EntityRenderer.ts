import * as THREE from "three";
import type { DropState, EntityKind, EntityState, Vec3 } from "./types";
import { ITEMS } from "./registry";

interface MobModel {
  group: THREE.Group;
  legs: THREE.Mesh[];
  head: THREE.Group;
  kind: EntityKind;
  previous: Vec3;
}
export class EntityRenderer {
  private mobs = new Map<string, MobModel>();
  private drops = new Map<string, THREE.Group>();
  private box = new THREE.BoxGeometry(1, 1, 1);
  private plane = new THREE.PlaneGeometry(1, 1);
  private textures: THREE.Texture[] = [];
  private materials: THREE.Material[] = [];
  private faceMaterials: THREE.MeshLambertMaterial[] = [];
  constructor(private scene: THREE.Scene) {
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
    group.add(head);
    const kind = e.kind;
    if (kind === "pig" || kind === "sheep") {
      const wool = kind === "sheep",
        body = this.mat(wool ? 0xe5e2d4 : 0xdb9d95),
        foot = this.mat(wool ? 0x897c69 : 0xb57872);
      this.block(group, body, 0, 0.74, 0, 0.78, 0.66, 1.05);
      head.position.set(0, 0.98, 0.59);
      this.block(head, body, 0, 0, 0, 0.55, 0.55, 0.48);
      for (const x of [-0.25, 0.25])
        for (const z of [-0.33, 0.33])
          legs.push(this.block(group, foot, x, 0.26, z, 0.22, 0.52, 0.24));
      const face = new THREE.Mesh(this.plane, this.faceMaterials[wool ? 1 : 0]);
      face.position.z = 0.245;
      face.scale.set(0.55, 0.55, 1);
      head.add(face);
      if (wool)
        this.block(group, this.mat(0xf8f5e7), 0, 0.84, -0.02, 0.86, 0.67, 1.03);
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
    return { group, legs, head, kind, previous: { ...e.position } };
  }
  update(
    entities: EntityState[],
    drops: DropState[],
    player: Vec3,
    elapsed: number,
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
      if (e.fuse) {
        const scale = 1 + Math.sin(elapsed * 30) * 0.035 * e.fuse;
        model.group.scale.setScalar(scale);
      } else model.group.scale.setScalar(1);
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
  }
  private disposeModel(object: THREE.Object3D) {
    object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats)
          if (!this.faceMaterials.includes(mat as THREE.MeshLambertMaterial)) {
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
    this.box.dispose();
    this.plane.dispose();
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
  }
}
