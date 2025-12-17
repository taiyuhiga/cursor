export type LineReviewStatus = "pending" | "accepted" | "rejected";

export type PendingChange = {
  id: string;
  filePath: string;
  fileName: string;
  oldContent: string;
  newContent: string;
  action: "create" | "update" | "delete";
  status: LineReviewStatus;
  lineStatuses?: Record<number, LineReviewStatus>;
};

export type ReviewIssueSeverity = "high" | "medium" | "low";

export type ReviewIssue = {
  id: string;
  filePath: string;
  title: string;
  description: string;
  severity: ReviewIssueSeverity;
  startLine?: number;
  endLine?: number;
  /**
   * Optional prompt to send back to the agent to fix this issue.
   * Keep it short and file-scoped when possible.
   */
  fixPrompt?: string;
  status: "open" | "dismissed" | "fixed";
};

