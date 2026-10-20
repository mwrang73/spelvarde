// Trollspöet som glimmar (Trollspöt-fliken och genvägen). Tre små gnistor
// runt spetsen tänds och slocknar i tur och ordning (CSS .wand-s). Med
// "minska rörelse" står de stilla. Alltid aria-hidden: texten bär betydelsen.

export function WandSpark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`wand${className ? ` ${className}` : ""}`} aria-hidden="true" focusable="false">
      <path d="M3.5 20.5 13.5 10.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M12.6 9.6l1.8 1.8" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
      <path className="wand-s s1" d="M17 2.5v4M15 4.5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path className="wand-s s2" d="M20.5 9v3M19 10.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path className="wand-s s3" d="M10.5 3v2.4M9.3 4.2h2.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
