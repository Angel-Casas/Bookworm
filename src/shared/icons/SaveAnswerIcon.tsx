import './icon.css';

type Props = { readonly size?: number; readonly className?: string };

export function SaveAnswerIcon({ size = 16, className }: Props) {
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
      <path d="M4 2.5h7v11l-3.5-2.5L4 13.5v-11Z" />
      <path d="M12.5 5.5v3M11 7h3" />
    </svg>
  );
}
