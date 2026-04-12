export type LintSeverity = "info" | "warning" | "error";

export interface LintIssueDto {
  ruleId: string;
  severity: LintSeverity;
  message: string;
  nodeId?: string;
  edgeKey?: string;
}

export interface RuleResultDto {
  ruleId: string;
  displayName: string;
  score: number;
  issues: LintIssueDto[];
}

export interface GraphQualityScoreDto {
  overall: number;
  results: RuleResultDto[];
}

export interface LintVersionResponse {
  qualityScore: GraphQualityScoreDto;
}
