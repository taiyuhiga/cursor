import type { StoredCheckpointState } from "@/lib/checkpoints/types";

const STORAGE_PREFIX = "cursor_checkpoints_v1";

const MAX_CHECKPOINTS_PER_SESSION = 20;
const MAX_CHECKPOINT_AGE_MS = 1000 * 60 * 60 * 24 * 2; // 2 days

function keyFor(sessionId: string) {
  return `${STORAGE_PREFIX}:${sessionId}`;
}

export function loadCheckpointState(sessionId: string): StoredCheckpointState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(keyFor(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCheckpointState;
    if (!parsed || parsed.v !== 1) return null;
    if (parsed.sessionId !== sessionId) return null;
    return pruneCheckpointState(parsed);
  } catch {
    return null;
  }
}

export function saveCheckpointState(state: StoredCheckpointState) {
  if (typeof window === "undefined") return;
  try {
    const pruned = pruneCheckpointState(state);
    window.localStorage.setItem(keyFor(state.sessionId), JSON.stringify(pruned));
  } catch {
    // ignore quota / JSON errors
  }
}

export function makeEmptyCheckpointState(params: { projectId: string; sessionId: string }): StoredCheckpointState {
  return {
    v: 1,
    projectId: params.projectId,
    sessionId: params.sessionId,
    checkpoints: [],
    headCheckpointId: null,
    headMessageId: null,
    updatedAt: new Date().toISOString(),
  };
}

export function pruneCheckpointState(state: StoredCheckpointState): StoredCheckpointState {
  const now = Date.now();
  const valid = (state.checkpoints || []).filter((cp) => {
    const t = Date.parse(cp.createdAt || "");
    if (!Number.isFinite(t)) return false;
    return now - t <= MAX_CHECKPOINT_AGE_MS;
  });

  const trimmed = valid.slice(Math.max(0, valid.length - MAX_CHECKPOINTS_PER_SESSION));

  const trimmedIds = new Set(trimmed.map((c) => c.id));
  let headCheckpointId = state.headCheckpointId ?? null;
  if (headCheckpointId !== null && !trimmedIds.has(headCheckpointId)) {
    headCheckpointId = trimmed.at(-1)?.id ?? null;
  }

  return {
    ...state,
    checkpoints: trimmed,
    headCheckpointId,
    updatedAt: new Date().toISOString(),
  };
}
