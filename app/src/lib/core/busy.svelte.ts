// Count of operations in flight → the thin LoadingBar under the tab bar.

let count = $state(0);

export const busyCount = (): number => count;

export function beginBusy(): () => void {
  count++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    count--;
  };
}
