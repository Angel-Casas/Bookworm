import './icon.css';

type Props = { readonly size?: number; readonly className?: string };

export function BookOpenIcon({ size = 16, className }: Props) {
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
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1.5 3h4.5a2 2 0 0 1 2 2v8.5a1.5 1.5 0 0 0-1.5-1.5H1.5z" />
      <path d="M14.5 3H10a2 2 0 0 0-2 2v8.5a1.5 1.5 0 0 1 1.5-1.5h5z" />
    </svg>
  );
}
