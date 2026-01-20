"use client";

import Editor, { BeforeMount, OnMount } from "@monaco-editor/react";
import { useRef } from "react";

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

  const handleBeforeMount: BeforeMount = (monaco) => {
    monaco.editor.defineTheme("cursor-light", {
      base: "vs",
      inherit: true,
      rules: [],
      colors: {
        "editor.lineHighlightBackground": "rgba(37, 99, 235, 0.12)",
        "editor.lineHighlightBorder": "#00000000",
      },
    });
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Cmd+S / Ctrl+S のバインディング
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSave?.();
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

    editor.onDidType((text) => {
      if (text !== ">") return;

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
        fontSize: 14,
        lineHeight: 0,
        letterSpacing: 0,
        padding: { top: 0, bottom: 0 },
        fontFamily:
          '"SF Mono", Monaco, Menlo, Consolas, "Ubuntu Mono", "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace',
        fontLigatures: false,
        fontWeight: "normal",
        automaticLayout: true,
        scrollBeyondLastLine: true,
        wordWrap: "on",
        scrollbar: { horizontal: "hidden", vertical: "auto" },
        tabSize: 4,
        renderLineHighlight: "line",
        autoClosingTags: "always",
        autoClosingBrackets: "always",
        autoClosingQuotes: "always",
        autoIndent: "full",
        formatOnType: true,
      }}
    />
  );
}
