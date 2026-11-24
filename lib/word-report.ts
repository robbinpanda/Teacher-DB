import { getFile, putFile } from "./file-storage";
import type { WordImportSummary } from "./word-mime";

type ParseReport = {
  formulas: Record<string, { converted: number; review: number }>;
  reviewFormulas: number;
  images: number;
  imagesUnreadable: number;
  textBoxes: number;
  warnings: string[];
  formulaImages?: number;
  layout?: "flow" | "positioned";
  convertedFrom?: string | null;
};

export function wordReportKey(documentId: string) {
  return `documents/${documentId}/word/report.json`;
}

export function summarizeWordReport(report: ParseReport): WordImportSummary {
  const count = (source: string) => (report.formulas[source]?.converted ?? 0) + (report.formulas[source]?.review ?? 0);
  return {
    formulas: count("mathtype") + count("omml"),
    mathtype: count("mathtype"),
    omml: count("omml"),
    reviewFormulas: report.reviewFormulas,
    images: report.images,
    imagesUnreadable: report.imagesUnreadable,
    textBoxes: report.textBoxes,
    warnings: report.warnings.slice(0, 8),
    formulaImages: report.formulaImages ?? 0,
    layout: report.layout ?? "flow",
    convertedFromDoc: report.convertedFrom === "doc",
  };
}

export async function saveWordSummary(documentId: string, report: ParseReport) {
  await putFile(wordReportKey(documentId), new TextEncoder().encode(JSON.stringify(summarizeWordReport(report))));
}

export async function loadWordSummary(documentId: string): Promise<WordImportSummary | null> {
  try {
    const value = JSON.parse(new TextDecoder().decode(await getFile(wordReportKey(documentId)))) as WordImportSummary;
    return typeof value.formulas === "number" && Array.isArray(value.warnings) ? value : null;
  } catch {
    return null;
  }
}
