import { z } from "zod";
import { BRAID_NODE_KINDS } from "@plexus/shared-types";
import { promptVariableInputSchema } from "./prompt-dto.js";

export const generateBraidInputSchema = z.object({
  generatorModel: z.string().min(1),
  forceRegenerate: z.boolean().optional().default(false),
});
export type GenerateBraidInputDto = z.infer<typeof generateBraidInputSchema>;

export const updateBraidInputSchema = z.object({
  mermaidCode: z.string().min(1),
});

// Frontend maintains the conversation in memory and sends the full
// prior history with each turn. Hard limits are encoded as constants
// here so the boundary schema and the `BraidChatUseCase`'s defense-in-
// depth check share the same numbers — change one place, both layers
// follow.
export const MAX_BRAID_CHAT_HISTORY_MESSAGES = 50;
// ~30k tokens × 4 chars/token: a coarse ceiling that catches runaway
// payloads before they reach the LLM. Per-array-sum constraints are
// awkward in Zod, so the boundary only checks message count; the
// total-character ceiling is enforced inside the use case.
export const MAX_BRAID_CHAT_TOTAL_CHARACTERS = 30_000 * 4;
const PER_MESSAGE_CHAR_LIMIT = 20_000;

const braidChatTurnSchema = z.object({
  role: z.enum(["user", "agent"]),
  content: z.string().min(1).max(PER_MESSAGE_CHAR_LIMIT),
});

export const braidChatInputSchema = z.object({
  history: z.array(braidChatTurnSchema).max(MAX_BRAID_CHAT_HISTORY_MESSAGES),
  userMessage: z.string().min(1).max(PER_MESSAGE_CHAR_LIMIT),
  generatorModel: z.string().min(1),
});

export const saveBraidFromChatInputSchema = z.object({
  mermaidCode: z.string().min(1),
  generatorModel: z.string().min(1),
});

// Visual-editor structural-edit primitives. Length bounds mirror the
// domain `BraidGraph` mutation guards so a malformed payload fails at
// the boundary rather than after a UoW round-trip.
const BRAID_NODE_LABEL_MAX = 200;
const BRAID_EDGE_LABEL_MAX = 80;
// Node ids on existing graphs come from the parser/serializer (e.g.
// `N3`, `Start`); the regex matches the domain `NODE_ID` rule.
const braidNodeIdSchema = z
  .string()
  .regex(/^[A-Za-z][\w-]*$/, "Invalid BRAID node id");

// Optional `addVariables` powers the inline "create variable" flow:
// when the user types `{{newVar}}` in a node label and selects the
// create option, the modal sends the new declarations along with the
// structural mutation so the fork carries the merged variable list.
const addVariablesField = z
  .array(promptVariableInputSchema)
  .max(50)
  .optional();

export const renameBraidNodeInputSchema = z.object({
  newLabel: z.string().trim().min(1).max(BRAID_NODE_LABEL_MAX),
  addVariables: addVariablesField,
});

export const addBraidNodeInputSchema = z.object({
  label: z.string().trim().min(1).max(BRAID_NODE_LABEL_MAX),
  kind: z.enum(BRAID_NODE_KINDS),
  addVariables: addVariablesField,
});

// Add/Remove/Relabel edge share `from + to + label` shape; relabel
// adds `newLabel`. Optional labels arrive as either omitted or
// explicit `null`; the schema accepts both and the use case treats
// empty/whitespace-only labels as null (see `normaliseEdgeLabel`).
const edgeLabelSchema = z
  .string()
  .trim()
  .max(BRAID_EDGE_LABEL_MAX)
  .nullable()
  .optional();

export const addBraidEdgeInputSchema = z.object({
  fromNodeId: braidNodeIdSchema,
  toNodeId: braidNodeIdSchema,
  label: edgeLabelSchema,
});

export const removeBraidEdgeInputSchema = z.object({
  fromNodeId: braidNodeIdSchema,
  toNodeId: braidNodeIdSchema,
  label: edgeLabelSchema,
});

export const relabelBraidEdgeInputSchema = z.object({
  fromNodeId: braidNodeIdSchema,
  toNodeId: braidNodeIdSchema,
  oldLabel: edgeLabelSchema,
  newLabel: edgeLabelSchema,
});

// Visual-editor layout persistence. Each entry is one node's saved
// `(x, y)` coordinates. Empty `positions` array clears the saved
// layout. Range bounds (±50_000) and nodeId regex are enforced inside
// the `BraidGraphLayout` VO; the schema does loose shape validation
// only — `.max(500)` is a sanity ceiling against runaway payloads
// since real graphs are well under 100 nodes.
export const braidGraphLayoutInputSchema = z.object({
  positions: z
    .array(
      z.object({
        nodeId: braidNodeIdSchema,
        x: z.number(),
        y: z.number(),
      }),
    )
    .max(500),
});
