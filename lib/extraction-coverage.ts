export type ExtractionCoverageDiagnostics = {
  rejectedNumberAssociations: string[];
  discardedQuestionNumbers: string[];
  uncoveredVisibleNumbers: string[];
  missingPageAuditPages: number[];
};

export function extractionCoverageFailures(diagnostics: ExtractionCoverageDiagnostics) {
  return [
    ...diagnostics.rejectedNumberAssociations,
    ...diagnostics.discardedQuestionNumbers.map((number) => `discarded-question:${number}`),
    ...diagnostics.uncoveredVisibleNumbers.map((number) => `uncovered-visible:${number}`),
    ...diagnostics.missingPageAuditPages.map((page) => `missing-page-audit:${page}`),
  ];
}
