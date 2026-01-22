"use client";

import { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";

type ExcelViewerProps = {
  data: ArrayBuffer;
  fileName: string;
};

type SheetData = {
  name: string;
  data: (string | number | boolean | null)[][];
};

export function ExcelViewer({ data, fileName }: ExcelViewerProps) {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      setIsLoading(true);
      setError(null);

      const workbook = XLSX.read(data, { type: "array" });
      const parsedSheets: SheetData[] = workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name];
        const jsonData = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(
          sheet,
          { header: 1, defval: null }
        );
        return { name, data: jsonData };
      });

      setSheets(parsedSheets);
      setActiveSheet(0);
    } catch (err) {
      console.error("Excel parse error:", err);
      setError("Failed to parse Excel file");
    } finally {
      setIsLoading(false);
    }
  }, [data]);

  const currentSheet = useMemo(() => {
    return sheets[activeSheet] || null;
  }, [sheets, activeSheet]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-400">
        <div className="flex items-center gap-2">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>Loading spreadsheet...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-red-500">
        <div className="text-center">
          <p className="mb-2">{error}</p>
          <p className="text-sm opacity-70">{fileName}</p>
        </div>
      </div>
    );
  }

  if (!currentSheet || currentSheet.data.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-400">
        <p>No data in spreadsheet</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="flex items-center gap-1 px-2 py-1 bg-zinc-100 border-b border-zinc-200 overflow-x-auto">
          {sheets.map((sheet, index) => (
            <button
              key={sheet.name}
              onClick={() => setActiveSheet(index)}
              className={`px-3 py-1.5 text-sm rounded-t whitespace-nowrap transition-colors ${
                index === activeSheet
                  ? "bg-white text-zinc-900 border border-b-0 border-zinc-200"
                  : "text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      {/* Table content */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {currentSheet.data.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                className={rowIndex === 0 ? "bg-zinc-100 font-medium" : ""}
              >
                {/* Row number */}
                <td className="px-2 py-1 border border-zinc-200 bg-zinc-50 text-zinc-400 text-xs text-center min-w-[40px]">
                  {rowIndex + 1}
                </td>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={`px-2 py-1 border border-zinc-200 whitespace-nowrap ${
                      rowIndex === 0 ? "bg-zinc-100" : ""
                    }`}
                  >
                    {cell !== null && cell !== undefined ? String(cell) : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer info */}
      <div className="px-3 py-1.5 bg-zinc-50 border-t border-zinc-200 text-xs text-zinc-500">
        {currentSheet.data.length} rows
        {sheets.length > 1 && ` | ${sheets.length} sheets`}
      </div>
    </div>
  );
}
