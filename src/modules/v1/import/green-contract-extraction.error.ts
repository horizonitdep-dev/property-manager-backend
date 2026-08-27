/**
 * A Green Contract PDF that could not be extracted.
 *
 * Carries the file name so a batch can report which of its PDFs failed and why,
 * rather than failing as a whole (spec §5.6).
 */
export class GreenContractExtractionError extends Error {
  constructor(
    readonly fileName: string,
    readonly reason: string,
  ) {
    super(`Failed to extract ${fileName}: ${reason}`);
    this.name = 'GreenContractExtractionError';
  }
}
