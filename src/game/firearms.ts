import { raycastVoxel } from "../engine/physics";
import { ENTITIES } from "./registry";
import type { EntityState, Vec3, WorldPort } from "./types";

export const RIFLE = { range: 72, damage: 8, interval: 0.12 } as const;

/** Hitscan against body bounds; the closest terrain surface always stops a shot. */
export function traceRifle(
  world: WorldPort,
  entities: EntityState[],
  eye: Vec3,
  direction: Vec3,
) {
  const wall = raycastVoxel(
    {
      getBlock: (x, y, z) =>
        world.isReady(x, z, y) ? world.getBlock(x, y, z) : 24,
    },
    eye,
    direction,
    RIFLE.range,
    false,
    true,
  );
  let distance: number = wall?.distance ?? RIFLE.range;
  let victim: EntityState | undefined;
  for (const entity of entities) {
    if (entity.health <= 0) continue;
    const scale = (entity.age ?? 0) < 0 ? 0.55 : 1;
    const half = 0.4 * scale;
    const min = {
      x: entity.position.x - half,
      y: entity.position.y,
      z: entity.position.z - half,
    };
    const max = {
      x: entity.position.x + half,
      y:
        entity.position.y + (ENTITIES[entity.kind].hostile ? 1.8 : 1.1) * scale,
      z: entity.position.z + half,
    };
    let entry = 0,
      exit = distance;
    for (const axis of ["x", "y", "z"] as const) {
      if (Math.abs(direction[axis]) < 1e-8) {
        if (eye[axis] < min[axis] || eye[axis] > max[axis]) {
          exit = -1;
          break;
        }
      } else {
        const a = (min[axis] - eye[axis]) / direction[axis];
        const b = (max[axis] - eye[axis]) / direction[axis];
        entry = Math.max(entry, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
      }
    }
    if (entry <= exit && entry < distance) {
      victim = entity;
      distance = entry;
    }
  }
  return {
    victim,
    end: {
      x: eye.x + direction.x * distance,
      y: eye.y + direction.y * distance,
      z: eye.z + direction.z * distance,
    },
  };
}
