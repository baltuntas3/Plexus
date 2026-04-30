import type { Request, RequestHandler, Response } from "express";
import {
  compareVersionsQuerySchema,
  createPromptInputSchema,
  createVersionInputSchema,
  listPromptsQuerySchema,
  listVersionsQuerySchema,
  promoteVersionInputSchema,
  updateVersionInputSchema,
} from "../../../application/dto/prompt-dto.js";
import {
  addBraidEdgeInputSchema,
  addBraidNodeInputSchema,
  braidChatInputSchema,
  braidGraphLayoutInputSchema,
  generateBraidInputSchema,
  relabelBraidEdgeInputSchema,
  removeBraidEdgeInputSchema,
  renameBraidNodeInputSchema,
  saveBraidFromChatInputSchema,
  updateBraidInputSchema,
} from "../../../application/dto/braid-dto.js";
import { toBraidGraphDto } from "../../../application/queries/braid-graph-projections.js";
import type { PromptComposition } from "../../../composition/prompt-composition.js";
import {
  toGraphQualityScoreDto,
  toPromptDto,
  toPromptVersionDto,
} from "../mappers/prompt-mappers.js";
import { getAuthContext, getRequiredParam } from "../utils/request-context.js";

export class PromptController {
  constructor(private readonly prompts: PromptComposition) {}

  create: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = getAuthContext(req);
    const input = createPromptInputSchema.parse(req.body);
    const { prompt, version } = await this.prompts.createPrompt.execute({
      ...input,
      organizationId,
      userId,
    });
    res.status(201).json({
      prompt: toPromptDto(prompt),
      version: toPromptVersionDto(version),
    });
  };

  list: RequestHandler = async (req: Request, res: Response) => {
    const { organizationId } = getAuthContext(req);
    const query = listPromptsQuerySchema.parse(req.query);
    const result = await this.prompts.listPrompts.execute({
      ...query,
      organizationId,
    });
    res.json({
      items: result.items.map(toPromptDto),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    });
  };

  get: RequestHandler = async (req: Request, res: Response) => {
    const { organizationId } = getAuthContext(req);
    const id = getRequiredParam(req,"id");
    const prompt = await this.prompts.getPrompt.execute(id, organizationId);
    res.json({ prompt: toPromptDto(prompt) });
  };

  createVersion: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = getAuthContext(req);
    const id = getRequiredParam(req,"id");
    const input = createVersionInputSchema.parse(req.body);
    const version = await this.prompts.createVersion.execute({
      ...input,
      promptId: id,
      organizationId,
      userId,
    });
    res.status(201).json({ version: toPromptVersionDto(version) });
  };

  listVersions: RequestHandler = async (req: Request, res: Response) => {
    const { organizationId } = getAuthContext(req);
    const id = getRequiredParam(req,"id");
    const query = listVersionsQuerySchema.parse(req.query);
    const result = await this.prompts.listVersions.execute({
      ...query,
      promptId: id,
      organizationId,
    });
    res.json({
      items: result.items.map(toPromptVersionDto),
      total: result.total,
      page: query.page,
      pageSize: query.pageSize,
    });
  };

  getVersion: RequestHandler = async (req: Request, res: Response) => {
    const { organizationId } = getAuthContext(req);
    const id = getRequiredParam(req,"id");
    const version = getRequiredParam(req,"version");
    const result = await this.prompts.getVersion.execute({
      promptId: id,
      version,
      organizationId,
    });
    res.json({ version: toPromptVersionDto(result) });
  };

  promoteVersion: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = getAuthContext(req);
    const id = getRequiredParam(req,"id");
    const version = getRequiredParam(req,"version");
    const input = promoteVersionInputSchema.parse(req.body);
    const updated = await this.prompts.promoteVersion.execute({
      ...input,
      promptId: id,
      version,
      organizationId,
      userId,
    });
    res.json({ version: toPromptVersionDto(updated) });
  };

  updateVersionName: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = getAuthContext(req);
    const id = getRequiredParam(req,"id");
    const version = getRequiredParam(req,"version");
    const input = updateVersionInputSchema.parse(req.body);
    const updated = await this.prompts.updateVersionName.execute({
      ...input,
      promptId: id,
      version,
      organizationId,
      userId,
    });
    res.json({ version: toPromptVersionDto(updated) });
  };

  generateBraid: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = getAuthContext(req);
    const id = getRequiredParam(req,"id");
    const version = getRequiredParam(req,"version");
    const input = generateBraidInputSchema.parse(req.body);
    const result = await this.prompts.generateBraid.execute({
      ...input,
      promptId: id,
      version,
      organizationId,
      userId,
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
    const { userId, organizationId } = getAuthContext(req);
    const id = getRequiredParam(req,"id");
    const version = getRequiredParam(req,"version");
    const score = await this.prompts.lintVersion.execute({
      promptId: id,
      version,
      organizationId,
      userId,
    });
    res.json({ qualityScore: toGraphQualityScoreDto(score) });
  };

  updateBraid: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = getAuthContext(req);
    const id = getRequiredParam(req,"id");
    const version = getRequiredParam(req,"version");
    const input = updateBraidInputSchema.parse(req.body);
    const result = await this.prompts.updateBraidGraph.execute({
      ...input,
      promptId: id,
      version,
      organizationId,
      userId,
    });
    res.json({
      newVersion: result.newVersion,
      qualityScore: toGraphQualityScoreDto(result.qualityScore),
    });
  };

  // Stateless multi-turn BRAID chat. Caller sends prior `history` and a
  // new `userMessage` every turn; backend never persists transcripts.
  // Persistence happens via `saveBraidFromChat` when the user clicks
  // "Save this version" on a suggestion.
  braidChat: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = getAuthContext(req);
    const id = getRequiredParam(req, "id");
    const version = getRequiredParam(req, "version");
    const input = braidChatInputSchema.parse(req.body);
    const result = await this.prompts.braidChat.execute({
      ...input,
      promptId: id,
      version,
      organizationId,
      userId,
    });
    if (result.type === "question") {
      res.json({
        type: "question",
        question: result.question,
        usage: { totalUsd: result.cost.totalUsd },
      });
      return;
    }
    res.json({
      type: "diagram",
      mermaidCode: result.mermaidCode,
      qualityScore: toGraphQualityScoreDto(result.qualityScore),
      usage: { totalUsd: result.cost.totalUsd },
    });
  };

  saveBraidFromChat: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = getAuthContext(req);
    const id = getRequiredParam(req, "id");
    const version = getRequiredParam(req, "version");
    const input = saveBraidFromChatInputSchema.parse(req.body);
    const result = await this.prompts.saveBraidFromChat.execute({
      ...input,
      promptId: id,
      version,
      organizationId,
      userId,
    });
    res.status(201).json({
      newVersion: result.newVersion,
      qualityScore: toGraphQualityScoreDto(result.qualityScore),
    });
  };

  // ── Visual-editor structural-edit primitives ─────────────────────────────
  // Each primitive forks a new draft version with a single structural
  // mutation applied. Frontend visual editor calls these one-at-a-time
  // (rename click, add node from menu, drag-edge); for whole-graph
  // replacement the text-mode editor still goes through `updateBraid`.

  renameBraidNode: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = getAuthContext(req);
    const id = getRequiredParam(req, "id");
    const version = getRequiredParam(req, "version");
    const nodeId = getRequiredParam(req, "nodeId");
    const input = renameBraidNodeInputSchema.parse(req.body);
    const result = await this.prompts.renameBraidNode.execute({
      promptId: id,
      version,
      organizationId,
      userId,
      nodeId,
      newLabel: input.newLabel,
      addVariables: input.addVariables,
    });
    res.status(201).json({
      newVersion: result.newVersion,
      qualityScore: toGraphQualityScoreDto(result.qualityScore),
    });
  };

  addBraidNode: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = getAuthContext(req);
    const id = getRequiredParam(req, "id");
    const version = getRequiredParam(req, "version");
    const input = addBraidNodeInputSchema.parse(req.body);
    const result = await this.prompts.addBraidNode.execute({
      promptId: id,
      version,
      organizationId,
      userId,
      label: input.label,
      kind: input.kind,
      addVariables: input.addVariables,
    });
    res.status(201).json({
      newVersion: result.newVersion,
      nodeId: result.nodeId,
      qualityScore: toGraphQualityScoreDto(result.qualityScore),
    });
  };

  removeBraidNode: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = getAuthContext(req);
    const id = getRequiredParam(req, "id");
    const version = getRequiredParam(req, "version");
    const nodeId = getRequiredParam(req, "nodeId");
    const result = await this.prompts.removeBraidNode.execute({
      promptId: id,
      version,
      organizationId,
      userId,
      nodeId,
    });
    res.status(201).json({
      newVersion: result.newVersion,
      qualityScore: toGraphQualityScoreDto(result.qualityScore),
    });
  };

  addBraidEdge: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = getAuthContext(req);
    const id = getRequiredParam(req, "id");
    const version = getRequiredParam(req, "version");
    const input = addBraidEdgeInputSchema.parse(req.body);
    const result = await this.prompts.addBraidEdge.execute({
      promptId: id,
      version,
      organizationId,
      userId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      label: input.label ?? null,
    });
    res.status(201).json({
      newVersion: result.newVersion,
      qualityScore: toGraphQualityScoreDto(result.qualityScore),
    });
  };

  removeBraidEdge: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = getAuthContext(req);
    const id = getRequiredParam(req, "id");
    const version = getRequiredParam(req, "version");
    const input = removeBraidEdgeInputSchema.parse(req.body);
    const result = await this.prompts.removeBraidEdge.execute({
      promptId: id,
      version,
      organizationId,
      userId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      label: input.label ?? null,
    });
    res.status(201).json({
      newVersion: result.newVersion,
      qualityScore: toGraphQualityScoreDto(result.qualityScore),
    });
  };

  relabelBraidEdge: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = getAuthContext(req);
    const id = getRequiredParam(req, "id");
    const version = getRequiredParam(req, "version");
    const input = relabelBraidEdgeInputSchema.parse(req.body);
    const result = await this.prompts.relabelBraidEdge.execute({
      promptId: id,
      version,
      organizationId,
      userId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      oldLabel: input.oldLabel ?? null,
      newLabel: input.newLabel ?? null,
    });
    res.status(201).json({
      newVersion: result.newVersion,
      qualityScore: toGraphQualityScoreDto(result.qualityScore),
    });
  };

  // Side-by-side comparison between two versions of the same prompt.
  // Body and graph diffs are rendered client-side (Monaco DiffEditor /
  // mermaid-text diff); the server pre-computes only the variables
  // diff because its name-set semantics are non-trivial.
  compareVersions: RequestHandler = async (req: Request, res: Response) => {
    const { organizationId } = getAuthContext(req);
    const promptId = getRequiredParam(req, "id");
    const query = compareVersionsQuerySchema.parse(req.query);
    const result = await this.prompts.compareVersions.execute({
      promptId,
      organizationId,
      baseVersion: query.base,
      targetVersion: query.target,
    });
    res.json({
      comparison: {
        base: toPromptVersionDto(result.base),
        target: toPromptVersionDto(result.target),
        variablesDiff: result.variablesDiff,
      },
    });
  };

  // Saves visual-editor node positions in place — no fork. 204 because
  // there's no payload worth returning: the request already carries
  // the positions, and the client controls the in-memory layout state.
  updateBraidGraphLayout: RequestHandler = async (req: Request, res: Response) => {
    const { userId, organizationId } = getAuthContext(req);
    const id = getRequiredParam(req, "id");
    const version = getRequiredParam(req, "version");
    const input = braidGraphLayoutInputSchema.parse(req.body);
    await this.prompts.updateBraidGraphLayout.execute({
      promptId: id,
      version,
      organizationId,
      userId,
      positions: input.positions,
    });
    res.status(204).end();
  };

}
