/**
 * Serializes durable writes while retaining at most the in-flight checkpoint
 * and the newest waiting checkpoint. Every enqueue within one drain shares
 * its completion promise, including callers whose waiting checkpoint was
 * superseded. A failed drain rejects together and can be retried by enqueue.
 */
export class CheckpointWriter<T> {
  private pending: { data: T } | null = null;
  private writing = false;
  private completion: Promise<void> | null = null;

  constructor(private readonly write: (data: T) => Promise<void>) {}

  get pendingCount(): number {
    return Number(this.writing) + Number(this.pending !== null);
  }

  enqueue(data: T): Promise<void> {
    this.pending = { data };
    if (this.completion) return this.completion;

    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const completion = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    this.completion = completion;
    // flush consumes all failures; only the public completion promise rejects.
    void this.flush(resolve, reject);
    return completion;
  }

  private async flush(
    resolve: () => void,
    reject: (reason: unknown) => void,
  ): Promise<void> {
    try {
      while (this.pending) {
        const checkpoint = this.pending;
        this.pending = null;
        this.writing = true;
        await this.write(checkpoint.data);
        this.writing = false;
      }
      this.completion = null;
      resolve();
    } catch (error) {
      // The simulation remains the source of the latest state. Do not write a
      // queued checkpoint after reporting failure; a new enqueue starts fresh.
      this.pending = null;
      this.writing = false;
      this.completion = null;
      reject(error);
    }
  }
}
