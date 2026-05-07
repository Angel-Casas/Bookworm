import type { SuggestedPrompt } from '@/domain';
import { EditIcon } from '@/shared/icons';

type Props = {
  readonly prompt: SuggestedPrompt;
  readonly onSelect: (text: string) => void;
  readonly onEdit: (text: string) => void;
};

export function SuggestedPromptItem({ prompt, onSelect, onEdit }: Props) {
  return (
    <button
      type="button"
      className="suggested-prompts__item"
      aria-label={`Ask: ${prompt.text}`}
      onClick={() => {
        onSelect(prompt.text);
      }}
    >
      <span className="suggested-prompts__text">{prompt.text}</span>
      <span
        className="suggested-prompts__edit"
        role="button"
        tabIndex={0}
        aria-label={`Edit before asking: ${prompt.text}`}
        onClick={(e) => {
          e.stopPropagation();
          onEdit(prompt.text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onEdit(prompt.text);
          }
        }}
      >
        <EditIcon size={14} />
      </span>
    </button>
  );
}
