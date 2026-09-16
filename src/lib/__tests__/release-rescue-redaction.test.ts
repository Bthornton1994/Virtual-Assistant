import { describe, expect, it } from "vitest";
import {
  containsLikelySecret,
  isForbiddenEvidenceFilename,
  redactSecrets,
  scanForSecrets,
} from "@/lib/release-rescue-redaction";

// Every literal in this file is a syntactically valid but fabricated credential.
// None of them is real, and none came from a repository.
const SAMPLES: Array<{ label: string; text: string; detector: string }> = [
  { label: "AWS access key id", text: "const id = 'AKIAIOSFODNN7EXAMPLE';", detector: "aws_access_key_id" },
  {
    label: "GitHub classic token",
    text: "GITHUB_TOKEN=ghp_0123456789abcdefghijklmnopqrstuvwxyz",
    detector: "github_token",
  },
  {
    label: "GitHub fine-grained token",
    text: "token: github_pat_11ABCDEFG0123456789_abcdefghijklmnop",
    detector: "github_fine_grained_token",
  },
  { label: "Slack token", text: "xoxb-123456789012-abcdefghijkl", detector: "slack_token" },
  { label: "Stripe live key", text: "sk_live_abcdefghijklmnopqrstuvwx", detector: "stripe_key" },
  { label: "Anthropic key", text: "sk-ant-api03-abcdefghijklmnopqrstuvwxyz", detector: "anthropic_key" },
  { label: "OpenAI project key", text: "sk-proj-abcdefghijklmnopqrstuvwxyz012345", detector: "openai_key" },
  { label: "Google API key", text: `AIza${"b".repeat(35)}`, detector: "google_api_key" },
  { label: "npm token", text: `npm_${"c".repeat(36)}`, detector: "npm_token" },
  {
    label: "JWT",
    text: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    detector: "json_web_token",
  },
  {
    label: "PEM private key",
    text: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
    detector: "pem_private_key",
  },
  {
    label: "credentials in a connection string",
    text: "DATABASE_URL=postgres://appuser:hunter2hunter2@db.internal:5432/app",
    detector: "credential_in_url",
  },
  {
    label: "assigned password",
    text: 'const password = "correct-horse-battery";',
    detector: "assigned_secret",
  },
  {
    label: "token in a query string",
    text: "fetch('https://api.example.com/v1/items?access_token=abc123def456ghi789')",
    detector: "credential_in_query",
  },
];

describe("release rescue secret redaction", () => {
  for (const sample of SAMPLES) {
    it(`redacts a ${sample.label}`, () => {
      const result = redactSecrets(sample.text);

      expect(result.hadSecrets).toBe(true);
      expect(result.detections.map((detection) => detection.detector)).toContain(sample.detector);
      expect(result.redacted).toContain("[REDACTED:");
      expect(containsLikelySecret(result.redacted)).toBe(false);
    });
  }

  it("keeps the setting name while removing its value", () => {
    const result = redactSecrets('client_secret = "s3cr3t-value-here"');

    expect(result.redacted).toContain("client_secret");
    expect(result.redacted).not.toContain("s3cr3t-value-here");
  });

  it("keeps the host while removing an inline credential", () => {
    const result = redactSecrets("postgres://appuser:hunter2hunter2@db.internal:5432/app");

    expect(result.redacted).toContain("db.internal");
    expect(result.redacted).toContain("appuser");
    expect(result.redacted).not.toContain("hunter2hunter2");
  });

  it("leaves correct environment-variable usage readable", () => {
    // A finding that recommends this pattern has to be able to show it.
    const safe = [
      "const apiKey = process.env.API_KEY;",
      "password: import.meta.env.DB_PASSWORD",
      'const token = "";',
      "api_key: ${API_KEY}",
      "client_secret: <your-client-secret>",
      "password = changeme",
    ];

    for (const line of safe) {
      expect(redactSecrets(line).hadSecrets, line).toBe(false);
    }
  });

  it("is idempotent", () => {
    const once = redactSecrets("ghp_0123456789abcdefghijklmnopqrstuvwxyz").redacted;
    const twice = redactSecrets(once).redacted;

    expect(twice).toBe(once);
  });

  it("does not depend on call order", () => {
    // The detector list holds /g literals, whose lastIndex would otherwise leak
    // between calls and make a later redaction miss a match.
    const text = "AKIAIOSFODNN7EXAMPLE and AKIAIOSFODNN7EXAMPLE";
    const first = redactSecrets(text);
    const second = redactSecrets(text);

    expect(second).toEqual(first);
    expect(first.detections.find((d) => d.detector === "aws_access_key_id")?.count).toBe(2);
  });

  // Two tests are gone with `prepareExcerpt` and `MAX_EXCERPT_LENGTH`: that it
  // redacted before truncating, and that it capped an excerpt's length. Both
  // described preparing customer source for storage, and no customer source is
  // stored — a finding cites `path:line` and the customer reads their own code.
  //
  // What they were protecting against, a truncated credential leaving a usable
  // fragment, cannot arise when nothing is truncated for storage.

  it("finds secrets nested anywhere in a JSON structure", () => {
    const hits = scanForSecrets({
      findings: [
        { title: "fine", whatWeObserved: "The handler validates the caller." },
        { title: "leaky", whatWeObserved: "AKIAIOSFODNN7EXAMPLE" },
      ],
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe("$.findings[1].whatWeObserved");
    expect(hits[0].detectors).toContain("aws_access_key_id");
  });

  it("reports nothing for a clean structure", () => {
    expect(scanForSecrets({ a: ["ok", 1, null, true], b: { c: "also ok" } })).toEqual([]);
  });

  it("keeps the parameter name while removing a credential from a query string", () => {
    const result = redactSecrets("https://api.example.com/items?page=2&api_key=live_abc123def456&sort=name");

    expect(result.redacted).toContain("api_key=");
    expect(result.redacted).not.toContain("live_abc123def456");
    // Ordinary parameters stay readable.
    expect(result.redacted).toContain("page=2");
    expect(result.redacted).toContain("sort=name");
  });

  it("catches a credential in a URL fragment as well as a query", () => {
    expect(containsLikelySecret("https://app.example.com/cb#id_token=eyJhbGciOiJIUzI1NiJ9xyz")).toBe(true);
  });
});

describe("forbidden evidence file names", () => {
  it("refuses files whose whole content is a credential", () => {
    // There is nothing to redact in these — the file IS the secret — so intake
    // refuses them by name rather than reading them.
    for (const name of [
      ".env",
      ".env.production",
      "config/prod/.env",
      "id_rsa",
      "id_ed25519",
      "id_rsa.pub",
      "credentials.json",
      "service-account-prod.json",
      ".npmrc",
      ".netrc",
      "known_hosts",
      "server.pem",
      "cert.p12",
      "signing.key",
      "release.jks",
    ]) {
      expect(isForbiddenEvidenceFilename(name), name).toBe(true);
    }
  });

  it("allows ordinary source and configuration files", () => {
    for (const name of [
      "src/app/page.tsx",
      "package.json",
      "README.md",
      ".env.example",
      "environment.ts",
      "keyboard.ts",
      "monkey.ts",
    ]) {
      expect(isForbiddenEvidenceFilename(name), name).toBe(false);
    }
  });

  it("ignores blank input", () => {
    expect(isForbiddenEvidenceFilename("   ")).toBe(false);
  });
});
