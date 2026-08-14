import { z } from "zod";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

for (const path of [resolve(process.cwd(), "../../.env"), resolve(process.cwd(), ".env")]) {
  try {
    loadEnvFile(path);
  } catch {
    // Deployment platforms inject environment variables directly, so a file is optional.
  }
}

const configSchema = z.object({
  AI_PROVIDER: z.enum(["groq", "openai"]).default("groq"),
  AI_API_KEY: z.string().min(1),
  AI_BASE_URL: z.string().url().optional(),
  AI_MODEL: z.string().min(1).optional(),
  REVIEWER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-f]{64}$/iu),
  REVIEWER_PORT: z.coerce.number().int().positive().default(8790),
  REVIEWER_ALLOWED_ORIGINS: z.string().default("http://localhost:5174"),
  BOTCHAIN_CHAIN_ID: z.coerce.number().int().positive().default(968),
  VITNERA_CONTRACT: z.string().regex(/^0x[0-9a-f]{40}$/iu),
});

type ParsedReviewerConfig = z.infer<typeof configSchema>;

export type ReviewerConfig = Omit<ParsedReviewerConfig, "AI_BASE_URL" | "AI_MODEL"> & {
  AI_BASE_URL: string;
  AI_MODEL: string;
  allowedOrigins: Set<string>;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ReviewerConfig {
  const parsed = configSchema.parse(env);
  const providerDefaults =
    parsed.AI_PROVIDER === "groq"
      ? { baseURL: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-20b" }
      : { baseURL: "https://api.openai.com/v1", model: "gpt-5-mini" };
  return {
    ...parsed,
    AI_BASE_URL: parsed.AI_BASE_URL ?? providerDefaults.baseURL,
    AI_MODEL: parsed.AI_MODEL ?? providerDefaults.model,
    allowedOrigins: new Set(
      parsed.REVIEWER_ALLOWED_ORIGINS.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  };
}
