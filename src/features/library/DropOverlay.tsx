import { useEffect, useRef, useState } from 'react';
import './drop-overlay.css';

type Props = {
  readonly onFilesDropped: (files: readonly File[]) => void;
};

export function DropOverlay({ onFilesDropped }: Props) {
  const [active, setActive] = useState(false);
  const counter = useRef(0);

  useEffect(() => {
    function isFileDrag(e: DragEvent): boolean {
      return Array.from(e.dataTransfer?.types ?? []).includes('Files');
    }
    function onEnter(e: DragEvent) {
      if (!isFileDrag(e)) return;
      counter.current += 1;
      setActive(true);
      e.preventDefault();
    }
    function onLeave(e: DragEvent) {
      if (!isFileDrag(e)) return;
      counter.current = Math.max(0, counter.current - 1);
      if (counter.current === 0) setActive(false);
    }
    function onOver(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
    }
    function onDrop(e: DragEvent) {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      counter.current = 0;
      setActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) onFilesDropped(files);
    }
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [onFilesDropped]);

  if (!active) return null;
  return (
    <div
      className="drop-overlay motion-fade-in"
      role="presentation"
      aria-hidden="true"
    >
      <div className="drop-overlay__plate">
        <p className="drop-overlay__title">Drop to add to your library</p>
        <p className="drop-overlay__hint">Files stay on this device.</p>
      </div>
    </div>
  );
}
