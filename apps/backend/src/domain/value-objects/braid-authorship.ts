import { ValidationError } from "../errors/domain-error.js";

// Provenance record for a BRAID artifact. Answers "who authored this graph?"
// in a way the old flat `generatorModel: string` cannot: a manual edit
// honestly reports `kind: "manual"` instead of naming the parent's model
// as if it had produced the content.
//
//   kind "model"  — an LLM ran and produced this graph end-to-end. `model`
//                   is the provider id that executed (e.g. "openai/gpt-oss-120b").
//   kind "manual" — a human edited the mermaid directly. `derivedFromModel`
//                   is the model name of the ancestor the edit started from
//                   (for audit lineage); null when the edit was seeded from
//                   an already-manual version with no further ancestor.
//
// External consumers that just want a display string use `displayModel`;
// consumers that need to distinguish (e.g. benchmark analysis filtering
// "only LLM-generated graphs") branch on `kind`.

interface ModelAuthorshipSnapshot {
  kind: "model";
  model: string;
}
interface ManualAuthorshipSnapshot {
  kind: "manual";
  derivedFromModel: string | null;
}
export type BraidAuthorshipSnapshot =
  | ModelAuthorshipSnapshot
  | ManualAuthorshipSnapshot;

export class BraidAuthorship {
  private constructor(private readonly value: BraidAuthorshipSnapshot) {}

  static byModel(model: string): BraidAuthorship {
    const trimmed = model.trim();
    if (trimmed.length === 0) {
      throw ValidationError("BraidAuthorship.byModel requires a non-empty model id");
    }
    return new BraidAuthorship({ kind: "model", model: trimmed });
  }

  static manual(derivedFromModel: string | null): BraidAuthorship {
    const trimmed = derivedFromModel?.trim() ?? "";
    return new BraidAuthorship({
      kind: "manual",
      derivedFromModel: trimmed.length > 0 ? trimmed : null,
    });
  }

  static fromSnapshot(snapshot: BraidAuthorshipSnapshot): BraidAuthorship {
    if (snapshot.kind === "model") {
      return BraidAuthorship.byModel(snapshot.model);
    }
    return BraidAuthorship.manual(snapshot.derivedFromModel);
  }

  get kind(): BraidAuthorshipSnapshot["kind"] {
    return this.value.kind;
  }

  // Convenience accessor for display / token-cost lookup / legacy callers.
  // Returns the model that actually ran on a "model" authorship; for manual
  // edits, falls back to the derived-from model (null if no ancestor was
  // recorded). Keeps the DTO's legacy `generatorModel` field populated
  // without re-introducing the provenance lie we just eliminated.
  get displayModel(): string | null {
    if (this.value.kind === "model") return this.value.model;
    return this.value.derivedFromModel;
  }

  toSnapshot(): BraidAuthorshipSnapshot {
    return { ...this.value };
  }

  equals(other: BraidAuthorship): boolean {
    if (this.value.kind !== other.value.kind) return false;
    if (this.value.kind === "model" && other.value.kind === "model") {
      return this.value.model === other.value.model;
    }
    if (this.value.kind === "manual" && other.value.kind === "manual") {
      return this.value.derivedFromModel === other.value.derivedFromModel;
    }
    return false;
  }
}
