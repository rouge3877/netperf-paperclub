export function Brand() {
  return (
    <a className="brand" href="#papers" aria-label="NetPerf Paperclub">
      <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M6 25V7l20 18V7" />
        <circle cx="6" cy="7" r="3" />
        <circle cx="26" cy="25" r="3" />
      </svg>
      <span>
        <strong>NetPerf</strong>
        <span className="brand-product">Paperclub</span>
      </span>
    </a>
  );
}
