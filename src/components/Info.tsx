// ⓘ tooltip — pure CSS, works in server components.
export function Info({ text }: { text: string }) {
  return (
    <span className="tm-info">
      <span className="tm-info-icon" aria-label="What is this?">i</span>
      <span className="tm-info-tip" role="tooltip">{text}</span>
    </span>
  );
}

export function InfoStyles() {
  return (
    <style>{`
      .tm-info { position: relative; display: inline-flex; margin-left: 6px; vertical-align: middle; }
      .tm-info-icon {
        width: 14px; height: 14px; border-radius: 50%;
        border: 1px solid var(--border-strong); color: var(--fg3);
        font-size: 9px; font-weight: 700; font-style: normal;
        display: inline-flex; align-items: center; justify-content: center;
        cursor: help; text-transform: lowercase;
      }
      .tm-info-tip {
        position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
        width: 240px; padding: 10px 12px; border-radius: 8px;
        background: var(--tm-deep-charcoal); color: #fff;
        font-size: 12px; font-weight: 400; line-height: 1.45;
        letter-spacing: 0; text-transform: none;
        opacity: 0; pointer-events: none; transition: opacity 120ms ease;
        z-index: 20;
      }
      .tm-info:hover .tm-info-tip, .tm-info:focus-within .tm-info-tip { opacity: 1; }
      @media (max-width: 640px) { .tm-info-tip { width: 180px; } }
    `}</style>
  );
}
