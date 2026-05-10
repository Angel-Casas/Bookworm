import './route-loading.css';

export function RouteLoading() {
  return (
    <main className="route-loading" aria-busy="true">
      <p className="route-loading__copy motion-fade-in">Loading&hellip;</p>
    </main>
  );
}
