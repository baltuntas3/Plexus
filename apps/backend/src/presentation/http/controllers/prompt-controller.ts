import type { Request, RequestHandler, Response } from "express";
import {
  createPromptInputSchema,
  createVersionInputSchema,
  listPromptsQuerySchema,
  listVersionsQuerySchema,
  promoteVersionInputSchema,
} from "../../../application/dto/prompt-dto.js";
import { generateBraidInputSchema } from "../../../application/dto/braid-dto.js";
import { UnauthorizedError, ValidationError } from "../../../domain/errors/domain-error.js";
import type { PromptComposition } from "../../../composition/prompt-composition.js";
import {
  toBraidGraphDto,
  toGraphQualityScoreDto,
  toPromptDto,
  toPromptVersionDto,
} from "../mappers/prompt-mappers.js";

const requireUserId = (req: Request): string => {
  if (!req.userId) {
    throw UnauthorizedError();
  }
  return req.userId;
};

const requireParam = (req: Request, name: string): string => {
  const value = req.params[name];
  if (!value) {
    throw ValidationError(`Missing path parameter: ${name}`);
  }
  return value;
};

export class PromptController {
  constructor(private readonly prompts: PromptComposition) {}

  create: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const input = createPromptInputSchema.parse(req.body);
    const { prompt, version } = await this.prompts.createPrompt.execute({ ...input, ownerId });
    res.status(201).json({
      prompt: toPromptDto(prompt),
      version: toPromptVersionDto(version),
    });
  };

  list: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const query = listPromptsQuerySchema.parse(req.query);
    const result = await this.prompts.listPrompts.execute({ ...query, ownerId });
    res.json({
      items: result.items.map(toPromptDto),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    });
  };

  get: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const id = requireParam(req, "id");
    const prompt = await this.prompts.getPrompt.execute(id, ownerId);
    res.json({ prompt: toPromptDto(prompt) });
  };

  createVersion: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const id = requireParam(req, "id");
    const input = createVersionInputSchema.parse(req.body);
    const version = await this.prompts.createVersion.execute({
      ...input,
      promptId: id,
      ownerId,
    });
    res.status(201).json({ version: toPromptVersionDto(version) });
  };

  listVersions: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const id = requireParam(req, "id");
    const query = listVersionsQuerySchema.parse(req.query);
    const result = await this.prompts.listVersions.execute({
      ...query,
      promptId: id,
      ownerId,
    });
    res.json({
      items: result.items.map(toPromptVersionDto),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    });
  };

  getVersion: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const id = requireParam(req, "id");
    const version = requireParam(req, "version");
    const result = await this.prompts.getVersion.execute({
      promptId: id,
      version,
      ownerId,
    });
    res.json({ version: toPromptVersionDto(result) });
  };

  promoteVersion: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const id = requireParam(req, "id");
    const version = requireParam(req, "version");
    const input = promoteVersionInputSchema.parse(req.body);
    const updated = await this.prompts.promoteVersion.execute({
      ...input,
      promptId: id,
      version,
      ownerId,
    });
    res.json({ version: toPromptVersionDto(updated) });
  };

  generateBraid: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const id = requireParam(req, "id");
    const version = requireParam(req, "version");
    const input = generateBraidInputSchema.parse(req.body);
    const result = await this.prompts.generateBraid.execute({
      ...input,
      promptId: id,
      version,
      ownerId,
    });
    res.json({
      version: toPromptVersionDto(result.version),
      graph: toBraidGraphDto(result.graph),
      cached: result.cached,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalUsd: result.cost.totalUsd,
      },
      qualityScore: toGraphQualityScoreDto(result.qualityScore),
    });
  };

  lintVersion: RequestHandler = async (req: Request, res: Response) => {
    const ownerId = requireUserId(req);
    const id = requireParam(req, "id");
    const version = requireParam(req, "version");
    const score = await this.prompts.lintVersion.execute({
      promptId: id,
      version,
      ownerId,
    });
    res.json({ qualityScore: toGraphQualityScoreDto(score) });
  };

}
