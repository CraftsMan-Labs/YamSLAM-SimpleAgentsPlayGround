import { expect, test } from "@playwright/test";

test.describe("Playground example switching behavior", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/playground");
  });

  test("switching examples clears stale chat and run context", async ({ page }) => {
    const input = page.getByRole("textbox", { name: "Chat message" });
    const sendButton = page.getByRole("button", { name: "Send" });
    const selector = page.getByLabel("Workflow Template");

    await input.fill("hello");
    await sendButton.click();

    await expect(page.locator(".msg.assistant")).toContainText("Add base URL, API key, and model first.");
    await expect(page.locator(".run-state-dot")).toContainText("FAILED");

    await selector.selectOption("Email Chat Draft (graph sample)");

    await expect(page.locator(".msg")).toHaveCount(0);
    await expect(page.locator(".run-state-dot")).toContainText("IDLE");
    await expect(page.getByLabel("YAML Workflow Editor")).toContainText("id: email-chat-draft-or-clarify");
  });

  test("email chat draft sample does not preload unrelated interview helper code", async ({ page }) => {
    const selector = page.getByLabel("Workflow Template");
    const codeEditor = page.getByLabel("Custom JS/TS Functions");

    await selector.selectOption("Email Chat Draft (graph sample)");

    await expect(page.getByLabel("YAML Workflow Editor")).toContainText("id: email-chat-draft-or-clarify");
    await expect(codeEditor).toHaveValue("");
    await expect(codeEditor).not.toHaveValue(/GetRagData/);
    await expect(codeEditor).not.toHaveValue(/already_terminated/);
    await expect(codeEditor).not.toHaveValue(/terminated/);
  });
});
