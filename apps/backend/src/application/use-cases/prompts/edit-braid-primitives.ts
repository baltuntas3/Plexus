import type { BraidNodeKind, PromptVariableInput } from "@plexus/shared-types";
import type { BraidGraph } from "../../../domain/value-objects/braid-graph.js";
import { PromptVariable } from "../../../domain/value-objects/prompt-variable.js";
import type { IPromptRepository } from "../../../domain/repositories/prompt-aggregate-repository.js";
import type { IPromptVersionRepository } from "../../../domain/repositories/prompt-version-repository.js";
import type { IIdGenerator } from "../../../domain/services/id-generator.js";
import type { IUnitOfWork } from "../../../domain/services/unit-of-work.js";
import {
  forkVersionWithGraph,
  type ForkVersionWithGraphResult,
} from "../../services/braid/fork-version-with-graph.js";
import type { GraphLinter } from "../../services/braid/lint/graph-linter.js";
import { loadPromptVersionWithBraid } from "./load-version-with-braid.js";

// Six structural-edit primitives, all sharing the load → mutate →
// fork lifecycle. Each is its own use case (single execute() per
// primitive) so HTTP routes, tests, and permission gates stay one-
// to-one with the user-visible operation. The shared lifecycle lives
// in `runGraphEdit` below — composition over inheritance: each use
// case just describes the per-primitive mutation.

interface CommandBase {
  promptId: string;
  version: string;
  organizationId: string;
}

export interface PrimitiveDeps {
  prompts: IPromptRepository;
  versions: IPromptVersionRepository;
  linter: GraphLinter;
  idGenerator: IIdGenerator;
  uow: IUnitOfWork;
}

type EditBraidNodeResult = ForkVersionWithGraphResult;

// Shared lifecycle helper. The mutate callback receives the source's
// braid graph and returns the new graph plus optional `extra` payload
// (e.g. the auto-generated node id from `addNode`). The helper handles
// load + UoW + lint + fork; the use case only describes the mutation.
//
// `additionalVariables` powers the inline "create variable" flow in
// node-label primitives — the modal sends `PromptVariableInput[]` and
// the helper lifts each entry to a `PromptVariable` VO before
// forwarding to `forkVersionWithGraph`. `PromptVariable.create`
// already accepts the `PromptVariableInput` shape verbatim, so the
// lift is a thin map.
const runGraphEdit = async <Extra = undefined>(
  deps: PrimitiveDeps,
  command: CommandBase,
  mutate: (graph: BraidGraph) => { graph: BraidGraph; extra?: Extra },
  additionalVariables?: ReadonlyArray<PromptVariableInput>,
): Promise<ForkVersionWithGraphResult & { extra?: Extra }> => {
  return deps.uow.run(async () => {
    const { prompt, source, graph } = await loadPromptVersionWithBraid(
      deps.prompts,
      deps.versions,
      command.promptId,
      command.version,
      command.organizationId,
    );
    const { graph: newGraph, extra } = mutate(graph);
    const result = await forkVersionWithGraph({
      prompt,
      source,
      newGraph,
      linter: deps.linter,
      idGenerator: deps.idGenerator,
      versions: deps.versions,
      prompts: deps.prompts,
      additionalVariables: additionalVariables?.length
        ? additionalVariables.map((v) => PromptVariable.create(v))
        : undefined,
    });
    return { ...result, extra };
  });
};

interface RenameBraidNodeCommand extends CommandBase {
  nodeId: string;
  newLabel: string;
  // Variables to declare on the fork when the new label introduces
  // `{{var}}` references that aren't yet on the source. Empty/absent
  // = inherit source variables unchanged. Names already declared on
  // the source are silently ignored (idempotent).
  addVariables?: ReadonlyArray<PromptVariableInput>;
}

export class RenameBraidNodeUseCase {
  constructor(private readonly deps: PrimitiveDeps) {}
  async execute(command: RenameBraidNodeCommand): Promise<EditBraidNodeResult> {
    return runGraphEdit(
      this.deps,
      command,
      (g) => ({
        graph: g.renameNode(command.nodeId, command.newLabel),
      }),
      command.addVariables,
    );
  }
}

interface AddBraidNodeCommand extends CommandBase {
  label: string;
  kind: BraidNodeKind;
  // Variables to declare on the fork when the new label introduces
  // `{{var}}` references not yet on the source. See
  // `RenameBraidNodeCommand.addVariables` for semantics.
  addVariables?: ReadonlyArray<PromptVariableInput>;
}

interface AddBraidNodeResult extends EditBraidNodeResult {
  // Auto-generated mermaid id of the new node so the client can
  // immediately address it in follow-up edits without re-fetching the
  // whole graph.
  nodeId: string;
}

export class AddBraidNodeUseCase {
  constructor(private readonly deps: PrimitiveDeps) {}
  async execute(command: AddBraidNodeCommand): Promise<AddBraidNodeResult> {
    const out = await runGraphEdit<{ nodeId: string }>(
      this.deps,
      command,
      (g) => {
        const r = g.addNode(command.label, command.kind);
        return { graph: r.graph, extra: { nodeId: r.nodeId } };
      },
      command.addVariables,
    );
    return {
      newVersion: out.newVersion,
      qualityScore: out.qualityScore,
      nodeId: out.extra!.nodeId,
    };
  }
}

interface RemoveBraidNodeCommand extends CommandBase {
  nodeId: string;
}

export class RemoveBraidNodeUseCase {
  constructor(private readonly deps: PrimitiveDeps) {}
  async execute(command: RemoveBraidNodeCommand): Promise<EditBraidNodeResult> {
    return runGraphEdit(this.deps, command, (g) => ({
      graph: g.removeNode(command.nodeId),
    }));
  }
}

interface AddBraidEdgeCommand extends CommandBase {
  fromNodeId: string;
  toNodeId: string;
  label: string | null;
}

export class AddBraidEdgeUseCase {
  constructor(private readonly deps: PrimitiveDeps) {}
  async execute(command: AddBraidEdgeCommand): Promise<EditBraidNodeResult> {
    return runGraphEdit(this.deps, command, (g) => ({
      graph: g.addEdge(command.fromNodeId, command.toNodeId, command.label),
    }));
  }
}

interface RemoveBraidEdgeCommand extends CommandBase {
  fromNodeId: string;
  toNodeId: string;
  label: string | null;
}

export class RemoveBraidEdgeUseCase {
  constructor(private readonly deps: PrimitiveDeps) {}
  async execute(command: RemoveBraidEdgeCommand): Promise<EditBraidNodeResult> {
    return runGraphEdit(this.deps, command, (g) => ({
      graph: g.removeEdge(command.fromNodeId, command.toNodeId, command.label),
    }));
  }
}

interface RelabelBraidEdgeCommand extends CommandBase {
  fromNodeId: string;
  toNodeId: string;
  oldLabel: string | null;
  newLabel: string | null;
}

export class RelabelBraidEdgeUseCase {
  constructor(private readonly deps: PrimitiveDeps) {}
  async execute(command: RelabelBraidEdgeCommand): Promise<EditBraidNodeResult> {
    return runGraphEdit(this.deps, command, (g) => ({
      graph: g.relabelEdge(
        command.fromNodeId,
        command.toNodeId,
        command.oldLabel,
        command.newLabel,
      ),
    }));
  }
}
