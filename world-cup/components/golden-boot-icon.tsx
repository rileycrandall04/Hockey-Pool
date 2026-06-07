/**
 * A small golden soccer-boot icon (the emoji 🥾 can't be recolored via CSS).
 * Sized to 1em so it scales with the surrounding text; always gold.
 */
export function GoldenBootIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 22 22"
      width="1em"
      height="1em"
      aria-hidden="true"
      className={`inline-block align-[-0.15em] ${className}`}
    >
      <path
        fill="#EAB308"
        stroke="#A16207"
        strokeWidth="0.6"
        strokeLinejoin="round"
        d="M4 5c0-.6.4-1 1-1h3c.6 0 1 .4 1 1v5.3c0 .4.3.8.7.95l7.2 2.6c1.3.5 2.1 1.7 2.1 3.05V18c0 .6-.4 1-1 1H5c-.6 0-1-.4-1-1Z"
      />
      <g fill="#A16207">
        <rect x="6" y="18.8" width="1.3" height="1.5" rx=".3" />
        <rect x="10" y="18.8" width="1.3" height="1.5" rx=".3" />
        <rect x="14" y="18.8" width="1.3" height="1.5" rx=".3" />
      </g>
    </svg>
  );
}
