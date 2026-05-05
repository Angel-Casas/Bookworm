import './icon.css';

type Props = { readonly size?: number; readonly className?: string };

export function ChatIcon({ size = 16, className }: Props) {
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
      <path d="M2.5 4.5C2.5 3.395 3.395 2.5 4.5 2.5h7c1.105 0 2 .895 2 2v5c0 1.105-.895 2-2 2H7l-3 2.5v-2.5h-.5a1 1 0 0 1-1-1v-6Z" />
    </svg>
  );
}
