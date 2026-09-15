"use client";

export const MAIN_CONTENT_ID = "main-content";

/**
 * First focusable control on marketing pages. Activating it moves keyboard
 * focus to `<main>`, per WCAG G1.
 * https://www.w3.org/WAI/WCAG22/Techniques/general/G1
 */
export function SkipToContent() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="skip-link"
      onClick={(event) => {
        const target = document.getElementById(MAIN_CONTENT_ID);
        if (!target) return;
        event.preventDefault();
        target.focus({ preventScroll: false });
        target.scrollIntoView({ block: "start" });
      }}
    >
      Skip to content
    </a>
  );
}
