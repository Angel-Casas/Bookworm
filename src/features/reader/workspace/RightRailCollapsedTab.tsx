import { ChatIcon } from '@/shared/icons';
import './right-rail.css';

type Props = {
  readonly onExpand: () => void;
  readonly hasUnread?: boolean;
};

export function RightRailCollapsedTab({ onExpand, hasUnread }: Props) {
  return (
    <button
      type="button"
      className="right-rail__edge-tab"
      aria-expanded={false}
      aria-label="Expand chat panel"
      onClick={onExpand}
    >
      <ChatIcon size={16} />
      {hasUnread === true ? <span className="right-rail__edge-dot" aria-hidden="true" /> : null}
    </button>
  );
}
