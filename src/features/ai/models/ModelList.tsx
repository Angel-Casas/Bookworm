import { useMemo } from 'react';
import type { Model } from '@/domain';
import { ModelRow } from './ModelRow';

type Props = {
  readonly models: readonly Model[];
  readonly selectedId: string | null;
  readonly onSelect: (model: Model) => void | Promise<void>;
};

export function ModelList({ models, selectedId, onSelect }: Props) {
  const sorted = useMemo(() => [...models].sort((a, b) => a.id.localeCompare(b.id)), [models]);
  return (
    <div className="model-list" role="list">
      {sorted.map((model) => (
        <ModelRow
          key={model.id}
          model={model}
          isSelected={model.id === selectedId}
          onClick={onSelect}
        />
      ))}
    </div>
  );
}
