export default function Loading() {
  return (
    <div className="content-inner stack" aria-busy="true" aria-live="polite">
      <div className="skeleton" style={{ height: 36, width: 240 }} />
      <div className="skeleton" style={{ height: 18, width: 360 }} />
      <div className="skeleton" style={{ height: 88, marginTop: 16 }} />
      <div className="skeleton" style={{ height: 280 }} />
    </div>
  );
}
