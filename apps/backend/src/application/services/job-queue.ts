// Job queue port. Concrete implementations live under infrastructure/queue.
//
// Today: InProcessJobQueue (single Node process, in-memory state).
// Later: BullMQJobQueue when horizontal scaling or crash-resume becomes
// necessary. Callers depend only on this interface (DIP).

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export interface JobRecord {
  id: string;
  name: string;
  status: JobStatus;
  enqueuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
}

export interface JobContext {
  jobId: string;
  reportProgress(update: unknown): Promise<void>;
}

export type JobHandler<TPayload> = (
  payload: TPayload,
  ctx: JobContext,
) => Promise<void>;

export type ProgressListener = (update: unknown) => void;

export interface IJobQueue {
  register<TPayload>(jobName: string, handler: JobHandler<TPayload>): void;
  enqueue<TPayload>(jobName: string, payload: TPayload): Promise<string>;
  getStatus(jobId: string): Promise<JobRecord | null>;
  subscribeProgress(jobId: string, listener: ProgressListener): () => void;
}
