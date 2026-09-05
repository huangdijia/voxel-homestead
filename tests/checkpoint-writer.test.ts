import { describe, expect, it, vi } from "vitest";
import { CheckpointWriter } from "../src/game/checkpoint-writer";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("bounded checkpoint writer", () => {
  it("writes only the first and newest of twenty checkpoints while the first is blocked", async () => {
    const first = deferred(),
      latest = deferred();
    const write = vi.fn((data: number) =>
      data === 1 ? first.promise : latest.promise,
    );
    const writer = new CheckpointWriter(write);
    const promises = Array.from({ length: 20 }, (_, i) => {
      const result = writer.enqueue(i + 1);
      expect(writer.pendingCount).toBeLessThanOrEqual(2);
      return result;
    });
    expect(promises.every((promise) => promise === promises[0])).toBe(true);
    expect(write.mock.calls).toEqual([[1]]);
    expect(writer.pendingCount).toBe(2);
    let complete = false;
    void promises[0].then(() => {
      complete = true;
    });
    first.resolve();
    await tick();
    expect(write.mock.calls).toEqual([[1], [20]]);
    expect(writer.pendingCount).toBe(1);
    expect(complete).toBe(false);
    latest.resolve();
    await Promise.all(promises);
    expect(complete).toBe(true);
    expect(writer.pendingCount).toBe(0);
  });

  it("keeps a save-and-exit waiter pending until the latest checkpoint is durable", async () => {
    const requests = new Map<number, ReturnType<typeof deferred>>();
    const written: number[] = [];
    const writer = new CheckpointWriter<number>((data) => {
      written.push(data);
      const request = deferred();
      requests.set(data, request);
      return request.promise;
    });
    const automatic = writer.enqueue(1);
    writer.enqueue(2);
    requests.get(1)!.resolve();
    await tick();
    const exit = writer.enqueue(3);
    expect(exit).toBe(automatic);
    let exited = false;
    void exit.then(() => {
      exited = true;
    });
    requests.get(2)!.resolve();
    await tick();
    expect(written).toEqual([1, 2, 3]);
    expect(exited).toBe(false);
    requests.get(3)!.resolve();
    await exit;
    expect(exited).toBe(true);
    expect(writer.pendingCount).toBe(0);
  });

  it("rejects one shared drain on failure, discards stale waiting data and permits a fresh retry", async () => {
    const first = deferred();
    const failure = new DOMException("Storage full", "QuotaExceededError");
    const write = vi.fn((data: number) =>
      data === 1 ? first.promise : Promise.resolve(),
    );
    const writer = new CheckpointWriter(write);
    const old = writer.enqueue(1);
    const queued = writer.enqueue(2);
    const rejection = expect(old).rejects.toBe(failure);
    expect(queued).toBe(old);
    first.reject(failure);
    await rejection;
    expect(writer.pendingCount).toBe(0);
    expect(write.mock.calls).toEqual([[1]]);
    const retry = writer.enqueue(3);
    expect(retry).not.toBe(old);
    await retry;
    expect(write.mock.calls).toEqual([[1], [3]]);
    expect(writer.pendingCount).toBe(0);
  });

  it("rejects the entire drain if the final coalesced write fails", async () => {
    const first = deferred(),
      last = deferred();
    const writer = new CheckpointWriter<number>((id) =>
      id === 1 ? first.promise : last.promise,
    );
    const automatic = writer.enqueue(1);
    writer.enqueue(2);
    const exit = writer.enqueue(3);
    const failure = new Error("Transaction aborted");
    const automaticRejected = expect(automatic).rejects.toBe(failure);
    const exitRejected = expect(exit).rejects.toBe(failure);
    first.resolve();
    await tick();
    last.reject(failure);
    await Promise.all([automaticRejected, exitRejected]);
    expect(writer.pendingCount).toBe(0);
  });

  it("handles synchronous storage exceptions without losing the public rejection or poisoning retries", async () => {
    const failure = new Error("Database unavailable");
    let fails = true;
    const writer = new CheckpointWriter<number>(() => {
      if (fails) throw failure;
      return Promise.resolve();
    });
    await expect(writer.enqueue(1)).rejects.toBe(failure);
    expect(writer.pendingCount).toBe(0);
    fails = false;
    await writer.enqueue(2);
    expect(writer.pendingCount).toBe(0);
  });

  it("supports null and undefined checkpoints without interpreting them as an empty queue", async () => {
    const first = deferred();
    const write = vi.fn((data: null | undefined) =>
      data === null ? first.promise : Promise.resolve(),
    );
    const writer = new CheckpointWriter(write);
    const drain = writer.enqueue(null);
    writer.enqueue(undefined);
    expect(writer.pendingCount).toBe(2);
    first.resolve();
    await drain;
    expect(write.mock.calls).toEqual([[null], [undefined]]);
  });
});
