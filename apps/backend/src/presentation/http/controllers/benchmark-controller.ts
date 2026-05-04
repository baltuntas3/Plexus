import type { Request, RequestHandler, Response } from "express";
import {
  createBenchmarkSchema,
  listBenchmarksQuerySchema,
  updateTestCasesSchema,
} from "../../../application/dto/benchmark-dto.js";
import type { BenchmarkComposition } from "../../../composition/benchmark-composition.js";
import {
  toBenchmarkAnalysisDto,
  toBenchmarkDetailDto,
  toBenchmarkDto,
} from "../mappers/benchmark-mappers.js";
import { getAuthContext, getRequiredParam } from "../utils/request-context.js";

export class BenchmarkController {
  constructor(private readonly benchmarks: BenchmarkComposition) {}

  create: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = getAuthContext(req);
    const input = createBenchmarkSchema.parse(req.body);
    const { benchmark, versionLabels } = await this.benchmarks.createBenchmark.execute({
      ...input,
      organizationId,
      userId,
    });
    res.status(201).json({ benchmark: toBenchmarkDetailDto(benchmark, [], versionLabels) });
  };

  list: RequestHandler = async (req: Request, res: Response) => {
    const { organizationId } = getAuthContext(req);
    const query = listBenchmarksQuerySchema.parse(req.query);
    const result = await this.benchmarks.listBenchmarks.execute({
      ...query,
      organizationId,
    });
    res.json({
      items: result.items.map(toBenchmarkDto),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    });
  };

  get: RequestHandler = async (req: Request, res: Response) => {
    const { organizationId } = getAuthContext(req);
    const id = getRequiredParam(req,"id");
    const { benchmark, results, versionLabels } = await this.benchmarks.getBenchmark.execute({
      benchmarkId: id,
      organizationId,
    });
    res.json({ benchmark: toBenchmarkDetailDto(benchmark, results, versionLabels) });
  };

  start: RequestHandler = async (req: Request, res: Response) => {
    const { organizationId } = getAuthContext(req);
    const id = getRequiredParam(req,"id");
    const result = await this.benchmarks.startBenchmark.execute({
      benchmarkId: id,
      organizationId,
    });
    res.status(202).json(result);
  };

  updateTestCases: RequestHandler = async (req: Request, res: Response) => {
    const { organizationId } = getAuthContext(req);
    const id = getRequiredParam(req,"id");
    const { updates, additions } = updateTestCasesSchema.parse(req.body);
    await this.benchmarks.updateTestCases.execute({
      benchmarkId: id,
      organizationId,
      updates,
      additions,
    });
    res.status(204).end();
  };

  analysis: RequestHandler = async (req: Request, res: Response) => {
    const { organizationId } = getAuthContext(req);
    const id = getRequiredParam(req,"id");
    const analysis = await this.benchmarks.getBenchmarkAnalysis.execute({
      benchmarkId: id,
      organizationId,
    });
    res.json({ analysis: toBenchmarkAnalysisDto(analysis) });
  };

  // SSE progress stream. Sends an initial snapshot, forwards queue progress
  // events until the benchmark reaches a terminal status, then closes the
  // connection. Auth is enforced at router level.
  stream: RequestHandler = async (req: Request, res: Response) => {
    const { organizationId } = getAuthContext(req);
    const id = getRequiredParam(req,"id");

    const snapshot = await this.benchmarks.getBenchmark.execute({
      benchmarkId: id,
      organizationId,
    });

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (event: string, payload: unknown): void => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    send(
      "snapshot",
      toBenchmarkDetailDto(snapshot.benchmark, snapshot.results, snapshot.versionLabels),
    );

    const bm = snapshot.benchmark;
    if (
      bm.status === "completed" ||
      bm.status === "completed_with_budget_cap" ||
      bm.status === "failed" ||
      bm.status === "draft"
    ) {
      send("done", { status: bm.status });
      res.end();
      return;
    }

    // The aggregate's jobId is set by the runner via `start(jobId)`, not by
    // the start use case, so a client opening this stream right after enqueue
    // can find `bm.jobId` still null. Subscribe when we can (low-latency fast
    // path) but do not depend on it — the polling loop below also emits
    // progress whenever the persisted benchmark advances, so the client
    // always sees ticks even if the queue's pubsub never fires.
    let unsubscribe: (() => void) | null = null;
    if (bm.jobId) {
      unsubscribe = this.benchmarks.queue.subscribeProgress(bm.jobId, (update) => {
        send("progress", {
          benchmarkId: bm.id,
          status: "running",
          progress: update,
        });
      });
    }

    let lastProgress = bm.progress;
    const interval = setInterval(async () => {
      try {
        const latest = await this.benchmarks.getBenchmark.execute({
          benchmarkId: id,
          organizationId,
        });
        const next = latest.benchmark.progress;
        if (
          next.completed !== lastProgress.completed ||
          next.total !== lastProgress.total
        ) {
          lastProgress = next;
          send("progress", {
            benchmarkId: latest.benchmark.id,
            status: latest.benchmark.status,
            progress: next,
          });
        }
        if (
          unsubscribe === null &&
          latest.benchmark.jobId &&
          latest.benchmark.status === "running"
        ) {
          // jobId showed up after the initial snapshot — attach the fast
          // path now so the rest of the run streams in real time.
          unsubscribe = this.benchmarks.queue.subscribeProgress(
            latest.benchmark.jobId,
            (update) => {
              send("progress", {
                benchmarkId: latest.benchmark.id,
                status: "running",
                progress: update,
              });
            },
          );
        }
        if (
          latest.benchmark.status === "completed" ||
          latest.benchmark.status === "completed_with_budget_cap" ||
          latest.benchmark.status === "failed"
        ) {
          send(
            "snapshot",
            toBenchmarkDetailDto(latest.benchmark, latest.results, latest.versionLabels),
          );
          send("done", { status: latest.benchmark.status });
          clearInterval(interval);
          unsubscribe?.();
          res.end();
        }
      } catch {
        clearInterval(interval);
        unsubscribe?.();
        res.end();
      }
    }, 1000);

    req.on("close", () => {
      clearInterval(interval);
      unsubscribe?.();
    });
  };
}
