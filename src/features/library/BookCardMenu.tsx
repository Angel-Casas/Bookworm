import { useEffect, useRef, useState } from 'react';

type Props = {
  readonly onRemove: () => void;
};

export function BookCardMenu({ onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [open]);

  return (
    <div className="book-card__menu" ref={ref}>
      <button
        type="button"
        className="book-card__menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Book actions"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ⋯
      </button>
      {open && (
        <div role="menu" className="book-card__menu-popover">
          <button
            type="button"
            role="menuitem"
            className="book-card__menu-item"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            Remove from library
          </button>
        </div>
      )}
    </div>
  );
}
