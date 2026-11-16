export function LogoMark({ size = 28 }: { size?: number }) {
  const width = Math.round(size * 1.9);
  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 76 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Outer key ring + lower notched blade */}
      <circle cx="20" cy="20" r="14" stroke="var(--text)" strokeWidth="4.5" />
      <path
        d="M33 23H45L48 25.5L51 23H54V28H57V25.5H61V30H64V23H66"
        stroke="var(--text)"
        strokeWidth="3"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      {/* Upper electric-blue key spine */}
      <path
        d="M33 17H66L71 20L66 23H62"
        stroke="var(--accent)"
        strokeWidth="3.5"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      {/* Split two-plane geometric keyhole inside the bow */}
      <path
        d="M19.2 11.2L14 14.2L12.5 20.5L15.2 27.2H17.6L18.4 22.8C17.2 22.1 16.5 20.8 16.5 19.3C16.5 17.3 18 15.8 19.8 15.6L20.4 11.2H19.2Z"
        fill="var(--accent)"
      />
      <path
        d="M22.2 11.4L20.8 15.8C22.4 16.2 23.5 17.6 23.5 19.3C23.5 20.8 22.8 22.1 21.6 22.8L22.5 27.2H25L27.5 20.5L25.8 14.2L22.2 11.4Z"
        fill="var(--accent)"
      />
    </svg>
  );
}
