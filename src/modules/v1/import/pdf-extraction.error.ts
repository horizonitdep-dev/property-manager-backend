/** Thrown when a single PDF can't be extracted — caught per-file by the batch
 * orchestrator so one bad PDF never sinks the rest of the batch (spec §10). */
export class PdfExtractionError extends Error {
  constructor(
    public readonly fileName: string,
    reason: string,
  ) {
    super(`Failed to extract ${fileName}: ${reason}`);
    this.name = 'PdfExtractionError';
  }
}
