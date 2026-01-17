import crypto from "crypto";
import path from "path";

const SAFE_EXT_RE = /^\.[a-z0-9]+$/i;

function normalizeBaseName(fileName: string, ext: string) {
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  const normalized = base.normalize("NFKD");
  const slug = normalized
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const hash = crypto.createHash("sha256").update(fileName).digest("hex").slice(0, 10);
  return slug ? `${slug}_${hash}` : `file_${hash}`;
}

export function buildStoragePath(projectId: string, nodeId: string) {
  return `${projectId}/${nodeId}/blob`;
}

export function buildUploadStoragePath(projectId: string, nodeId: string, uploadId: string) {
  return `${projectId}/${nodeId}/uploads/${uploadId}`;
}

export function buildLegacyStoragePath(projectId: string, nodeId: string, fileName: string) {
  const ext = path.extname(fileName);
  const safeExt = SAFE_EXT_RE.test(ext) ? ext.toLowerCase() : "";
  const safeBase = normalizeBaseName(fileName, safeExt);
  return `${projectId}/${nodeId}/${safeBase}${safeExt}`;
}
