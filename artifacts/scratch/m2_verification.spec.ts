import { expect, test } from "@playwright/test";

test.describe("Milestone 2 Forensic Verification", () => {
  test("header resize handles, whole column/row selection, and sheet tab color/reorder", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");
    await expect(page.getByRole("grid")).toBeVisible();

    // 1. Verify header resize handles exist on column and row headers
    const colResizeHandle = page.locator(".oe-col .oe-col-resize").first();
    await expect(colResizeHandle).toBeVisible();

    const rowResizeHandle = page.locator(".oe-row .oe-row-resize").first();
    await expect(rowResizeHandle).toBeVisible();

    // 2. Verify clicking column header selects entire column
    const colAHeader = page.locator(".oe-col").first();
    await colAHeader.click();
    const footerStatus = page.locator("footer.oe-sheets span");
    await expect(footerStatus).toContainText("1048576 × 1");

    // 3. Verify clicking row header selects entire row
    const row1Header = page.locator(".oe-row").first();
    await row1Header.click();
    await expect(footerStatus).toContainText("1 × 16384");

    // 4. Verify clicking corner selects entire sheet
    const corner = page.locator(".oe-corner");
    await corner.click();
    await expect(footerStatus).toContainText("1048576 × 16384");

    // 5. Verify Sheet tab creation, coloring, and reordering
    await page.getByLabel("Add sheet", { exact: true }).click();
    const sheetButtons = page.locator("footer.oe-sheets button:not([aria-label])");
    await expect(sheetButtons).toHaveCount(5); // Sheet1, Sheet2, Rename, Move Left, Move Right

    // Color picker
    const colorInput = page.getByLabel("Tab color", { exact: true });
    await expect(colorInput).toBeVisible();

    // Move Left button is disabled on Sheet1, active on Sheet2
    const moveLeftBtn = page.getByTitle("Move sheet left");
    await expect(moveLeftBtn).toBeEnabled();
    await moveLeftBtn.click(); // Moves Sheet2 left of Sheet1

    // 6. Verify floating Find & Replace dialog opens via Ctrl+F when viewport focused
    await page.getByRole("grid").focus();
    await page.keyboard.press("Control+f");
    const findDialog = page.getByRole("dialog", { name: "Find and Replace" });
    await expect(findDialog).toBeVisible();

    // Check dialog inputs
    const findInput = page.getByPlaceholder("Find text…");
    const replaceInput = page.getByPlaceholder("Replace with…");
    await expect(findInput).toBeVisible();
    await expect(replaceInput).toBeVisible();

    // Close dialog using Close aria-label
    const closeDialogBtn = findDialog.getByRole("button", { name: "Close" });
    await closeDialogBtn.click();
    await expect(findDialog).not.toBeVisible();

    expect(errors).toEqual([]);
  });

  test("interactive floating Find & Replace replaces text across sheet without prompts", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");
    await expect(page.getByRole("grid")).toBeVisible();

    const cell = (address: string) =>
      page.getByRole("gridcell", { name: `${address} cell`, exact: true });
    const formulaBar = page.getByLabel("Formula bar", { exact: true });

    // Populate cells
    await cell("A1").click();
    await formulaBar.fill("Auditor Alpha Test");
    await formulaBar.press("Enter");

    await cell("B2").click();
    await formulaBar.fill("Another Alpha Item");
    await formulaBar.press("Enter");

    await cell("C3").click();
    await formulaBar.fill("Keep Beta Clean");
    await formulaBar.press("Enter");

    // Open Find & Replace via Home tab button
    await page.getByRole("button", { name: "Find & Replace", exact: true }).click();
    const findDialog = page.getByRole("dialog", { name: "Find and Replace" });
    await expect(findDialog).toBeVisible();

    const findInput = page.getByPlaceholder("Find text…");
    const replaceInput = page.getByPlaceholder("Replace with…");

    await findInput.fill("Alpha");
    await replaceInput.fill("Omega");

    // Click Replace All
    await page.getByRole("button", { name: "Replace All", exact: true }).click();

    // Verify status message
    await expect(page.locator(".oe-find-status")).toContainText("Replaced 2 occurrences");

    // Verify cell contents updated
    await expect(cell("A1")).toHaveText("Auditor Omega Test");
    await expect(cell("B2")).toHaveText("Another Omega Item");
    await expect(cell("C3")).toHaveText("Keep Beta Clean");

    // Close dialog using Close aria-label
    await findDialog.getByRole("button", { name: "Close" }).click();
    await expect(findDialog).not.toBeVisible();

    expect(errors).toEqual([]);
  });
});
