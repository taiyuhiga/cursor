"use client";

import Editor, { BeforeMount, OnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  fileName: string;
  onSave?: () => void;
};

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

export function MainEditor({ value, onChange, fileName, onSave }: Props) {
  const editorRef = useRef<any>(null);
  const onSaveRef = useRef(onSave);
  const isMarkdown = fileName.toLowerCase().endsWith(".md");
  const isApplyingAutoCloseRef = useRef(false);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const handleBeforeMount: BeforeMount = (monaco) => {
    monaco.editor.defineTheme("cursor-light", {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6A737D" },
        { token: "keyword", foreground: "D73A49" },
        { token: "string", foreground: "032F62" },
        { token: "number", foreground: "005CC5" },
        { token: "type", foreground: "6F42C1" },
      ],
      colors: {
        "editor.foreground": "#1F2328",
        "editor.background": "#FFFFFF",
        "editorLineNumber.foreground": "#8C959F",
        "editorLineNumber.activeForeground": "#1F2328",
        "editorCursor.foreground": "#1F2328",
        "editor.selectionBackground": "#BBDFFF",
        "editor.inactiveSelectionBackground": "#DDEBFF",
        "editor.selectionHighlightBackground": "#E6F0FF",
        "editor.selectionHighlightBorder": "#00000000",
        "editor.lineHighlightBackground": "transparent",
        "editor.lineHighlightBorder": "#00000000",
        "editorIndentGuide.background": "#E5E7EB",
        "editorIndentGuide.activeBackground": "#C7D2FE",
        "editorWhitespace.foreground": "#E5E7EB",
      },
    });
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Cmd+S / Ctrl+S のバインディング
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.();
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
    <Editor
      height="100%"
      theme="cursor-light"
      beforeMount={handleBeforeMount}
      path={fileName} // これでモデルが再作成され、言語切り替えがスムーズになる
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
        unicodeHighlight: {
          ambiguousCharacters: false,
          invisibleCharacters: false,
        },
      }}
    />
  );
}
