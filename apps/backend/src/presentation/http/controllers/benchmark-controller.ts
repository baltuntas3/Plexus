import type { Request, RequestHandler, Response } from "express";
import {
  createBenchmarkSchema,
  listBenchmarksQuerySchema,
  updateTestCasesSchema,
} from "../../../application/dto/benchmark-dto.js";
import { UnauthorizedError, ValidationError } from "../../../domain/errors/domain-error.js";
import type { BenchmarkComposition } from "../../../composition/benchmark-composition.js";
import {
  toBenchmarkAnalysisDto,
  toBenchmarkDetailDto,
  toBenchmarkDto,
  toBenchmarkJudgeAnalysisDto,
} from "../mappers/benchmark-mappers.js";

const requireUserId = (req: Request): string => {
  if (!req.userId) throw UnauthorizedError();
  return req.userId;
};

const requireParam = (req: Request, name: string): string => {
  const value = req.params[name];
  if (!value) throw ValidationError(`Missing path parameter: ${name}`);
  return value;
};

export class BenchmarkController {
  constructor(private readonly benchmarks: BenchmarkComposition) {}

  create: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const input = createBenchmarkSchema.parse(req.body);
    const bm = await this.benchmarks.createBenchmark.execute({ ...input, ownerId });
    res.status(201).json({ benchmark: toBenchmarkDetailDto(bm, []) });
  };

  list: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const query = listBenchmarksQuerySchema.parse(req.query);
    const result = await this.benchmarks.listBenchmarks.execute({ ...query, ownerId });
    res.json({
      items: result.items.map(toBenchmarkDto),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    });
  };

  get: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const id = requireParam(req, "id");
    const { benchmark, results } = await this.benchmarks.getBenchmark.execute({
      benchmarkId: id,
      ownerId,
    });
    res.json({ benchmark: toBenchmarkDetailDto(benchmark, results) });
  };

  start: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const id = requireParam(req, "id");
    const result = await this.benchmarks.startBenchmark.execute({
      benchmarkId: id,
      ownerId,
    });
    res.status(202).json(result);
  };

  updateTestCases: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const id = requireParam(req, "id");
    const { updates } = updateTestCasesSchema.parse(req.body);
    await this.benchmarks.updateTestCases.execute({ benchmarkId: id, ownerId, updates });
    res.status(204).end();
  };

  analysis: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const id = requireParam(req, "id");
    const analysis = await this.benchmarks.getBenchmarkAnalysis.execute({
      benchmarkId: id,
      ownerId,
    });
    res.json({ analysis: toBenchmarkAnalysisDto(analysis) });
  };

  judgeAnalysis: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const id = requireParam(req, "id");
    const analysis = await this.benchmarks.getBenchmarkJudgeAnalysis.execute({
      benchmarkId: id,
      ownerId,
    });
    res.json({ analysis: toBenchmarkJudgeAnalysisDto(analysis) });
  };

  // SSE progress stream. Sends an initial snapshot, forwards queue progress
  // events until the benchmark reaches a terminal status, then closes the
  // connection. Auth is enforced at router level.
  stream: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const id = requireParam(req, "id");

    const snapshot = await this.benchmarks.getBenchmark.execute({
      benchmarkId: id,
      ownerId,
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

    send("snapshot", toBenchmarkDetailDto(snapshot.benchmark, snapshot.results));

    const bm = snapshot.benchmark;
    if (bm.status === "completed" || bm.status === "failed" || bm.status === "draft") {
      send("done", { status: bm.status });
      res.end();
      return;
    }

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

    // Poll the benchmark repo on a slow tick so we catch the terminal
    // transition (status + final progress) without relying on the queue
    // emitting a dedicated "completed" event.
    const interval = setInterval(async () => {
      try {
        const latest = await this.benchmarks.getBenchmark.execute({
          benchmarkId: id,
          ownerId,
        });
        if (
          latest.benchmark.status === "completed" ||
          latest.benchmark.status === "failed"
        ) {
          send(
            "snapshot",
            toBenchmarkDetailDto(latest.benchmark, latest.results),
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
