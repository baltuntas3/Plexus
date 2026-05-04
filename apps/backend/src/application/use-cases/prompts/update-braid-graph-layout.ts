import { ValidationError } from "../../../domain/errors/domain-error.js";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import { BraidGraphLayout } from "../../../domain/value-objects/braid-graph-layout.js";
import { loadPromptAndVersionInOrganization } from "./load-owned-prompt.js";

export interface UpdateBraidGraphLayoutCommand {
  promptId: string;
  version: string;
  organizationId: string;
  // Positions for nodes the user has dragged. Empty array clears the
  // saved layout (frontend reverts to deterministic auto-layout).
  positions: ReadonlyArray<{ nodeId: string; x: number; y: number }>;
}

// Persists visual-editor node positions in place — no fork, no new
// version. Layout is presentation metadata: dragging a node doesn't
// change graph identity (nodes/edges/labels) so saving doesn't bloat
// version history. Concurrent structural edits FORK to a new version,
// so the only collision case here is two users dragging the same
// version simultaneously; optimistic concurrency on `revision` catches
// that.
export class UpdateBraidGraphLayoutUseCase {
  constructor(
    private readonly prompts: IPromptRepository,
    private readonly versions: IPromptVersionRepository,
  ) {}

  async execute(command: UpdateBraidGraphLayoutCommand): Promise<void> {
    const { version: source } = await loadPromptAndVersionInOrganization(
      this.prompts,
      this.versions,
      command.promptId,
      command.version,
      command.organizationId,
    );
    const graph = source.braidGraph;
    if (!graph) {
      // Layout for a version that has no graph would be dead data —
      // every position references a non-existent node. Reject so the
      // client can surface "create a graph first".
      throw ValidationError(
        "Cannot save layout for a version that has no BRAID graph",
      );
    }

    // VO construction runs first so shape errors (regex, finite,
    // bounds, duplicates) surface before the cross-field check. Empty
    // positions = clear saved layout; the frontend's auto-layout
    // covers all nodes from there on.
    const layout =
      command.positions.length === 0
        ? null
        : BraidGraphLayout.fromPositions(
            command.positions.map((p) => ({ nodeId: p.nodeId, x: p.x, y: p.y })),
          );

    // Cross-field rule: every position's nodeId must reference a node
    // that actually exists in this version's graph. Frontend bugs or
    // stale requests would otherwise persist orphan entries — silently
    // ignored at render time, but they hide the underlying defect and
    // bloat storage over edits.
    if (layout) {
      const knownNodeIds = new Set(graph.nodes.map((n) => n.id));
      const unknown = command.positions
        .map((p) => p.nodeId)
        .filter((id) => !knownNodeIds.has(id));
      if (unknown.length > 0) {
        throw ValidationError(
          `Layout references nodes not in the graph: ${unknown.join(", ")}`,
        );
      }
    }

    source.setBraidGraphLayout(layout);
    await this.versions.save(source);
  }
}
