import { forwardRef, useEffect, useRef } from "react";

type Props = {
  html: string;
  onScroll?: () => void;
};

const MarkdownPreview = forwardRef<HTMLDivElement, Props>(function MarkdownPreview(
  { html, onScroll },
  ref,
) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const onScrollRef = useRef(onScroll);
  onScrollRef.current = onScroll;

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const handle = () => onScrollRef.current?.();
    el.addEventListener("scroll", handle, { passive: true });
    return () => el.removeEventListener("scroll", handle);
  }, []);

  return (
    <div
      className="preview-scroll"
      ref={(node) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
    >
      <div
        className="preview-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
});

export default MarkdownPreview;
