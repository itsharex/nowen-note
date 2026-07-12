export type NoteImageExportFormat = "png" | "jpg" | "svg";
export type NoteImageExportLayout = "auto" | "long" | "pages";
export type NoteImageExportTheme = "current" | "light" | "dark";
export type NoteImageExportDestination = "download" | "gallery" | "files" | "share";

export interface ExportableNoteImageSource {
  id: string;
  title: string;
  content: string;
  contentText: string;
  contentFormat?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface NoteImageExportInitialOptions {
  format?: NoteImageExportFormat;
  quality?: number;
  pixelRatio?: number;
  layout?: NoteImageExportLayout;
  theme?: NoteImageExportTheme;
  destination?: NoteImageExportDestination;
}

export interface NoteImageExportRequestDetail {
  requestId: string;
  note: ExportableNoteImageSource;
  options: NoteImageExportInitialOptions;
}

export const NOTE_IMAGE_EXPORT_REQUEST_EVENT = "nowen:note-image-export-request";

const pending = new Map<string, (ok: boolean) => void>();
let sequence = 0;

function createRequestId(): string {
  sequence += 1;
  return `note-image-export-${Date.now()}-${sequence}`;
}

/**
 * Opens the global image-export center and resolves after the user completes or
 * cancels the flow. Existing menu entry points can await this promise without
 * knowing whether the app is running in Web, Electron or Capacitor.
 */
export function requestNoteImageExport(
  note: ExportableNoteImageSource,
  options: NoteImageExportInitialOptions = {},
): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);

  const requestId = createRequestId();
  return new Promise<boolean>((resolve) => {
    pending.set(requestId, resolve);
    window.dispatchEvent(new CustomEvent<NoteImageExportRequestDetail>(
      NOTE_IMAGE_EXPORT_REQUEST_EVENT,
      { detail: { requestId, note, options } },
    ));
  });
}

export function settleNoteImageExportRequest(requestId: string, ok: boolean): void {
  const resolve = pending.get(requestId);
  if (!resolve) return;
  pending.delete(requestId);
  resolve(ok);
}

export function cancelAllNoteImageExportRequests(): void {
  for (const resolve of pending.values()) resolve(false);
  pending.clear();
}
