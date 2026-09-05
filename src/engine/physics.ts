import type { Vec3, WorldPort } from "../game/types";
import { collisionBoxes, selectionBoxes } from "./shapes";
import type { BlockBox } from "./shapes";

type WorldReader = Pick<WorldPort, "getBlock">;
const EPSILON = 0.00001;
type Bounds = { min: Vec3; max: Vec3 };
function bodyBounds(p: Vec3, width: number, height: number): Bounds {
  return {
    min: { x: p.x - width / 2, y: p.y, z: p.z - width / 2 },
    max: { x: p.x + width / 2, y: p.y + height, z: p.z + width / 2 },
  };
}
function visitBoxes(
  world: WorldReader,
  range: Bounds,
  callback: (box: Bounds) => void,
): void {
  for (let y = Math.floor(range.min.y); y <= Math.floor(range.max.y); y++) {
    for (let z = Math.floor(range.min.z); z <= Math.floor(range.max.z); z++) {
      for (let x = Math.floor(range.min.x); x <= Math.floor(range.max.x); x++) {
        const id = world.getBlock(x, y, z);
        for (const box of collisionBoxes(id))
          callback({
            min: { x: x + box[0], y: y + box[1], z: z + box[2] },
            max: { x: x + box[3], y: y + box[4], z: z + box[5] },
          });
      }
    }
  }
}
function overlaps(a: Bounds, b: Bounds): boolean {
  return (
    a.max.x > b.min.x + EPSILON &&
    a.min.x < b.max.x - EPSILON &&
    a.max.y > b.min.y + EPSILON &&
    a.min.y < b.max.y - EPSILON &&
    a.max.z > b.min.z + EPSILON &&
    a.min.z < b.max.z - EPSILON
  );
}
/** Position is the center of the player's feet, not the camera/eye position. */
export function intersectsWorld(
  world: WorldReader,
  position: Vec3,
  width = 0.6,
  height = 1.8,
): boolean {
  const bounds = bodyBounds(position, width, height);
  let intersects = false;
  visitBoxes(world, bounds, (box) => {
    if (overlaps(bounds, box)) intersects = true;
  });
  return intersects;
}

function moveAxis(
  world: WorldReader,
  position: Vec3,
  amount: number,
  axis: "x" | "y" | "z",
  width: number,
  height: number,
): number {
  if (amount === 0) return 0;
  const body = bodyBounds(position, width, height);
  const range: Bounds = { min: { ...body.min }, max: { ...body.max } };
  range.min[axis] += Math.min(0, amount);
  range.max[axis] += Math.max(0, amount);
  const other = (["x", "y", "z"] as const).filter((a) => a !== axis);
  let allowed = amount;
  visitBoxes(world, range, (box) => {
    if (
      !other.every(
        (a) =>
          body.max[a] > box.min[a] + EPSILON &&
          body.min[a] < box.max[a] - EPSILON,
      )
    )
      return;
    if (amount > 0 && body.max[axis] <= box.min[axis] + EPSILON)
      allowed = Math.min(allowed, Math.max(0, box.min[axis] - body.max[axis]));
    else if (amount < 0 && body.min[axis] >= box.max[axis] - EPSILON)
      allowed = Math.max(allowed, Math.min(0, box.max[axis] - body.min[axis]));
  });
  position[axis] += allowed;
  return allowed;
}

export function moveBody(
  world: WorldReader,
  position: Vec3,
  delta: Vec3,
  width = 0.6,
  height = 1.8,
): {
  position: Vec3;
  grounded: boolean;
  hitX: boolean;
  hitZ: boolean;
  hitY: boolean;
} {
  const result = { ...position };
  const dy = moveAxis(world, result, delta.y, "y", width, height);
  const dx = moveAxis(world, result, delta.x, "x", width, height);
  const dz = moveAxis(world, result, delta.z, "z", width, height);
  let hitX = Math.abs(dx - delta.x) > EPSILON,
    hitZ = Math.abs(dz - delta.z) > EPSILON;
  const hitY = Math.abs(dy - delta.y) > EPSILON;
  let grounded =
    (hitY && delta.y < 0) ||
    (delta.y <= 0 &&
      intersectsWorld(
        world,
        { ...result, y: result.y - 0.025 },
        width,
        height,
      ));
  // Half-height slabs/bed edges can be stepped onto without jumping a whole block.
  if ((hitX || hitZ) && delta.y <= 0 && grounded) {
    const stepped = { x: position.x, y: result.y, z: position.z };
    const rise = moveAxis(world, stepped, 0.6, "y", width, height);
    if (rise >= 0.5 - EPSILON) {
      const sx = moveAxis(world, stepped, delta.x, "x", width, height);
      const sz = moveAxis(world, stepped, delta.z, "z", width, height);
      if (sx * sx + sz * sz > dx * dx + dz * dz + EPSILON) {
        moveAxis(world, stepped, -rise - 0.025, "y", width, height);
        if (!intersectsWorld(world, stepped, width, height)) {
          Object.assign(result, stepped);
          hitX = Math.abs(sx - delta.x) > EPSILON;
          hitZ = Math.abs(sz - delta.z) > EPSILON;
          grounded = intersectsWorld(
            world,
            { ...stepped, y: stepped.y - 0.025 },
            width,
            height,
          );
        }
      }
    }
  }
  return { position: result, grounded, hitX, hitZ, hitY };
}

function rayBox(
  origin: Vec3,
  direction: Vec3,
  voxel: Vec3,
  box: BlockBox,
): { distance: number; normal: Vec3 } | null {
  let near = -Infinity,
    far = Infinity,
    normal: Vec3 = { x: 0, y: 0, z: 0 };
  for (let index = 0; index < 3; index++) {
    const axis = (["x", "y", "z"] as const)[index];
    const min = voxel[axis] + box[index],
      max = voxel[axis] + box[index + 3],
      d = direction[axis];
    if (Math.abs(d) < EPSILON) {
      if (origin[axis] < min || origin[axis] > max) return null;
      continue;
    }
    const a = (min - origin[axis]) / d,
      b = (max - origin[axis]) / d;
    const entry = Math.min(a, b),
      exit = Math.max(a, b);
    if (entry > near) {
      near = entry;
      normal = { x: 0, y: 0, z: 0 };
      normal[axis] = d > 0 ? -1 : 1;
    }
    far = Math.min(far, exit);
    if (near > far) return null;
  }
  if (far < 0) return null;
  return { distance: Math.max(0, near), normal };
}

/** Grid traversal uses actual partial block bounds and ignores water. */
export function raycastVoxel(
  world: WorldReader,
  origin: Vec3,
  direction: Vec3,
  max = 5,
  includeWater = false,
  solidOnly = false,
): { position: Vec3; normal: Vec3; id: number; distance: number } | null {
  const magnitude = Math.hypot(direction.x, direction.y, direction.z);
  if (magnitude < EPSILON || max <= 0) return null;
  const d = {
    x: direction.x / magnitude,
    y: direction.y / magnitude,
    z: direction.z / magnitude,
  };
  const voxel = {
    x: Math.floor(origin.x),
    y: Math.floor(origin.y),
    z: Math.floor(origin.z),
  };
  const step = { x: Math.sign(d.x), y: Math.sign(d.y), z: Math.sign(d.z) };
  const delta = {
    x: Math.abs(1 / d.x),
    y: Math.abs(1 / d.y),
    z: Math.abs(1 / d.z),
  };
  const next = { x: 0, y: 0, z: 0 };
  for (const axis of ["x", "y", "z"] as const)
    next[axis] =
      d[axis] === 0
        ? Infinity
        : ((step[axis] > 0 ? voxel[axis] + 1 : voxel[axis]) - origin[axis]) /
          d[axis];
  let entered = 0;
  for (
    let iterations = 0;
    iterations < Math.ceil(max * 4) + 8 && entered <= max;
    iterations++
  ) {
    const id = world.getBlock(voxel.x, voxel.y, voxel.z);
    let hit: { distance: number; normal: Vec3 } | null = null;
    for (const box of includeWater && id === 6
      ? [[0, 0, 0, 1, 1, 1] as BlockBox]
      : solidOnly
        ? collisionBoxes(id)
        : selectionBoxes(id)) {
      const candidate = rayBox(origin, d, voxel, box);
      if (
        candidate &&
        candidate.distance <= max &&
        (!hit || candidate.distance < hit.distance)
      )
        hit = candidate;
    }
    if (hit)
      return {
        position: { ...voxel },
        normal: hit.normal,
        id,
        distance: hit.distance,
      };
    const axis =
      next.x < next.y
        ? next.x < next.z
          ? "x"
          : "z"
        : next.y < next.z
          ? "y"
          : "z";
    entered = next[axis];
    next[axis] += delta[axis];
    voxel[axis] += step[axis];
  }
  return null;
}
