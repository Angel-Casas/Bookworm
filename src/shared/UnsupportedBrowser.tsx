import { CAPABILITY_LABELS, type Capability } from './capabilities';
import './unsupported-browser.css';

type Props = {
  readonly missing: readonly Capability[];
};

export function UnsupportedBrowser({ missing }: Props) {
  return (
    <main className="unsupported" aria-labelledby="unsupported-title">
      <div className="unsupported__plate">
        <p className="unsupported__eyebrow">Bookworm</p>
        <h1 id="unsupported-title" className="unsupported__title">
          This browser is missing a few things Bookworm relies on.
        </h1>
        <p className="unsupported__body">
          Bookworm keeps your books on this device. To do that safely it needs the following
          capabilities, which this browser doesn’t expose:
        </p>
        <ul className="unsupported__list">
          {missing.map((cap) => (
            <li key={cap} className="unsupported__item">
              <span className="unsupported__dot" aria-hidden="true" />
              {CAPABILITY_LABELS[cap]}
            </li>
          ))}
        </ul>
        <p className="unsupported__hint">
          Try the latest version of Chrome, Edge, Safari, or Firefox.
        </p>
      </div>
    </main>
  );
}
