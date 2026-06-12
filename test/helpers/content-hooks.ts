// Loads the content script once in test mode and exposes its internals.
// Every content.ts test file must obtain hooks through this module so the
// __XB_TEST__ flag is guaranteed to be set before the first import.

globalThis.__XB_TEST__ = true;
await import("../../entrypoints/content.ts");
delete globalThis.__XB_TEST__;

const installed = globalThis.__xblockerTestHooks;
if (!installed) {
  throw new Error("content.ts did not install __xblockerTestHooks in test mode");
}

export const hooks = installed;

/** Build a tweet <article> with an author link and a mocked More button. */
export function createTweetArticle(username: string): {
  moreButton: HTMLElement & { clicks: number };
  tweetArticle: HTMLElement;
} {
  const tweetArticle = document.createElement("article");
  tweetArticle.setAttribute("data-testid", "tweet");

  const userLink = document.createElement("a");
  userLink.setAttribute("href", `/${username}/status/123456789`);
  userLink.setAttribute("role", "link");
  tweetArticle.appendChild(userLink);

  const moreButton = document.createElement("button") as HTMLElement & { clicks: number };
  moreButton.setAttribute("aria-label", "More");
  moreButton.clicks = 0;
  moreButton.click = () => {
    moreButton.clicks++;
  };
  tweetArticle.appendChild(moreButton);

  return { moreButton, tweetArticle };
}

/** Build a tweet <article> that has no author link at all. */
export function createAnonymousTweetArticle(): HTMLElement {
  const tweetArticle = document.createElement("article");
  tweetArticle.setAttribute("data-testid", "tweet");
  return tweetArticle;
}

/** Append `count` comment articles (plus one leading main-tweet article). */
export function populateTweetPage(usernames: string[]): HTMLElement[] {
  const main = createTweetArticle("thread_author").tweetArticle;
  document.body.appendChild(main);

  return usernames.map((username) => {
    const { tweetArticle } = createTweetArticle(username);
    document.body.appendChild(tweetArticle);
    return tweetArticle;
  });
}

export type FetchCall = { url: string; init: RequestInit | undefined };

/** Install a fetch stub; returns the recorded calls. */
export function installFetchStub(
  responder: (url: string, init: RequestInit | undefined) => { ok: boolean; status: number },
): { calls: FetchCall[]; uninstall: () => void } {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return responder(url, init) as unknown as Response;
  }) as typeof fetch;

  return {
    calls,
    uninstall() {
      globalThis.fetch = original;
    },
  };
}

/** Install a fetch stub that rejects with a network error. */
export function installRejectingFetch(message = "network down"): {
  calls: FetchCall[];
  uninstall: () => void;
} {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    throw new Error(message);
  }) as typeof fetch;

  return {
    calls,
    uninstall() {
      globalThis.fetch = original;
    },
  };
}
