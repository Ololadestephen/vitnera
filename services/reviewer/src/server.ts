import cors from "cors";
import express from "express";
import type { Address, Hex } from "viem";
import { ZodError } from "zod";
import { signReviewAttestation } from "./attestation.js";
import { loadConfig } from "./config.js";
import { createAIClient, runStructuredReview } from "./review.js";
import { createReviewRequestSchema } from "./schema.js";
import { privateKeyToAccount } from "viem/accounts";

const config = loadConfig();
const ai = createAIClient(config.AI_API_KEY, config.AI_BASE_URL);
const app = express();

app.disable("x-powered-by");
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.has(origin)) callback(null, true);
      else callback(new Error("Origin is not allowed"));
    },
    methods: ["GET", "POST"],
  }),
);
app.use(express.json({ limit: "5mb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "vitnera-reviewer" });
});

app.get("/identity", (_request, response) => {
  response.json({
    reviewer: privateKeyToAccount(config.REVIEWER_PRIVATE_KEY as Hex).address,
    chainId: config.BOTCHAIN_CHAIN_ID,
    contract: config.VITNERA_CONTRACT,
  });
});

app.post("/reviews", async (request, response, next) => {
  try {
    const parsed = createReviewRequestSchema.parse(request.body);
    const now = Math.floor(Date.now() / 1000);
    if (parsed.expiry <= now || parsed.expiry > now + 30 * 24 * 60 * 60) {
      response.status(400).json({ error: "Review expiry must be within the next 30 days" });
      return;
    }
    const report = await runStructuredReview(ai, config.AI_MODEL, parsed);
    const signed = await signReviewAttestation({
      request: parsed,
      report,
      privateKey: config.REVIEWER_PRIVATE_KEY as Hex,
      chainId: config.BOTCHAIN_CHAIN_ID,
      contract: config.VITNERA_CONTRACT as Address,
    });
    response.json({
      report,
      reviewer: signed.reviewer,
      signature: signed.signature,
      attestation: Object.fromEntries(
        Object.entries(signed.attestation).map(([key, value]) => [
          key,
          typeof value === "bigint" ? value.toString() : value,
        ]),
      ),
      privacy: {
        provider: config.AI_PROVIDER,
        notice:
          "Selected plaintext was submitted to the configured AI provider for this authorized review. Provider retention and abuse-monitoring policies may apply.",
      },
    });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    response.status(400).json({ error: "Invalid review request", issues: error.issues });
    return;
  }
  const message = error instanceof Error ? error.message : "Review failed";
  // Request bodies are deliberately excluded from logs because they contain authorized plaintext.
  console.error("Reviewer request failed:", message);
  response.status(500).json({ error: "The document review could not be completed" });
});

app.listen(config.REVIEWER_PORT, () => {
  console.log(`Vitnera reviewer listening on :${config.REVIEWER_PORT}`);
});
