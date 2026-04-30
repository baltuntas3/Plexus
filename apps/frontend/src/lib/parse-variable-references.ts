// The grammar (regex + extractor) lives in @plexus/shared-types so backend,
// frontend and SDK cannot drift. Re-exported under the local name to keep
// existing imports stable.
export { extractVariableReferences as parseVariableReferences } from "@plexus/shared-types";
