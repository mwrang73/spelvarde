// Inline-SVG-ikoner från mockupen. Alltid aria-hidden: texten bredvid
// eller aria-label på knappen bär betydelsen.

type P = { className?: string };
const svg = (path: React.ReactNode, viewBox = "0 0 24 24") =>
  function Icon({ className }: P) {
    return (
      <svg viewBox={viewBox} className={className} aria-hidden="true" focusable="false">
        {path}
      </svg>
    );
  };

export const IconCheck = svg(<path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />);
export const IconCheckThin = svg(<path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />);
export const IconX = svg(<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />);
export const IconBack = svg(<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />);
export const IconChev = svg(<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />);
export const IconRefresh = svg(<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />);
export const IconStat = svg(<path d="M5 20V11M12 20V5M19 20v-6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />);
export const IconLink = svg(
  <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />,
);
export const IconFlag = svg(<path d="M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />);
export const IconWarn = svg(
  <>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M12 7v6M12 16.5v.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </>,
);
export const IconInfo = svg(
  <>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M12 11v6M12 7.5v.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </>,
);
export const IconOffline = svg(<path d="M3 9a14 14 0 0 1 18 0M6.5 12.5a9 9 0 0 1 11 0M10 16a4 4 0 0 1 4 0M4 4l16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />);
export const IconGear = svg(
  <>
    <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" />
    <path
      d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
    <circle cx="12" cy="12" r="6.6" fill="none" stroke="currentColor" strokeWidth="2" />
  </>,
);
export const IconPen = svg(<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />);
export const IconTrash = svg(<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />);
export const IconPlus = svg(<path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />);
export const IconUp = svg(<path d="M5 1l4 7H1z" fill="currentColor" />, "0 0 10 10");
export const IconDown = svg(<path d="M5 9L1 2h8z" fill="currentColor" />, "0 0 10 10");
export const IconWheel = svg(
  <>
    <circle cx="16" cy="16" r="12.5" fill="none" stroke="currentColor" strokeWidth="2.6" />
    <g stroke="currentColor" strokeWidth="1.5">
      <path d="M16 16L16 4M16 16L24.5 7.5M16 16L28 16M16 16L24.5 24.5M16 16L16 28M16 16L7.5 24.5M16 16L4 16M16 16L7.5 7.5" />
    </g>
    <circle cx="16" cy="16" r="3.4" fill="currentColor" />
  </>,
  "0 0 32 32",
);
export const IconTicket = svg(
  <>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V14a2 2 0 0 0 0-4z" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M14 6v12" stroke="currentColor" strokeWidth="2" strokeDasharray="2 2" />
  </>,
);
export const IconCopy = svg(
  <>
    <rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" fill="none" stroke="currentColor" strokeWidth="2" />
  </>,
);
export const IconLock = svg(
  <>
    <rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2" />
  </>,
);
// E2.2: Hämta streck och odds (nedåtpil) och spärren (klocka).
export const IconDownload = svg(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />);
export const IconClock = svg(
  <>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.2" />
    <path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </>,
);
