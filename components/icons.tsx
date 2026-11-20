export function SessionsIcon({ strokeWidth = 1.6 }: { strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} aria-hidden="true">
      <circle cx="5" cy="6.5" r="1.4" />
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="5" cy="17.5" r="1.4" />
      <path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h6" />
    </svg>
  );
}

export function ReportsIcon({ strokeWidth = 1.6 }: { strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} aria-hidden="true">
      <path d="M6 3.5h8.5L18.5 7.5V20.5H6z" />
      <path d="M14.5 3.5v4h4M9 12h6.5M9 15.5h6.5" />
    </svg>
  );
}
