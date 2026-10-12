import { describe, expect, it } from "vitest";
import {
  TWL_DEFAULT_PR_TARGET,
  fetchPublicPullRequestMetadata,
  parsePublicPullRequestTarget,
  publicCheckRunsUrl,
  publicCommitStatusUrl,
  publicPullUrl,
} from "@/lib/public-github-pr";

const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BASE = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("public pull request target parsing", () => {
  it("defaults to the frozen TWL target and accepts a public slug", () => {
    expect(parsePublicPullRequestTarget({})).toEqual(TWL_DEFAULT_PR_TARGET);
    expect(parsePublicPullRequestTarget({ owner: "octocat", repo: "Hello-World", pullNumber: "1" })).toEqual({
      owner: "octocat",
      repo: "Hello-World",
      pullNumber: 1,
    });
  });

  it("rejects owner or repo values that are not public GitHub slugs", () => {
    expect(() => parsePublicPullRequestTarget({ owner: "evil/../org", repo: "Hello-World", pullNumber: 1 })).toThrow(
      /public GitHub slugs/i,
    );
    expect(() => parsePublicPullRequestTarget({ owner: "octocat", repo: "Hello World", pullNumber: 1 })).toThrow(
      /public GitHub slugs/i,
    );
    expect(() => parsePublicPullRequestTarget({ owner: "octocat", repo: "Hello-World?", pullNumber: 1 })).toThrow(
      /public GitHub slugs/i,
    );
  });

  it("treats a missing or zero pull number as the frozen default and rejects invalid numbers", () => {
    expect(parsePublicPullRequestTarget({ owner: "octocat", repo: "Hello-World", pullNumber: 0 }).pullNumber).toBe(
      TWL_DEFAULT_PR_TARGET.pullNumber,
    );
    expect(parsePublicPullRequestTarget({ owner: "octocat", repo: "Hello-World", pullNumber: "" }).pullNumber).toBe(
      TWL_DEFAULT_PR_TARGET.pullNumber,
    );
    expect(() => parsePublicPullRequestTarget({ owner: "octocat", repo: "Hello-World", pullNumber: -3 })).toThrow(
      /positive integer/i,
    );
    expect(() => parsePublicPullRequestTarget({ owner: "octocat", repo: "Hello-World", pullNumber: 1.5 })).toThrow(
      /positive integer/i,
    );
  });
});

describe("public pull request metadata fail-closed", () => {
  it("fails closed on 404, non-success HTTP, and a non-object body", async () => {
    const target = { owner: "octocat", repo: "Hello-World", pullNumber: 1 };

    await expect(
      fetchPublicPullRequestMetadata(target, async () => ({ status: 404, body: { message: "Not Found" } })),
    ).rejects.toThrow(/not found/i);
    await expect(fetchPublicPullRequestMetadata(target, async () => ({ status: 502, body: {} }))).rejects.toThrow(
      /HTTP 502/,
    );
    await expect(fetchPublicPullRequestMetadata(target, async () => ({ status: 200, body: [] }))).rejects.toThrow(
      /not an object/i,
    );
  });

  it("fails closed when SHAs, title, or HTML URL are missing", async () => {
    const target = { owner: "octocat", repo: "Hello-World", pullNumber: 1 };

    await expect(
      fetchPublicPullRequestMetadata(target, async () => ({
        status: 200,
        body: {
          html_url: "https://github.com/octocat/Hello-World/pull/1",
          title: "Demo",
          state: "open",
          head: { sha: "not-a-sha" },
          base: { sha: BASE },
        },
      })),
    ).rejects.toThrow(/incomplete/i);

    await expect(
      fetchPublicPullRequestMetadata(target, async () => ({
        status: 200,
        body: {
          html_url: "",
          title: "Demo",
          state: "open",
          head: { sha: HEAD },
          base: { sha: BASE },
        },
      })),
    ).rejects.toThrow(/incomplete/i);
  });

  it("reads metadata through GET-only URLs and leaves CI null when status payloads are unusable", async () => {
    const target = { owner: "octocat", repo: "Hello-World", pullNumber: 1 };
    const urls: string[] = [];
    const metadata = await fetchPublicPullRequestMetadata(target, async (url) => {
      urls.push(url);
      if (url === publicPullUrl(target)) {
        return {
          status: 200,
          body: {
            html_url: "https://github.com/octocat/Hello-World/pull/1",
            title: "Demo PR",
            state: "open",
            draft: false,
            merged: false,
            head: { sha: HEAD },
            base: { sha: BASE },
          },
        };
      }
      return { status: 200, body: "not-an-object" };
    });

    expect(metadata).toMatchObject({
      owner: "octocat",
      repo: "Hello-World",
      pullNumber: 1,
      htmlUrl: "https://github.com/octocat/Hello-World/pull/1",
      title: "Demo PR",
      headSha: HEAD,
      baseSha: BASE,
      draft: false,
      upstreamMerged: false,
      ciConclusion: null,
    });
    expect(urls).toEqual([
      publicPullUrl(target),
      publicCommitStatusUrl(target.owner, target.repo, HEAD),
      publicCheckRunsUrl(target.owner, target.repo, HEAD),
    ]);
    expect(urls.every((url) => url.startsWith("https://api.github.com/"))).toBe(true);
    expect(urls.some((url) => url.includes("/merge"))).toBe(false);
  });
});
