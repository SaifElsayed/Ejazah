/**
 * Device chrome the artboards are drawn inside. Design asset only — this is
 * never imported by apps/mobile.
 */
export function IosFrame({ children, label }) {
  return (
    <figure style={{ margin: 0 }}>
      {label ? <figcaption style={{ fontSize: 12, color: '#6b6b66', marginBottom: 8 }}>{label}</figcaption> : null}
      <div
        style={{
          width: 390,
          height: 844,
          borderRadius: 44,
          border: '10px solid #1c1c1a',
          overflow: 'hidden',
          background: '#fff',
          direction: 'rtl',
        }}
      >
        {children}
      </div>
    </figure>
  );
}
