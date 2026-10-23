import { expect, test } from "@playwright/test";

test.describe("Spreadsheet interactive UI behavior", () => {
	test("cell selection, keyboard navigation, and Name Box jumping", async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));

		await page.goto("/");
		await expect(page.getByRole("grid")).toBeVisible();

		const cell = (address: string) =>
			page.getByRole("gridcell", { name: `${address} cell`, exact: true });
		const nameBox = page.getByLabel("Name box", { exact: true });
		const formulaBar = page.getByLabel("Formula bar", { exact: true });

		// 1. Initial active cell should be A1
		await cell("A1").click();
		await expect(nameBox).toHaveValue("A1");

		// 2. Keyboard navigation via arrow keys
		await page.keyboard.press("ArrowRight");
		await expect(nameBox).toHaveValue("B1");

		await page.keyboard.press("ArrowDown");
		await expect(nameBox).toHaveValue("B2");

		await page.keyboard.press("ArrowLeft");
		await expect(nameBox).toHaveValue("A2");

		await page.keyboard.press("ArrowUp");
		await expect(nameBox).toHaveValue("A1");

		// 3. Navigation via Tab (moves right) and Enter (moves down)
		await page.keyboard.press("Tab");
		await expect(nameBox).toHaveValue("B1");

		await page.keyboard.press("Enter");
		await expect(nameBox).toHaveValue("B2");

		// 4. Name Box direct coordinate jump
		await nameBox.fill("D15");
		await nameBox.press("Enter");
		await expect(cell("D15")).toBeVisible();
		await expect(nameBox).toHaveValue("D15");

		// Input value at D15
		await formulaBar.fill("JumpTarget");
		await formulaBar.press("Enter");
		await expect(cell("D15")).toHaveText("JumpTarget");

		// Jump back to A1
		await nameBox.fill("A1");
		await nameBox.press("Enter");
		await expect(nameBox).toHaveValue("A1");

		expect(errors).toEqual([]);
	});

	test("formula bar input, in-cell double-click editing, and formula recalculation", async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));

		await page.goto("/");
		await expect(page.getByRole("grid")).toBeVisible();

		const cell = (address: string) =>
			page.getByRole("gridcell", { name: `${address} cell`, exact: true });
		const formulaBar = page.getByLabel("Formula bar", { exact: true });

		const inputViaFormulaBar = async (address: string, text: string) => {
			await cell(address).click();
			await formulaBar.fill(text);
			await formulaBar.press("Enter");
		};

		// 1. Enter numeric values in B1 and B2, and formula in B3
		await inputViaFormulaBar("B1", "40");
		await inputViaFormulaBar("B2", "60");
		await inputViaFormulaBar("B3", "=B1+B2");

		// B3 should calculate to 100
		await expect(cell("B3")).toHaveText("100");

		// 2. In-cell editing via double click on B1
		await cell("B1").dblclick();
		const inCellEditor = page.getByLabel("Cell editor", { exact: true });
		await expect(inCellEditor).toBeVisible();

		// Change B1 from 40 to 140
		await inCellEditor.fill("140");
		await inCellEditor.press("Enter");

		// B1 has 140, B3 automatically recalculates to 200
		await expect(cell("B1")).toHaveText("140");
		await expect(cell("B3")).toHaveText("200");

		// 3. Dynamic array formula spill: =SEQUENCE(2, 2, 5, 5) into C1
		await inputViaFormulaBar("C1", "=SEQUENCE(2, 2, 5, 5)");
		// Spilled values:
		// C1: 5, D1: 10
		// C2: 15, D2: 20
		await expect(cell("C1")).toHaveText("5");
		await expect(cell("D1")).toHaveText("10");
		await expect(cell("C2")).toHaveText("15");
		await expect(cell("D2")).toHaveText("20");

		// Sum formula referencing spilled range
		await inputViaFormulaBar("E1", "=SUM(C1:D2)");
		await expect(cell("E1")).toHaveText("50");

		expect(errors).toEqual([]);
	});

	test("chart insertion and dynamic reactivity to cell data changes", async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));

		await page.goto("/");
		await expect(page.getByRole("grid")).toBeVisible();

		const cell = (address: string) =>
			page.getByRole("gridcell", { name: `${address} cell`, exact: true });
		const nameBox = page.getByLabel("Name box", { exact: true });
		const formulaBar = page.getByLabel("Formula bar", { exact: true });

		const input = async (address: string, text: string) => {
			await cell(address).click();
			await formulaBar.fill(text);
			await formulaBar.press("Enter");
		};

		// 1. Setup categorical data and values
		await input("A1", "Category");
		await input("B1", "Score");
		await input("A2", "Design");
		await input("B2", "35");
		await input("A3", "Development");
		await input("B3", "75");

		// 2. Select data range A1:B3
		await nameBox.fill("A1:B3");
		await nameBox.press("Enter");

		// 3. Switch to Insert tab and insert chart
		await page.getByRole("button", { name: "Insert", exact: true }).click();
		await page
			.getByRole("button", { name: "Insert chart", exact: true })
			.click();

		// 4. Verify chart rendered with SVG
		const chartSvg = page.locator("svg").first();
		await expect(chartSvg).toBeVisible();

		// Capture initial SVG representation
		const initialSvgContent = await chartSvg.innerHTML();
		expect(initialSvgContent.length).toBeGreaterThan(50);

		// 5. Update data: Change Development score in B3 from 75 to 250
		await input("B3", "250");
		await expect(cell("B3")).toHaveText("250");

		// Verify chart reactively re-renders with new SVG state
		await expect(async () => {
			const updatedSvgContent = await chartSvg.innerHTML();
			expect(updatedSvgContent).not.toEqual(initialSvgContent);
		}).toPass({ timeout: 5000 });

		expect(errors).toEqual([]);
	});

	test("Find & Replace dialog locates matching cells and updates text across sheet", async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));

		await page.goto("/");
		await expect(page.getByRole("grid")).toBeVisible();

		const cell = (address: string) =>
			page.getByRole("gridcell", { name: `${address} cell`, exact: true });
		const formulaBar = page.getByLabel("Formula bar", { exact: true });

		const input = async (address: string, text: string) => {
			await cell(address).click();
			await formulaBar.fill(text);
			await formulaBar.press("Enter");
		};

		// 1. Populate multiple cells with target substring
		await input("A1", "Region Alpha");
		await input("A2", "Alpha Team");
		await input("A3", "Beta Division");
		await input("B1", "Alpha Status");

		await expect(cell("A1")).toHaveText("Region Alpha");
		await expect(cell("A2")).toHaveText("Alpha Team");
		await expect(cell("A3")).toHaveText("Beta Division");
		await expect(cell("B1")).toHaveText("Alpha Status");

		// 2. Handle successive prompts for Find & Replace:
		// Prompt 1: "Find text" -> provide "Alpha"
		// Prompt 2: "Replace with" -> provide "Gamma"
		let promptStep = 0;
		page.on("dialog", async (dialog) => {
			promptStep++;
			if (promptStep === 1) {
				expect(dialog.message()).toContain("Find text");
				await dialog.accept("Alpha");
			} else if (promptStep === 2) {
				expect(dialog.message()).toContain("Replace with");
				await dialog.accept("Gamma");
			} else {
				await dialog.dismiss();
			}
		});

		// 3. Switch to Review tab and trigger Find and replace
		await page.getByRole("button", { name: "Review", exact: true }).click();
		await page
			.getByRole("button", { name: "Find and replace", exact: true })
			.click();

		// 4. Verify cells updated with replacement
		await expect(cell("A1")).toHaveText("Region Gamma");
		await expect(cell("A2")).toHaveText("Gamma Team");
		await expect(cell("A3")).toHaveText("Beta Division"); // Unchanged
		await expect(cell("B1")).toHaveText("Gamma Status");

		expect(errors).toEqual([]);
	});

	test("sheet tabs creation and tab switching preserves worksheet state", async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));

		await page.goto("/");
		await expect(page.getByRole("grid")).toBeVisible();

		const cell = (address: string) =>
			page.getByRole("gridcell", { name: `${address} cell`, exact: true });
		const formulaBar = page.getByLabel("Formula bar", { exact: true });

		// Write on Sheet1
		await cell("A1").click();
		await formulaBar.fill("Sheet1Data");
		await formulaBar.press("Enter");
		await expect(cell("A1")).toHaveText("Sheet1Data");

		// Click Add sheet button (+)
		await page.getByLabel("Add sheet", { exact: true }).click();

		// Verify footer contains Sheet2
		const footer = page.locator("footer.oe-sheets");
		await expect(
			footer.getByRole("button", { name: "Sheet2", exact: true }),
		).toBeVisible();

		// Cell A1 on Sheet2 should initially be empty
		await expect(cell("A1")).toHaveText("");

		// Write on Sheet2
		await cell("A1").click();
		await formulaBar.fill("Sheet2Data");
		await formulaBar.press("Enter");
		await expect(cell("A1")).toHaveText("Sheet2Data");

		// Switch back to Sheet1
		await footer.getByRole("button", { name: "Sheet1", exact: true }).click();

		// Verify Sheet1 has preserved 'Sheet1Data'
		await expect(cell("A1")).toHaveText("Sheet1Data");

		// Switch back to Sheet2
		await footer.getByRole("button", { name: "Sheet2", exact: true }).click();
		await expect(cell("A1")).toHaveText("Sheet2Data");

		expect(errors).toEqual([]);
	});

	test("formatting toggles (strikethrough, italic) and table insertion UI", async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));

		await page.goto("/");
		await expect(page.getByRole("grid")).toBeVisible();

		const cell = (address: string) =>
			page.getByRole("gridcell", { name: `${address} cell`, exact: true });

		// Click Home tab
		await page.getByRole("button", { name: "Home", exact: true }).click();

		// Click A1, toggle Strikethrough
		await cell("A1").click();
		const strikeBtn = page.getByRole("button", { name: "Strikethrough", exact: true });
		await expect(strikeBtn).toBeVisible();
		await strikeBtn.click();
		await expect(strikeBtn).toHaveClass(/selected/);
		await expect(cell("A1")).toHaveCSS("text-decoration-line", "line-through");

		// Toggle Strikethrough off
		await strikeBtn.click();
		await expect(strikeBtn).not.toHaveClass(/selected/);

		// Toggle Italic on then off
		const italicBtn = page.getByRole("button", { name: "Italic", exact: true });
		await italicBtn.click();
		await expect(italicBtn).toHaveClass(/selected/);
		await expect(cell("A1")).toHaveCSS("font-style", "italic");
		await italicBtn.click();
		await expect(italicBtn).not.toHaveClass(/selected/);
		await expect(cell("A1")).not.toHaveCSS("font-style", "italic");

		// Switch to Insert tab and test Table insertion
		await page.getByRole("button", { name: "Insert", exact: true }).click();
		const tableBtn = page.getByRole("button", { name: "Insert table", exact: true });
		await expect(tableBtn).toBeVisible();
		await tableBtn.click();

		// Verify top cell A1 has been authored with default header "Column1"
		await expect(cell("A1")).toHaveText("Column1");

		expect(errors).toEqual([]);
	});
});

