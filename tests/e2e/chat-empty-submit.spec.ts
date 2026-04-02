import { expect, test } from "@playwright/test";

test.describe("Playground chat empty submit validation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/playground");
  });

  test("keeps Send disabled for blank or whitespace input", async ({ page }) => {
    const input = page.getByPlaceholder("Send a message");
    const sendButton = page.getByRole("button", { name: "Send" });

    await expect(sendButton).toBeDisabled();

    await input.fill("   ");
    await expect(sendButton).toBeDisabled();

    await input.fill("hi");
    await expect(sendButton).toBeEnabled();
  });

  test("shows validation feedback on Enter with blank input", async ({ page }) => {
    const input = page.getByPlaceholder("Send a message");

    await expect(page.locator(".msg")).toHaveCount(0);
    await input.press("Enter");

    await expect(page.getByText("Message cannot be empty.")).toBeVisible();
    await expect(page.locator(".msg")).toHaveCount(0);
  });

  test("clears validation and submits once input is valid", async ({ page }) => {
    const input = page.getByPlaceholder("Send a message");
    const sendButton = page.getByRole("button", { name: "Send" });

    await input.press("Enter");
    await expect(page.getByText("Message cannot be empty.")).toBeVisible();

    await input.fill("hello");
    await expect(page.getByText("Message cannot be empty.")).toHaveCount(0);
    await expect(sendButton).toBeEnabled();

    await sendButton.click();
    await expect(page.locator(".msg.assistant")).toContainText("Add base URL, API key, and model first.");
  });
});
