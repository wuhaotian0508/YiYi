type YiYiMarkProps = { size?: number; expression?: "idle" | "listening" | "speaking"; className?: string };

export function YiYiMark({ size = 76, expression = "idle", className = "" }: YiYiMarkProps) {
  return (
    <svg className={`yiyi-mark ${className}`} width={size} height={size * .78} viewBox="0 0 100 78" fill="none" aria-label="YiYi">
      <path d="M28 67C15 67 7 58 7 47c0-10 7-18 17-20C26 14 37 7 50 7c15 0 27 9 29 23 9 2 15 9 15 18 0 11-9 19-21 19H28Z" fill="white" stroke="#111" strokeWidth="5" strokeLinejoin="round" />
      <circle cx="38" cy="45" r="3.8" fill="#111" />
      <circle cx="64" cy="45" r="3.8" fill="#111" />
      {expression === "speaking" ? <ellipse cx="51" cy="57" rx="7" ry="4.5" fill="#111" /> : <path d="M44 56c4 4 10 4 14 0" stroke="#111" strokeWidth="3" strokeLinecap="round" />}
    </svg>
  );
}
