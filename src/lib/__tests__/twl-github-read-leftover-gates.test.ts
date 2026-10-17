import { describe, expect, it } from "vitest";
import {
  assertPrepareOnlyWriteClosed,
  assertReadOnlyGithubRequest,
  classifyForbiddenAction,
} from "@/lib/twl-prepare-proof";

function failuresOf(result: { ok: boolean; failures?: string[] }) {
  return result.ok ? "" : result.failures!.join(" ");
}

const PULL = "https://api.github.com/repos/Bthornton1994/three-white-lights/pulls/35";

describe("TWL leftover GitHub read and write-closed gates", () => {
  it("refuses credentials, http, and a host-only or relative URL", () => {
    const credentialed = assertReadOnlyGithubRequest({
      method: "GET",
      url: "https://user:ghp_exampletoken@api.github.com/repos/Bthornton1994/three-white-lights/pulls/35",
    });
    expect(credentialed.ok).toBe(false);
    expect(failuresOf(credentialed)).toMatch(/must not include credentials in the URL/);

    const cleartext = assertReadOnlyGithubRequest({
      method: "GET",
      url: "http://api.github.com/repos/Bthornton1994/three-white-lights/pulls/35",
    });
    expect(cleartext.ok).toBe(false);
    expect(failuresOf(cleartext)).toMatch(/must use https/);

    const relative = assertReadOnlyGithubRequest({
      method: "GET",
      url: "api.github.com/repos/Bthornton1994/three-white-lights/pulls/35",
    });
    expect(relative.ok).toBe(false);
    expect(failuresOf(relative)).toMatch(/not a valid absolute URL/);
  });

  it("refuses leftover write-adjacent hosts and leftover read-only path holes", () => {
    const htmlHost = assertReadOnlyGithubRequest({
      method: "GET",
      url: "https://github.com/Bthornton1994/three-white-lights/pulls/35",
    });
    expect(htmlHost.ok).toBe(false);
    expect(failuresOf(htmlHost)).toMatch(/must target api\.github\.com/);

    const leftoverPaths = [
      `${PULL}/comments`,
      `${PULL}/reviews`,
      "https://api.github.com/repos/Bthornton1994/three-white-lights/deployments",
      "https://api.github.com/repos/Bthornton1994/three-white-lights/hooks",
      "https://api.github.com/repos/Bthornton1994/three-white-lights/keys",
      `${PULL}/merge`,
    ];
    for (const url of leftoverPaths) {
      const result = assertReadOnlyGithubRequest({ method: "GET", url });
      expect(result.ok, url).toBe(false);
      expect(failuresOf(result), url).toMatch(/outside the read-only allowlist|must be a public pull/);
    }
  });

  it("classifies leftover forbidden-action aliases instead of treating them as unknown", () => {
    expect(classifyForbiddenAction("production deploy")).toBe("deploy");
    expect(classifyForbiddenAction("repository-write")).toBe("github_write");
    expect(classifyForbiddenAction("issues write")).toBe("issues_write");
    expect(classifyForbiddenAction("external message")).toBe("external_messages");
    expect(classifyForbiddenAction("purchase")).toBe("purchases");
    expect(classifyForbiddenAction("secret")).toBe("secrets");

    expect(assertPrepareOnlyWriteClosed({ action: "production deploy" }).ok).toBe(false);
    expect(failuresOf(assertPrepareOnlyWriteClosed({ action: "repository-write" }))).toMatch(
      /Forbidden prepare-only action: github_write/,
    );
    expect(failuresOf(assertPrepareOnlyWriteClosed({ merge_performed: true }))).toMatch(
      /merge_performed must be false/,
    );
  });
});
