"use client";

import Editor, { OnMount } from "@monaco-editor/react";
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

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Cmd+S / Ctrl+S のバインディング
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSave?.();
    });
  };

  return (
    <Editor
      height="100%"
      theme="light"
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
      }}
    />
  );
}
