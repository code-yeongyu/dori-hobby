import { expect, test } from "@playwright/test";

test.describe("dori-hobby web UI — smoke", () => {
  test("page loads with title and 3 main components", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/dori-hobby/i);
    await expect(page.locator(".stream-cell")).toBeVisible();
    await expect(page.locator(".chat-cell")).toBeVisible();
    await expect(page.locator(".status-cell")).toBeVisible();
  });

  test("stream viewer renders video element with autoplay attrs", async ({
    page,
  }) => {
    await page.goto("/");
    const video = page.locator(".stream-cell video");
    await expect(video).toHaveAttribute("autoplay", /.*/);
    await expect(video).toHaveAttribute("playsinline", /.*/);
    await expect(video).toHaveJSProperty("muted", true);
  });

  test("stream viewer shows non-live state when no publisher", async ({
    page,
  }) => {
    await page.goto("/");
    const overlay = page.locator(
      ".stream-cell .overlay, .stream-cell [data-state='connecting'], .stream-cell [data-state='disconnected']",
    );
    await expect(overlay.first()).toBeVisible({ timeout: 10_000 });
  });

  test("chat panel accepts input and shows the message", async ({ page }) => {
    await page.goto("/");
    const input = page.locator(".chat-cell input[type='text']");
    await input.fill("Hello Dori");
    await input.press("Enter");
    await expect(
      page.locator(".chat-cell").getByText("Hello Dori"),
    ).toBeVisible({ timeout: 5000 });
  });

  test("status bar shows 3 pills (emulator, stream, agent)", async ({
    page,
  }) => {
    await page.goto("/");
    const pills = page.locator(".status-cell .pill");
    await expect(pills).toHaveCount(3);
  });

  test("mobile viewport stacks layout vertically", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.locator(".stream-cell")).toBeVisible();
    await expect(page.locator(".chat-cell")).toBeVisible();
    await expect(page.locator(".status-cell")).toBeVisible();

    const streamBox = await page.locator(".stream-cell").boundingBox();
    const chatBox = await page.locator(".chat-cell").boundingBox();
    expect(streamBox).not.toBeNull();
    expect(chatBox).not.toBeNull();
    if (streamBox !== null && chatBox !== null) {
      expect(chatBox.y).toBeGreaterThanOrEqual(streamBox.y);
    }
  });
});
