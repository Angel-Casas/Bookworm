import './icon.css';

type Props = { readonly size?: number; readonly className?: string };

export function NotebookIcon({ size = 16, className }: Props) {
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
      <path d="M4 2.5h7a1.5 1.5 0 0 1 1.5 1.5v9a.5.5 0 0 1-.5.5H4a1.5 1.5 0 0 1 0-3h8.5" />
      <path d="M6 5.5h4M6 8h3" />
    </svg>
  );
}
