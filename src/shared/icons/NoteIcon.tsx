import './icon.css';

type Props = { readonly size?: number; readonly className?: string };

export function NoteIcon({ size = 16, className }: Props) {
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
      <path d="M3 3.5h7l2 2v7a.5.5 0 0 1-.5.5H3.5a.5.5 0 0 1-.5-.5v-9z" />
      <path d="M5 7.5h6M5 10h4" />
    </svg>
  );
}
