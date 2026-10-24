// Promise-based modal dialogs. window.prompt/confirm are unavailable in the Tauri
// webview, so every component awaits these instead; one <DialogHost/> renders them.

export type Dialog =
  | {
      kind: "prompt";
      title: string;
      label?: string;
      value: string;
      confirmText: string;
      resolve: (v: string | null) => void;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmText: string;
      danger: boolean;
      resolve: (v: boolean) => void;
    }
  | { kind: "alert"; title: string; message: string; error: boolean; resolve: () => void }
  | {
      kind: "choice";
      title: string;
      message: string;
      options: ChoiceOption[];
      resolve: (v: string | null) => void;
    };

/** One big pictogram button of a choice dialog (e.g. replace / keep both / skip). */
export interface ChoiceOption {
  value: string;
  label: string;
  icon: import("./Icon.svelte").IconName;
  danger?: boolean;
}

let current = $state<Dialog | null>(null);

export const currentDialog = (): Dialog | null => current;

export function closeDialog(): void {
  current = null;
}

export function promptText(
  title: string,
  opts: { label?: string; value?: string; confirmText?: string } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    current = {
      kind: "prompt",
      title,
      label: opts.label,
      value: opts.value ?? "",
      confirmText: opts.confirmText ?? "OK",
      resolve,
    };
  });
}

export function confirmAction(
  title: string,
  message: string,
  opts: { confirmText?: string; danger?: boolean } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    current = {
      kind: "confirm",
      title,
      message,
      confirmText: opts.confirmText ?? "OK",
      danger: opts.danger ?? false,
      resolve,
    };
  });
}

function alert(title: string, message: string, error: boolean): Promise<void> {
  return new Promise((resolve) => {
    current = { kind: "alert", title, message, error, resolve };
  });
}

export const showInfo = (title: string, message: string): Promise<void> =>
  alert(title, message, false);

export const showError = (title: string, err: unknown): Promise<void> =>
  alert(title, err instanceof Error ? err.message : String(err), true);

/** Pick one of a few pictogram options; null when cancelled (Esc / backdrop). */
export function chooseOption(title: string, message: string, options: ChoiceOption[]): Promise<string | null> {
  return new Promise((resolve) => {
    current = { kind: "choice", title, message, options, resolve };
  });
}
