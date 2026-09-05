import { describe, expect, it } from "vitest";
import { buildChunk } from "../src/engine/mesher";
import type { ChunkRequest } from "../src/engine/protocol";

const enabled =
  (
    globalThis as unknown as {
      process?: { env: Record<string, string | undefined> };
    }
  ).process?.env.ENGINE_BENCHMARK === "1";
const percentile = (values: number[], q: number) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * q))
  ];
describe.skipIf(!enabled)("engine CPU benchmark (opt-in, no renderer)", () => {
  it("measures 676 streamed chunks and repeated nearby edits", () => {
    const requests: ChunkRequest[] = [];
    for (let cz = -6; cz <= 6; cz++)
      for (let cx = -6; cx <= 6; cx++)
        for (let cy = -1; cy <= 2; cy++)
          requests.push({
            worldId: "benchmark",
            seed: "M1-performance-iron",
            key: cx + "," + cy + "," + cz,
            cx,
            cy,
            cz,
            revision: 1,
            changes: [],
          });
    requests.sort(
      (a, b) =>
        (a.cx * a.cx + a.cz * a.cz) * 8 +
        Math.abs(a.cy - 1) * 0.3 -
        ((b.cx * b.cx + b.cz * b.cz) * 8 + Math.abs(b.cy - 1) * 0.3),
    );
    const timings: number[] = [],
      start = performance.now();
    let byteLength = 0,
      triangles = 0,
      spawnReadyMs = 0;
    for (const [index, request] of requests.entries()) {
      const before = performance.now(),
        result = buildChunk(request);
      timings.push(performance.now() - before);
      if (index === 3) spawnReadyMs = performance.now() - start;
      byteLength += result.voxels.byteLength;
      for (const layer of result.layers) {
        triangles += layer.indices.length / 3;
        byteLength +=
          layer.positions.byteLength +
          layer.normals.byteLength +
          layer.uvs.byteLength +
          layer.colors.byteLength +
          layer.indices.byteLength;
      }
    }
    const fullLoadMs = performance.now() - start,
      edits: number[] = [];
    const near = requests.find((r) => r.cx === 0 && r.cy === 1 && r.cz === 0)!;
    for (let i = 0; i < 100; i++) {
      const before = performance.now();
      buildChunk({
        ...near,
        revision: i + 2,
        changes: [{ x: 1 + (i % 8), y: 22, z: 2, id: i % 2 ? 0 : 11 }],
      });
      edits.push(performance.now() - before);
    }
    console.info(
      "ENGINE_BENCHMARK",
      JSON.stringify({
        chunks: requests.length,
        spawnReadyMs: +spawnReadyMs.toFixed(2),
        fullLoadMs: +fullLoadMs.toFixed(2),
        generationP50Ms: +percentile(timings, 0.5).toFixed(2),
        generationP95Ms: +percentile(timings, 0.95).toFixed(2),
        generationMaxMs: +Math.max(...timings).toFixed(2),
        editP95Ms: +percentile(edits, 0.95).toFixed(2),
        triangles,
        transferMiB: +(byteLength / 1048576).toFixed(2),
      }),
    );
    expect(requests).toHaveLength(676);
    expect(timings.every(Number.isFinite)).toBe(true);
  }, 120000);
});
