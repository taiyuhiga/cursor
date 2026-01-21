"use client";

import Editor, { BeforeMount, OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState, useCallback } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  fileName: string;
  onSave?: () => void;
  onAddToChat?: (selectedText: string, lineStart: number, lineEnd: number) => void;
};

type PopupPosition = {
  top: number;
  left: number;
} | null;

function getLanguage(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "py":
      return "python";
    case "md":
      return "markdown";
    case "css":
      return "css";
    case "html":
    case "htm":
      return "html";
    case "json":
      return "json";
    case "sql":
      return "sql";
    default:
      return "plaintext";
  }
}

export function MainEditor({ value, onChange, fileName, onSave, onAddToChat }: Props) {
  const editorRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onSaveRef = useRef(onSave);
  const onAddToChatRef = useRef(onAddToChat);
  const isMarkdown = fileName.toLowerCase().endsWith(".md");
  const isApplyingAutoCloseRef = useRef(false);

  const [popupPosition, setPopupPosition] = useState<PopupPosition>(null);
  const [selectedText, setSelectedText] = useState("");
  const [selectionRange, setSelectionRange] = useState<{ startLine: number; endLine: number } | null>(null);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    onAddToChatRef.current = onAddToChat;
  }, [onAddToChat]);

  const handleAddToChat = useCallback(() => {
    if (selectedText && selectionRange && onAddToChatRef.current) {
      onAddToChatRef.current(selectedText, selectionRange.startLine, selectionRange.endLine);
    }
    setPopupPosition(null);
  }, [selectedText, selectionRange]);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Cmd+S / Ctrl+S のバインディング
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.();
    });

    // Cmd+L / Ctrl+L でチャットに追加
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyL, () => {
      const selection = editor.getSelection();
      if (selection && !selection.isEmpty()) {
        const model = editor.getModel();
        if (model) {
          const text = model.getValueInRange(selection);
          if (text && onAddToChatRef.current) {
            onAddToChatRef.current(text, selection.startLineNumber, selection.endLineNumber);
          }
        }
      }
    });

    // 選択変更時のハンドラ
    editor.onDidChangeCursorSelection((e) => {
      const selection = e.selection;

      if (selection.isEmpty()) {
        setPopupPosition(null);
        setSelectedText("");
        setSelectionRange(null);
        return;
      }

      const model = editor.getModel();
      if (!model) return;

      // 最低1行以上の選択が必要
      const isMultiLine = selection.startLineNumber < selection.endLineNumber;
      const isSingleLineFullSelection =
        selection.startLineNumber === selection.endLineNumber &&
        selection.startColumn === 1 &&
        selection.endColumn > model.getLineLength(selection.startLineNumber);

      if (!isMultiLine && !isSingleLineFullSelection) {
        setPopupPosition(null);
        setSelectedText("");
        setSelectionRange(null);
        return;
      }

      const text = model.getValueInRange(selection);
      if (!text.trim()) {
        setPopupPosition(null);
        setSelectedText("");
        setSelectionRange(null);
        return;
      }

      setSelectedText(text);
      setSelectionRange({
        startLine: selection.startLineNumber,
        endLine: selection.endLineNumber,
      });

      // ポップアップの位置を計算（選択終了位置の近く）
      const endPosition = selection.getEndPosition();
      const coordinates = editor.getScrolledVisiblePosition(endPosition);

      if (coordinates && containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        const editorDomNode = editor.getDomNode();
        if (editorDomNode) {
          const editorRect = editorDomNode.getBoundingClientRect();
          const relativeTop = coordinates.top + (editorRect.top - containerRect.top);
          const relativeLeft = coordinates.left + (editorRect.left - containerRect.left);

          setPopupPosition({
            top: relativeTop + coordinates.height + 4,
            left: Math.min(relativeLeft, containerRect.width - 200),
          });
        }
      }
    });

    // スクロール時にポップアップを非表示
    editor.onDidScrollChange(() => {
      setPopupPosition(null);
    });

    const autoCloseLanguages = new Set(["html", "markdown"]);
    const voidTags = new Set([
      "area",
      "base",
      "br",
      "col",
      "embed",
      "hr",
      "img",
      "input",
      "link",
      "meta",
      "param",
      "source",
      "track",
      "wbr",
    ]);

    editor.onDidChangeModelContent((event) => {
      if (isApplyingAutoCloseRef.current) return;
      if (event.isFlush || event.isUndoing || event.isRedoing) return;

      const change = event.changes.find(
        (item) => item.text === ">" && item.rangeLength === 0,
      );
      if (!change) return;

      const model = editor.getModel();
      if (!model) return;

      const languageId = model.getLanguageId();
      if (!autoCloseLanguages.has(languageId)) return;

      const position = editor.getPosition();
      if (!position) return;

      const line = model.getLineContent(position.lineNumber);
      let left = line.slice(0, Math.max(position.column - 1, 0));
      if (left.endsWith(">")) {
        left = left.slice(0, -1);
      }

      const match = left.match(/<([A-Za-z][\w:-]*)[^<>]*$/);
      if (!match) return;

      const tagName = match[1];
      if (voidTags.has(tagName.toLowerCase())) return;
      if (left.trim().endsWith("/")) return;

      const right = line.slice(Math.max(position.column - 1, 0));
      if (right.startsWith(`</${tagName}`)) return;

      isApplyingAutoCloseRef.current = true;
      try {
        editor.pushUndoStop();
        editor.executeEdits("auto-close-tag", [
          {
            range: new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            ),
            text: `</${tagName}>`,
          },
        ]);
        editor.pushUndoStop();
        editor.setPosition(position);
      } finally {
        isApplyingAutoCloseRef.current = false;
      }
    });
  };

  return (
    <div ref={containerRef} style={{ position: "relative", height: "100%" }}>
      <Editor
        height="100%"
        theme="vs"
        path={fileName}
        defaultLanguage={getLanguage(fileName)}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        onMount={handleEditorDidMount}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineHeight: 20,
          letterSpacing: 0,
          padding: { top: 0, bottom: 0 },
          fontFamily:
            '"JetBrains Mono", "SF Mono", Monaco, Menlo, Consolas, "Ubuntu Mono", "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace',
          fontLigatures: false,
          fontWeight: "normal",
          automaticLayout: true,
          scrollBeyondLastLine: true,
          wordWrap: isMarkdown ? "on" : "off",
          scrollbar: {
            horizontal: isMarkdown ? "hidden" : "auto",
            vertical: "auto",
          },
          tabSize: 4,
          renderLineHighlight: "line",
          autoClosingBrackets: "always",
          autoClosingQuotes: "always",
          autoIndent: "full",
          formatOnType: true,
          selectionHighlight: false,
          occurrencesHighlight: "off",
          unicodeHighlight: {
            ambiguousCharacters: false,
            invisibleCharacters: false,
          },
        }}
      />

      {/* 選択時のポップアップ */}
      {popupPosition && (
        <div
          style={{
            position: "absolute",
            top: popupPosition.top,
            left: popupPosition.left,
            zIndex: 1000,
            display: "flex",
            gap: "4px",
            padding: "4px 8px",
            backgroundColor: "white",
            border: "1px solid #e5e5e5",
            borderRadius: "6px",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
            fontSize: "12px",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            onClick={handleAddToChat}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 8px",
              backgroundColor: "transparent",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              color: "#374151",
              fontSize: "12px",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#f3f4f6";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            チャットに追加
            <span style={{ color: "#9ca3af", fontSize: "11px" }}>⌘L</span>
          </button>
        </div>
      )}
    </div>
  );
}
