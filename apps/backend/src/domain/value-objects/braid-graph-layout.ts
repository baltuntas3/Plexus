import type { BraidGraphLayoutDto } from "@plexus/shared-types";
import { ValidationError } from "../errors/domain-error.js";
import { isValidNodeId } from "./braid-graph.js";

// Per-node display position for the visual editor. Stored separately
// from `BraidGraph` because the graph (nodes/edges/labels) is *content*
// and forks on edit, while layout is *presentation metadata* that the
// user can drag around without minting a new version. A version
// without a layout falls back to deterministic auto-layout in the
// frontend; saved positions take precedence node-by-node, so newly
// added nodes don't disrupt the existing layout.
export interface BraidNodePosition {
  nodeId: string;
  x: number;
  y: number;
}

// Reasonable bounds: layouts beyond ±50k are almost certainly bugs
// (number overflow, off-screen drift). Keeps storage shape sane.
const POSITION_BOUND = 50_000;

export class BraidGraphLayout {
  // Map keyed by nodeId so lookups are O(1) and duplicate nodeIds in
  // the input are rejected at construction. The internal shape is
  // immutable from the caller's perspective.
  private constructor(
    private readonly byNode: ReadonlyMap<string, { x: number; y: number }>,
  ) {}

  static fromPositions(positions: ReadonlyArray<BraidNodePosition>): BraidGraphLayout {
    const map = new Map<string, { x: number; y: number }>();
    for (const p of positions) {
      if (!isValidNodeId(p.nodeId)) {
        throw ValidationError(`Invalid layout nodeId: ${p.nodeId}`);
      }
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        throw ValidationError(
          `Layout position for ${p.nodeId} must have finite x/y`,
        );
      }
      if (Math.abs(p.x) > POSITION_BOUND || Math.abs(p.y) > POSITION_BOUND) {
        throw ValidationError(
          `Layout position for ${p.nodeId} exceeds ±${POSITION_BOUND}`,
        );
      }
      if (map.has(p.nodeId)) {
        throw ValidationError(`Duplicate layout entry for node ${p.nodeId}`);
      }
      map.set(p.nodeId, { x: p.x, y: p.y });
    }
    return new BraidGraphLayout(map);
  }

  static fromPrimitives(p: BraidGraphLayoutDto): BraidGraphLayout {
    return BraidGraphLayout.fromPositions(p.positions);
  }

  get size(): number {
    return this.byNode.size;
  }

  positionOf(nodeId: string): { x: number; y: number } | null {
    return this.byNode.get(nodeId) ?? null;
  }

  toPrimitives(): BraidGraphLayoutDto {
    return {
      positions: Array.from(this.byNode.entries()).map(([nodeId, p]) => ({
        nodeId,
        x: p.x,
        y: p.y,
      })),
    };
  }

  // Order-independent value equality: two layouts are equal iff every
  // (nodeId, x, y) entry matches. Used by the entity to skip persisting
  // a no-op layout update.
  equals(other: BraidGraphLayout): boolean {
    if (this.byNode.size !== other.byNode.size) return false;
    for (const [id, p] of this.byNode) {
      const o = other.byNode.get(id);
      if (!o || o.x !== p.x || o.y !== p.y) return false;
    }
    return true;
  }
}
