// Íconos SVG propios (stroke consistente 1.75, 24×24, currentColor).
// Reemplazan glifos unicode (‹ › ✕ ✓), que leen como amateur.
import type { SVGProps } from "react";

const Base = ({ children, ...p }: SVGProps<SVGSVGElement> & { children: React.ReactNode }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    {...p}
  >
    {children}
  </svg>
);

export const IconChevronLeft = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M15 18l-6-6 6-6" />
  </Base>
);

export const IconChevronRight = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M9 6l6 6-6 6" />
  </Base>
);

export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const IconX = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Base>
);

export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M20 6L9 17l-5-5" />
  </Base>
);

export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Base>
);

export const IconCalendar = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <rect x="3" y="4.5" width="18" height="16" rx="3" />
    <path d="M8 3v3M16 3v3M3 9.5h18" />
  </Base>
);

export const IconMail = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <path d="M4 7l8 6 8-6" />
  </Base>
);

export const IconPhone = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M16.5 3h-9A2.5 2.5 0 005 5.5v13A2.5 2.5 0 007.5 21h9a2.5 2.5 0 002.5-2.5v-13A2.5 2.5 0 0016.5 3z" />
    <path d="M11 17.5h2" />
  </Base>
);

export const IconUser = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0114 0" />
  </Base>
);

export const IconNotes = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M5 4.5h11l3 3V19.5a1 1 0 01-1 1H5a1 1 0 01-1-1v-14a1 1 0 011-1z" />
    <path d="M8.5 10h7M8.5 13.5h7M8.5 17h4" />
  </Base>
);

export const IconInbox = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M3 13l3-8h12l3 8v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5z" />
    <path d="M3 13h5l1.5 2.5h5L16 13h5" />
  </Base>
);

export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 12a1 1 0 001 1h8a1 1 0 001-1l1-12" />
  </Base>
);

export const IconReceipt = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V3z" />
    <path d="M9 8h6M9 12h6" />
  </Base>
);

export const IconTarget = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.5" />
  </Base>
);

export const IconTrophy = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M7 4h10v5a5 5 0 01-10 0V4z" />
    <path d="M7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3M9 20h6M12 14v6" />
  </Base>
);

export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M12 3v12M7 11l5 5 5-5M5 21h14" />
  </Base>
);
