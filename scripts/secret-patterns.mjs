const highConfidencePatterns = [
  {
    name: "AWS access key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    name: "Anthropic API key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    name: "GitHub token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  },
  {
    name: "Google API key",
    pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/,
  },
  {
    name: "OpenAI API key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  },
  {
    name: "Slack token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  },
  {
    name: "private key material",
    pattern:
      /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----[\s\S]{80,}?-----END (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/,
  },
];

export function detectHighConfidenceSecrets(contents) {
  return highConfidencePatterns
    .filter(({ pattern }) => pattern.test(contents))
    .map(({ name }) => name);
}
