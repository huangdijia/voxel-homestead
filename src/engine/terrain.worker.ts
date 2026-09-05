import { buildChunk } from "./mesher";
import type { ChunkRequest } from "./protocol";

self.addEventListener("message", (event: MessageEvent<ChunkRequest>) => {
  const request = event.data;
  try {
    const result = buildChunk(request);
    const transfers: ArrayBuffer[] = [result.voxels.buffer as ArrayBuffer];
    for (const layer of result.layers)
      for (const buffer of [
        layer.positions,
        layer.normals,
        layer.uvs,
        layer.colors,
        layer.indices,
      ])
        transfers.push(buffer.buffer as ArrayBuffer);
    self.postMessage(result, { transfer: transfers });
  } catch (error) {
    self.postMessage({
      worldId: request.worldId,
      key: request.key,
      revision: request.revision,
      error: String(error),
    });
  }
});
