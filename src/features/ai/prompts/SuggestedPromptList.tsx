import type { SuggestedPrompt } from '@/domain';
import { SuggestedPromptItem } from './SuggestedPromptItem';
import './suggested-prompts.css';

type Props = {
  readonly prompts: readonly SuggestedPrompt[];
  readonly onSelect: (text: string) => void;
  readonly onEdit: (text: string) => void;
};

export function SuggestedPromptList({ prompts, onSelect, onEdit }: Props) {
  return (
    <div className="suggested-prompts" role="region" aria-label="Suggested questions">
      {prompts.map((p, i) => (
        <SuggestedPromptItem
          key={`${String(i)}-${p.text}`}
          prompt={p}
          onSelect={onSelect}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}
