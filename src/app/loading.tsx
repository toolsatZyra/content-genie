export default function Loading() {
  return (
    <main
      aria-label="Opening Genie"
      aria-live="polite"
      className="loading-stage"
      role="status"
    >
      <div className="loading-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>Waking the studio…</p>
    </main>
  );
}
