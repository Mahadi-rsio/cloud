"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import type { OnMount } from "@monaco-editor/react";
import { useThemeStore } from "@/stores/theme-store";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

interface SqlEditorProps {
  value: string;
  onChange: (sql: string) => void;
  onRun: (sql: string) => void;
}

export function SqlEditor({ value, onChange, onRun }: SqlEditorProps) {
  const theme = useThemeStore((s) => s.theme);
  const monacoTheme = theme === "dark" ? "vs-dark" : "light";
  const runRef = React.useRef(onRun);
  runRef.current = onRun;

  const handleMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      const selection = editor.getSelection();
      const model = editor.getModel();
      if (!model) return;
      if (selection && !selection.isEmpty()) {
        runRef.current(model.getValueInRange(selection));
      } else {
        runRef.current(model.getValue());
      }
    });
    editor.focus();
  };

  return (
    <MonacoEditor
      height="100%"
      defaultLanguage="sql"
      value={value}
      theme={monacoTheme}
      onChange={(next) => onChange(next ?? "")}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        lineHeight: 20,
        tabSize: 2,
        scrollBeyondLastLine: false,
        wordWrap: "off",
        automaticLayout: true,
        fontLigatures: true,
        padding: { top: 8 },
        scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
      }}
    />
  );
}