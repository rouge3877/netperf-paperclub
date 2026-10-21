import { useEffect, useRef, type ReactNode } from "react";
import type { PaperView, PaperOrder } from "../shared/types.ts";
import { paperHref } from "./navigation.ts";
export function Notice({ children }: { children: ReactNode }) {
  return children ? (
    <div className="notice" role="alert">
      {children}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading" role="status">
      Loading…
    </div>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export const orderOptions: [PaperOrder, string][] = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["title", "Title A–Z"],
  ["conference", "Conference, then year"],
  ["rating", "Highest rated"],
  ["random", "Random order"],
];
export function OrderSelect({
  value,
  onChange,
  label = "Sort papers",
}: {
  value: PaperOrder;
  onChange: (v: PaperOrder) => void;
  label?: string;
}) {
  return (
    <label className="field compact">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as PaperOrder)}
      >
        {orderOptions.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
export function PaperCard({
  paper,
  full = false,
  expanded = false,
  onAdd,
  selected,
  onSelect,
  disabled = false,
}: {
  paper: PaperView;
  full?: boolean;
  expanded?: boolean;
  onAdd?: () => void;
  selected?: boolean;
  onSelect?: () => void;
  disabled?: boolean;
}) {
  return (
    <article className="paper-card" id={`paper-${paper.id}`}>
      <div className="paper-top">
        <div className="eyebrow">
          {paper.conference} <span>{paper.year}</span>
          {!paper.available && <span>Unavailable in current corpus</span>}
        </div>
        {onSelect && (
          <input
            type="checkbox"
            aria-label={`Select ${paper.title}`}
            checked={selected}
            disabled={disabled}
            onChange={onSelect}
          />
        )}
      </div>
      <h2>
        {full ? paper.title : <a href={paperHref(paper.id)}>{paper.title}</a>}
      </h2>
      <p className="authors">{paper.authors.join(", ")}</p>
      <div className="chips">
        {paper.topics.map((t) => (
          <span key={t.id} className="chip">
            {t.name}
          </span>
        ))}
      </div>
      <p className={full || expanded ? "abstract" : "abstract excerpt"}>
        {paper.abstract}
      </p>
      <div className="paper-footer">
        <a href={paper.url} target="_blank" rel="noopener noreferrer">
          Official source ↗
        </a>
        {paper.rating !== null && (
          <span className="muted">
            {`${paper.rating.toFixed(1)} / 5 · ${paper.ratingCount} ${paper.ratingCount === 1 ? "rating" : "ratings"}`}
          </span>
        )}
        {onAdd && (
          <button className="quiet" onClick={onAdd} disabled={disabled}>
            Add to folder
          </button>
        )}
      </div>
    </article>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol">▤</div>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export function Back({ to, label }: { to: string; label: string }) {
  return (
    <a className="text-button back-link" href={`#${to}`}>
      ← {label}
    </a>
  );
}
