import type {
  PromptVariableDto,
  VersionVariableChangeDto,
  VersionVariablesDiffDto,
} from "@plexus/shared-types";

// Pure function: compares two variable lists by name. Variables are a
// name-keyed set, so a "rename" is modelled as `removed` + `added`
// (the old name vanishes, the new name appears) rather than as a
// `changed` row. Same-name with different fields → `changed`.
//
// Result categories partition the union of names: every name appears
// in exactly one of {added, removed, changed, unchanged}.
export const computeVariablesDiff = (
  base: ReadonlyArray<PromptVariableDto>,
  target: ReadonlyArray<PromptVariableDto>,
): VersionVariablesDiffDto => {
  const baseByName = new Map(base.map((v) => [v.name, v]));
  const targetByName = new Map(target.map((v) => [v.name, v]));

  const added: PromptVariableDto[] = [];
  const removed: PromptVariableDto[] = [];
  const changed: VersionVariableChangeDto[] = [];
  const unchanged: PromptVariableDto[] = [];

  for (const v of target) {
    const baseVar = baseByName.get(v.name);
    if (!baseVar) {
      added.push(v);
    } else if (variablesEqual(baseVar, v)) {
      unchanged.push(v);
    } else {
      changed.push({ name: v.name, base: baseVar, target: v });
    }
  }
  for (const v of base) {
    if (!targetByName.has(v.name)) {
      removed.push(v);
    }
  }

  return { added, removed, changed, unchanged };
};

const variablesEqual = (a: PromptVariableDto, b: PromptVariableDto): boolean =>
  a.name === b.name
  && a.description === b.description
  && a.defaultValue === b.defaultValue
  && a.required === b.required;
