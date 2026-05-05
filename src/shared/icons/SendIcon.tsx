import './icon.css';

type Props = { readonly size?: number; readonly className?: string };

export function SendIcon({ size = 16, className }: Props) {
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
      <path d="M14 2 1.5 8l5 1.5L8 14l6-12Z" />
      <path d="M6.5 9.5 14 2" />
    </svg>
  );
}
