import { useCallback, useState } from 'react';

type Options = {
  readonly initial: boolean;
  readonly onChange: (visible: boolean) => void;
};

export type UseRightRailVisibilityHandle = {
  readonly visible: boolean;
  readonly toggle: () => void;
  readonly set: (next: boolean) => void;
};

export function useRightRailVisibility(opts: Options): UseRightRailVisibilityHandle {
  const [visible, setVisible] = useState<boolean>(opts.initial);

  const toggle = useCallback(() => {
    setVisible((prev) => {
      const next = !prev;
      opts.onChange(next);
      return next;
    });
  }, [opts]);

  const set = useCallback(
    (next: boolean) => {
      setVisible(next);
      opts.onChange(next);
    },
    [opts],
  );

  return { visible, toggle, set };
}
