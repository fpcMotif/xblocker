export type ExclusiveRunner = <T>(operation: () => Promise<T>) => Promise<T>;
type LockRequester = {
  request<T>(name: string, operation: () => Promise<T>): Promise<T>;
};

/**
 * Serialize work across every document and worker for this extension origin. Web Locks
 * is available in both Navigator and WorkerNavigator; the local chain is only a test
 * and non-browser fallback.
 */
export function createExclusiveRunner(
  name: string,
  locks: LockRequester | undefined = typeof navigator === "undefined" ? undefined : navigator.locks,
): ExclusiveRunner {
  let localChain: Promise<unknown> = Promise.resolve();

  return function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (locks) {
      return locks.request(name, operation);
    }

    const run = localChain.then(operation);
    localChain = run.catch(() => undefined);
    return run;
  };
}
