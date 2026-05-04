type LintSeverity = "info" | "warning" | "error";

export interface LintIssue {
  ruleId: string;
  severity: LintSeverity;
  message: string;
  nodeId?: string;
  edgeKey?: string;
}

export interface RuleResult {
  ruleId: string;
  displayName: string;
  score: number;
  issues: LintIssue[];
}

export class GraphQualityScore {
  constructor(
    public readonly overall: number,
    public readonly results: RuleResult[],
  ) {}

  get issues(): LintIssue[] {
    return this.results.flatMap((r) => r.issues);
  }

  static fromRuleResults(results: RuleResult[]): GraphQualityScore {
    if (results.length === 0) {
      return new GraphQualityScore(0, []);
    }
    const sum = results.reduce((acc, r) => acc + r.score, 0);
    return new GraphQualityScore(sum / results.length, results);
  }
}
