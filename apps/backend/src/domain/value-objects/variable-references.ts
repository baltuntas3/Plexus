// The grammar (regex + extractor) lives in @plexus/shared-types so backend,
// frontend and SDK cannot drift. Re-exported here to keep domain imports
// cohesive: pure-TS dependency on shared-types is structural, not framework.
export { extractVariableReferences } from "@plexus/shared-types";
