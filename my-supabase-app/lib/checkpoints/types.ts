export type AgentCheckpointChangeKind = "create" | "update" | "delete";

export type AgentCheckpointChange = {
  path: string;
  kind: AgentCheckpointChangeKind;
  beforeText: string;
  afterText: string;
};

export type AgentCheckpointRecordInput = {
  anchorMessageId: string;
  changes: AgentCheckpointChange[];
  description?: string;
};

export type StoredCheckpointOperation = AgentCheckpointChange & {
  patch: string;
};

export type StoredCheckpoint = {
  id: string;
  createdAt: string;
  anchorMessageId: string;
  description: string;
  ops: StoredCheckpointOperation[];
};

export type StoredCheckpointState = {
  v: 1;
  projectId: string;
  sessionId: string;
  checkpoints: StoredCheckpoint[];
  headCheckpointId: string | null;
  headMessageId: string | null;
  updatedAt: string;
};

