// Document type detection utilities

const documentExtensions = {
  pdf: ["pdf"],
  excel: ["xlsx", "xls", "csv"],
  word: ["docx"],
  powerpoint: ["pptx"],
} as const;

// Old formats that have limited or no support
const legacyFormats = ["doc", "ppt"];

export type DocumentType =
  | "pdf"
  | "excel"
  | "word"
  | "powerpoint"
  | "legacy"
  | "unknown";

export function getDocumentType(fileName: string): DocumentType {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  if (documentExtensions.pdf.includes(ext as "pdf")) return "pdf";
  if (documentExtensions.excel.includes(ext as "xlsx" | "xls" | "csv"))
    return "excel";
  if (documentExtensions.word.includes(ext as "docx")) return "word";
  if (documentExtensions.powerpoint.includes(ext as "pptx"))
    return "powerpoint";
  if (legacyFormats.includes(ext)) return "legacy";

  return "unknown";
}

export function isDocumentFile(fileName: string): boolean {
  const type = getDocumentType(fileName);
  return type !== "unknown";
}

export function getDocumentExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() || "";
}
