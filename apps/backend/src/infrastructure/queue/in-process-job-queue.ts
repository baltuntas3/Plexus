import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  IJobQueue,
  JobContext,
  JobHandler,
  JobRecord,
  JobStatus,
  ProgressListener,
} from "../../application/services/job-queue.js";

interface InternalJob {
  record: JobRecord;
  payload: unknown;
}

export interface InProcessJobQueueConfig {
  /** Maximum number of jobs that can run simultaneously. Default: 1. */
  concurrency?: number;
  /** Optional logger hook for failures. */
  onError?: (jobId: string, jobName: string, err: unknown) => void;
}

// Single-process queue. Jobs are dispatched on a configurable concurrency cap;
// state is held in memory. Survives process lifetime only — restart loses
// queued/running jobs (callers persist their own domain state for resume).
export class InProcessJobQueue implements IJobQueue {
  private readonly handlers = new Map<string, JobHandler<unknown>>();
  private readonly jobs = new Map<string, InternalJob>();
  private readonly progress = new EventEmitter();
  private readonly waiting: string[] = [];
  private running = 0;
  private readonly concurrency: number;
  private readonly onError?: InProcessJobQueueConfig["onError"];

  constructor(config: InProcessJobQueueConfig = {}) {
    this.concurrency = Math.max(1, config.concurrency ?? 1);
    this.onError = config.onError;
    this.progress.setMaxListeners(0);
  }

  register<TPayload>(jobName: string, handler: JobHandler<TPayload>): void {
    if (this.handlers.has(jobName)) {
      throw new Error(`Job handler already registered for "${jobName}"`);
    }
    this.handlers.set(jobName, handler as JobHandler<unknown>);
  }

  async enqueue<TPayload>(jobName: string, payload: TPayload): Promise<string> {
    if (!this.handlers.has(jobName)) {
      throw new Error(`No handler registered for job "${jobName}"`);
    }
    const id = randomUUID();
    const record: JobRecord = {
      id,
      name: jobName,
      status: "queued",
      enqueuedAt: new Date(),
      startedAt: null,
      completedAt: null,
      error: null,
    };
    this.jobs.set(id, { record, payload });
    this.waiting.push(id);
    this.pump();
    return id;
  }

  async getStatus(jobId: string): Promise<JobRecord | null> {
    const job = this.jobs.get(jobId);
    return job ? { ...job.record } : null;
  }

  subscribeProgress(jobId: string, listener: ProgressListener): () => void {
    const channel = progressChannel(jobId);
    this.progress.on(channel, listener);
    return () => {
      this.progress.off(channel, listener);
    };
  }

  private pump(): void {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      const id = this.waiting.shift();
      if (!id) break;
      const job = this.jobs.get(id);
      if (!job) continue;
      this.running += 1;
      // Defer past the current microtask run so callers that did
      // `await enqueue(...)` have a chance to call subscribeProgress before
      // the handler emits its first update.
      setImmediate(() => {
        void this.run(job);
      });
    }
  }

  private async run(job: InternalJob): Promise<void> {
    const handler = this.handlers.get(job.record.name);
    if (!handler) {
      this.fail(job, new Error(`No handler for job "${job.record.name}"`));
      return;
    }

    job.record.status = "running";
    job.record.startedAt = new Date();

    const ctx: JobContext = {
      jobId: job.record.id,
      reportProgress: async (update) => {
        this.progress.emit(progressChannel(job.record.id), update);
      },
    };

    try {
      await handler(job.payload, ctx);
      job.record.status = "completed";
      job.record.completedAt = new Date();
    } catch (err) {
      this.fail(job, err);
    } finally {
      this.running -= 1;
      this.pump();
    }
  }

  private fail(job: InternalJob, err: unknown): void {
    job.record.status = "failed";
    job.record.completedAt = new Date();
    job.record.error = err instanceof Error ? err.message : String(err);
    this.onError?.(job.record.id, job.record.name, err);
  }
}

const progressChannel = (jobId: string): string => `progress:${jobId}`;

// Helper for tests / consumers that want to wait for a job to leave the
// running/queued state. Polls JobQueue.getStatus.
export const waitForJob = async (
  queue: IJobQueue,
  jobId: string,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<JobStatus> => {
  const interval = options.intervalMs ?? 5;
  const timeout = options.timeoutMs ?? 2000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const record = await queue.getStatus(jobId);
    if (record && (record.status === "completed" || record.status === "failed")) {
      return record.status;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`waitForJob: timeout after ${timeout}ms for ${jobId}`);
};
