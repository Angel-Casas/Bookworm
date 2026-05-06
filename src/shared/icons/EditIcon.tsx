import './icon.css';

type Props = { readonly size?: number; readonly className?: string };

export function EditIcon({ size = 16, className }: Props) {
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
      <path d="M11.5 1.5L14.5 4.5L5 14H2V11L11.5 1.5Z" />
    </svg>
  );
}
