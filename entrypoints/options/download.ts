// Shared Blob+URL.createObjectURL+anchor-click download seam, used by both the whitelist
// and blocked-log panes' "Export JSON" actions — kept as a small stubbable function per
// docs/plans/2026-07-10-gauge-and-ledger/plan.md's engineering notes, rather than each
// pane re-deriving its own File/Blob/URL wiring.

export type DownloadFn = (filename: string, blob: Blob) => void;

function defaultDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadJson(
  filename: string,
  data: unknown,
  download: DownloadFn = defaultDownload,
): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  download(filename, blob);
}
