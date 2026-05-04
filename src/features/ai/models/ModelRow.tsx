import type { Model } from '@/domain';

type Props = {
  readonly model: Model;
  readonly isSelected: boolean;
  readonly onClick: (model: Model) => void | Promise<void>;
};

export function ModelRow({ model, isSelected, onClick }: Props) {
  return (
    <button
      type="button"
      className={isSelected ? 'model-row model-row--selected' : 'model-row'}
      aria-pressed={isSelected}
      onClick={() => {
        void Promise.resolve(onClick(model));
      }}
    >
      <span
        className={
          isSelected ? 'model-row__radio model-row__radio--selected' : 'model-row__radio'
        }
        aria-hidden="true"
      />
      <span className="model-row__id">{model.id}</span>
    </button>
  );
}
