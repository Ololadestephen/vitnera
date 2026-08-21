import type { RwaAssetType, RwaManifest } from "./schemas.js";

type EvidenceType = RwaManifest["documents"][number]["type"];

const assetLabels: Record<RwaAssetType, string> = {
  equipment: "equipment",
  real_estate: "real-estate",
  commodities: "commodity",
  receivables: "receivables",
  other: "real-world asset",
};

const evidenceLabels: Record<EvidenceType, string> = {
  asset_overview: "asset details",
  ownership_or_control: "ownership or control",
  valuation_or_financial: "financial evidence",
  supporting_document: "supporting evidence",
};

export function generatePrivatePublicSummary(input: {
  title: string;
  assetType: RwaAssetType;
  assetLocation?: string;
  evidenceTypes: EvidenceType[];
  evidenceCount: number;
}): string {
  const title = input.title.trim();
  if (!title) throw new Error("Add a room title before generating its summary");
  if (input.evidenceCount < 1) throw new Error("Add evidence before generating its summary");
  const location = input.assetLocation?.trim();
  const categories = Array.from(new Set(input.evidenceTypes.map((type) => evidenceLabels[type])));
  const coverage = categories.length > 0 ? ` covering ${formatList(categories)}` : "";
  const fileLabel = input.evidenceCount === 1 ? "file" : "files";
  return `${title} is a private ${assetLabels[input.assetType]} data room${location ? ` for ${location}` : ""}. It contains ${input.evidenceCount} encrypted evidence ${fileLabel}${coverage}. Supporting documents are available only through controlled access.`;
}

function formatList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "supporting evidence";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}
