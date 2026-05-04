import './icon.css';

type Props = { readonly size?: number; readonly className?: string };

export function ArrowLeftIcon({ size = 16, className }: Props) {
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
      <path d="M10 3l-5 5 5 5" />
    </svg>
  );
}
