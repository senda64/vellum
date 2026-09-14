import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  drawSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { search, searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";

type Props = {
  doc: string;
  onChange: (value: string) => void;
  onReady?: (view: EditorView) => void;
};

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "14px",
    backgroundColor: "#fff",
    color: "#111",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    lineHeight: "1.55",
    overflow: "auto",
  },
  ".cm-content": {
    caretColor: "#111",
    padding: "0.75rem 0 2rem",
  },
  ".cm-gutters": {
    backgroundColor: "#fafafa",
    color: "#888",
    border: "none",
    borderRight: "1px solid #eee",
  },
  ".cm-activeLine": {
    backgroundColor: "#f5f5f5",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#f0f0f0",
  },
  "&.cm-focused": {
    outline: "none",
  },
});

export default function MarkdownEditor({ doc, onChange, onReady }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  onChangeRef.current = onChange;
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!parentRef.current) return;

    const state = EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        foldGutter(),
        drawSelection(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        highlightSelectionMatches(),
        search({ top: true }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        markdown(),
        keymap.of([
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...searchKeymap,
        ]),
        editorTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: parentRef.current,
    });
    viewRef.current = view;
    onReadyRef.current?.(view);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once; external doc sync handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === doc) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: doc },
    });
  }, [doc]);

  return <div className="cm-host" ref={parentRef} />;
}
