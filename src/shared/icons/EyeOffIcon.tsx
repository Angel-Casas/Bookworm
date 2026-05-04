import './icon.css';

type Props = { readonly size?: number; readonly className?: string };

export function EyeOffIcon({ size = 16, className }: Props) {
  const cls = className ? `icon ${className}` : 'icon';
  return (
    <svg
      className={cls}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 2l12 12" />
      <path d="M6.5 6.5a2 2 0 0 0 2.83 2.83" />
      <path d="M3.5 5C2.5 6 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.04 0 1.97-.27 2.78-.7" />
      <path d="M5.4 3.6C6.18 3.34 7.05 3.2 8 3.2c4 0 6.5 4.8 6.5 4.8s-.6 1.18-1.74 2.34" />
    </svg>
  );
}
