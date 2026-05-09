// Download a string as a file via the standard "create blob, click invisible
// anchor" pattern. Synchronous; cleans up the object URL and the anchor in
// the same call. Must be invoked from a user-initiated event handler so the
// browser allows the download.
export function triggerDownload(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
