/** Thrown by an importer's commitRows() when a specific row fails inside the commit transaction. */
export class ImportCommitRowError extends Error {
  constructor(
    public readonly rowNumber: number,
    public readonly reason: string,
  ) {
    super(`Row ${rowNumber} failed to commit: ${reason}`);
    this.name = 'ImportCommitRowError';
  }
}
