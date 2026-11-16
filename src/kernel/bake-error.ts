export class BakeError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "BakeError";
    this.issues = issues.length > 0 ? issues : [message];
  }
}
