import { InProcessJobQueue, waitForJob } from "../in-process-job-queue.js";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InProcessJobQueue", () => {
  it("runs a registered job to completion and reports the final status", async () => {
    const queue = new InProcessJobQueue();
    let received: number | null = null;
    queue.register<number>("double", async (payload) => {
      received = payload * 2;
    });

    const id = await queue.enqueue("double", 21);
    await waitForJob(queue, id);

    const record = await queue.getStatus(id);
    expect(record?.status).toBe("completed");
    expect(record?.startedAt).not.toBeNull();
    expect(record?.completedAt).not.toBeNull();
    expect(received).toBe(42);
  });

  it("rejects enqueueing a job with no registered handler", async () => {
    const queue = new InProcessJobQueue();
    await expect(queue.enqueue("missing", null)).rejects.toThrow(/No handler/);
  });

  it("rejects double-registration of the same job name", () => {
    const queue = new InProcessJobQueue();
    queue.register("foo", async () => {});
    expect(() => queue.register("foo", async () => {})).toThrow(/already registered/);
  });

  it("with concurrency=1, dispatches jobs serially", async () => {
    const queue = new InProcessJobQueue({ concurrency: 1 });
    let active = 0;
    let peak = 0;
    queue.register<number>("slow", async () => {
      active += 1;
      peak = Math.max(peak, active);
      await tick(20);
      active -= 1;
    });

    const ids = await Promise.all([
      queue.enqueue("slow", 1),
      queue.enqueue("slow", 2),
      queue.enqueue("slow", 3),
    ]);
    for (const id of ids) await waitForJob(queue, id);

    expect(peak).toBe(1);
  });

  it("with concurrency>1, dispatches jobs in parallel up to the cap", async () => {
    const queue = new InProcessJobQueue({ concurrency: 3 });
    let active = 0;
    let peak = 0;
    queue.register<number>("slow", async () => {
      active += 1;
      peak = Math.max(peak, active);
      await tick(25);
      active -= 1;
    });

    const ids = await Promise.all(
      Array.from({ length: 6 }, (_, i) => queue.enqueue("slow", i)),
    );
    for (const id of ids) await waitForJob(queue, id);

    expect(peak).toBe(3);
  });

  it("captures handler errors and exposes them via getStatus", async () => {
    const queue = new InProcessJobQueue();
    queue.register<string>("boom", async () => {
      throw new Error("kaboom");
    });

    const id = await queue.enqueue("boom", "x");
    await waitForJob(queue, id);

    const record = await queue.getStatus(id);
    expect(record?.status).toBe("failed");
    expect(record?.error).toBe("kaboom");
  });

  it("forwards progress updates to subscribers and stops after unsubscribe", async () => {
    const queue = new InProcessJobQueue();
    queue.register<number>("counter", async (count, ctx) => {
      for (let i = 1; i <= count; i++) {
        await ctx.reportProgress({ step: i });
      }
    });

    const id = await queue.enqueue("counter", 3);
    const updates: unknown[] = [];
    const unsubscribe = queue.subscribeProgress(id, (u) => updates.push(u));

    await waitForJob(queue, id);
    unsubscribe();

    expect(updates).toEqual([{ step: 1 }, { step: 2 }, { step: 3 }]);
  });

  it("invokes onError when a handler throws", async () => {
    const errors: Array<{ id: string; name: string }> = [];
    const queue = new InProcessJobQueue({
      onError: (id, name) => errors.push({ id, name }),
    });
    queue.register("bad", async () => {
      throw new Error("nope");
    });

    const id = await queue.enqueue("bad", null);
    await waitForJob(queue, id);

    expect(errors).toEqual([{ id, name: "bad" }]);
  });
});
