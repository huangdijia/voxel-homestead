import type { BlockChange } from "../game/types";
export interface ChunkRequest {
  worldId: string;
  seed: string;
  key: string;
  cx: number;
  cy: number;
  cz: number;
  revision: number;
  changes: BlockChange[];
}
export interface MeshArrays {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}
export interface ChunkResult {
  worldId: string;
  key: string;
  revision: number;
  voxels: Uint16Array;
  layers: MeshArrays[];
  error?: string;
}
