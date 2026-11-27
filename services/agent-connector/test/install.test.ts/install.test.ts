/**
 * The install line each agent shows, by system: the Windows line on Windows,
 * the Mac and Linux line elsewhere, and only the install page when an agent
 * has no Windows line.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { antigravityAdapter } from "../src/agents/antigravity.ts";
import { claudeAdapter } from "../src/agents/claude.ts";
import { codexAdapter } from "../src/agents/codex.ts";
import { copilotAdapter } from "../src/agents/copilot.ts";
import { cursorAdapter } from "../src/agents/cursor.ts";
import { openCodeAdapter } from "../src/agents/opencode.ts";
import { installForPlatform } from "../src/agents/types.ts";

test("Claude Code shows its Windows install line on Windows, its shell line elsewhere", () => {
  const install = claudeAdapter().install;
  assert.ok(install);
  assert.equal(installForPlatform(install, "win32").command, "irm https://claude.ai/install.ps1 | iex");
  assert.equal(installForPlatform(install, "darwin").command, "curl -fsSL https://claude.ai/install.sh | bash");
  assert.equal(installForPlatform(install, "linux").command, "curl -fsSL https://claude.ai/install.sh | bash");
  assert.equal(installForPlatform(install, "win32").url, "https://code.claude.com/docs/en/setup");
});

test("GitHub Copilot shows its npm line on every system", () => {
  const install = copilotAdapter().install;
  assert.ok(install);
  assert.equal(installForPlatform(install, "win32").command, "npm install -g @github/copilot");
  assert.equal(installForPlatform(install, "darwin").command, "npm install -g @github/copilot");
  assert.equal(installForPlatform(install, "linux").command, "npm install -g @github/copilot");
});

test("agents without a Windows line show only their install page on Windows, their shell line elsewhere", () => {
  const cases = [
    {
      install: antigravityAdapter().install,
      command: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
      url: "https://antigravity.google/docs/getting-started?tab=cli",
    },
    {
      install: codexAdapter().install,
      command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
      url: "https://github.com/openai/codex",
    },
    {
      install: cursorAdapter().install,
      command: "curl https://cursor.com/install -fsS | bash",
      url: "https://cursor.com/docs/cli/installation",
    },
    {
      install: openCodeAdapter().install,
      command: "curl -fsSL https://opencode.ai/v2/install | bash",
      url: "https://opencode.ai/docs",
    },
  ];
  for (const { install, command, url } of cases) {
    assert.ok(install);
    assert.equal(installForPlatform(install, "win32").command, undefined);
    assert.equal(installForPlatform(install, "win32").url, url);
    assert.equal(installForPlatform(install, "darwin").command, command);
  }
});
