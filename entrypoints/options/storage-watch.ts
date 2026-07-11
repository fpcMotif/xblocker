// Tiny chrome.storage.onChanged subscription helper, mirrored from blocked-store.ts's
// onChange guard (same "no onChanged API -> inert no-op unsubscribe" contract) so the
// General pane can live-reflect edits the popup makes to SETTINGS_KEY while this page is
// open, without depending on a file outside entrypoints/options/**.

export type StorageChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
) => void;

/** Subscribe to local storage changes; returns an unsubscribe function. Inert (and
 *  returns a no-op unsubscribe) when chrome.storage.onChanged is unavailable. */
export function watchStorage(listener: StorageChangeListener): () => void {
  const onChanged = chrome.storage?.onChanged;
  if (!onChanged || typeof onChanged.addListener !== "function") {
    return () => {};
  }
  onChanged.addListener(listener);
  return () => onChanged.removeListener(listener);
}
