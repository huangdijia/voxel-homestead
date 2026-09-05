import type { Vec3, WorldPort } from "../game/types";
import { isFluid } from "../game/fluid-blocks";
import {
  collisionBoxes,
  selectionBoxes,
  fluidSurfaceHeights,
  fluidSurfaceQuads,
} from "./shapes";
import type { BlockBox, ShapeVertex } from "./shapes";

type WorldReader = Pick<WorldPort, "getBlock"> &
  Partial<Pick<WorldPort, "isReady">>;
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
        // A procedural fallback is not permission to enter an unloaded section.
        if (world.isReady && !world.isReady(x, z, y)) {
          callback({ min: { x, y, z }, max: { x: x + 1, y: y + 1, z: z + 1 } });
          continue;
        }
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

function rayTriangle(
  origin: Vec3,
  d: Vec3,
  a: ShapeVertex,
  b: ShapeVertex,
  c: ShapeVertex,
): number | null {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
    p = [
      d.y * e2[2] - d.z * e2[1],
      d.z * e2[0] - d.x * e2[2],
      d.x * e2[1] - d.y * e2[0],
    ],
    determinant = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(determinant) < EPSILON) return null;
  const inverse = 1 / determinant,
    t = [origin.x - a[0], origin.y - a[1], origin.z - a[2]],
    u = (t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) * inverse;
  if (u < -EPSILON || u > 1 + EPSILON) return null;
  const q = [
      t[1] * e1[2] - t[2] * e1[1],
      t[2] * e1[0] - t[0] * e1[2],
      t[0] * e1[1] - t[1] * e1[0],
    ],
    v = (d.x * q[0] + d.y * q[1] + d.z * q[2]) * inverse;
  if (v < -EPSILON || u + v > 1 + EPSILON) return null;
  const distance = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inverse;
  return distance >= -EPSILON ? Math.max(0, distance) : null;
}

function rayFluid(
  world: WorldReader,
  origin: Vec3,
  d: Vec3,
  voxel: Vec3,
  id: number,
): { distance: number; normal: Vec3 } | null {
  const heights = fluidSurfaceHeights(
      id,
      voxel.x,
      voxel.y,
      voxel.z,
      (x, y, z) => world.getBlock(x, y, z),
    ),
    local = {
      x: origin.x - voxel.x,
      y: origin.y - voxel.y,
      z: origin.z - voxel.z,
    },
    [a, b, c, e] = heights;
  const surface =
    local.z >= local.x
      ? a + (e - c) * local.x + (c - a) * local.z
      : a + (b - a) * local.x + (e - b) * local.z;
  if (
    local.x >= 0 &&
    local.x <= 1 &&
    local.z >= 0 &&
    local.z <= 1 &&
    local.y >= 0 &&
    local.y <= surface
  )
    return { distance: 0, normal: { x: 0, y: 1, z: 0 } };
  let hit: { distance: number; normal: Vec3 } | null = null;
  const normals: Vec3[] = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 },
  ];
  for (const [face, quad] of fluidSurfaceQuads(heights).entries())
    for (const indices of [
      [0, 1, 2],
      [2, 1, 3],
    ]) {
      const distance = rayTriangle(
        local,
        d,
        quad[indices[0]],
        quad[indices[1]],
        quad[indices[2]],
      );
      if (distance !== null && (!hit || distance < hit.distance))
        hit = { distance, normal: normals[face] };
    }
  return hit;
}

/** Actual partial geometry; includeWater also opts into lava and flowing fluid. */
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
    if (world.isReady && !world.isReady(voxel.x, voxel.z, voxel.y)) return null;
    const id = world.getBlock(voxel.x, voxel.y, voxel.z);
    let hit =
      includeWater && isFluid(id)
        ? rayFluid(world, origin, d, voxel, id)
        : null;
    for (const box of isFluid(id)
      ? []
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
    if (hit && hit.distance <= max)
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
