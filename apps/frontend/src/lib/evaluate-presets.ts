export const EVALUATE_MODEL_PRESET_IDS = [
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
] as const;

export const DEFAULT_EVALUATE_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_JUDGE_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_GENERATOR_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_ANALYSIS_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_TEST_COUNT = 10;
export const DEFAULT_REPETITIONS = 3;
export const DEFAULT_CONCURRENCY = 2;

const LABELS: Record<(typeof EVALUATE_MODEL_PRESET_IDS)[number], string> = {
  "llama-3.1-8b-instant": "Llama 3.1 8B Instant",
  "llama-3.3-70b-versatile": "Llama 3.3 70B Versatile",
  "openai/gpt-oss-120b": "GPT-OSS 120B",
  "openai/gpt-oss-20b": "GPT-OSS 20B",
};

const DESCRIPTIONS: Record<(typeof EVALUATE_MODEL_PRESET_IDS)[number], string> = {
  "llama-3.1-8b-instant": "Fastest preset on Groq",
  "llama-3.3-70b-versatile": "Higher-capacity Llama preset",
  "openai/gpt-oss-120b": "Best default evaluator balance",
  "openai/gpt-oss-20b": "Cheapest Groq text preset",
};

export const getEvaluatePresetLabel = (modelId: string): string =>
  LABELS[modelId as keyof typeof LABELS] ?? modelId;

export const getEvaluatePresetDescription = (modelId: string): string =>
  DESCRIPTIONS[modelId as keyof typeof DESCRIPTIONS] ?? "Preset evaluate model";
