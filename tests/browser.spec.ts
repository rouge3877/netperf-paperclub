import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Store } from "../src/server/db.ts";
import { initializeAdmin } from "../src/server/admin.ts";
import {
  browserDatabase,
  browserPassword as password,
  resetBrowserDatabase,
} from "./fixtures/browser-db.ts";

test.beforeEach(async () => {
  await resetBrowserDatabase();
});
async function accessibility(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
}
test("serves the application shell without exposing corpus or runtime files", async ({
  request,
}) => {
  expect((await request.get("/")).status()).toBe(200);
  expect((await request.get("/healthz")).status()).toBe(200);
  expect((await request.get("/api/papers")).status()).toBe(401);
  for (const path of [
    "/.env",
    "/var/paperclub.sqlite",
    "/data/papers.json",
    "/corpus/nsdi/2024/example.json",
    "/unknown",
  ])
    expect((await request.get(path)).status()).toBe(404);
});
async function login(page: Page, username = "alice") {
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All Paper" })).toBeVisible();
  await expect(page.locator(".library-reading")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}
async function manage(page: Page, action: string) {
  await page.locator(".folder-menu > summary").click();
  await page
    .locator(".folder-menu")
    .getByRole("button", { name: action, exact: true })
    .click();
}
async function createFolder(
  page: Page,
  name: string,
  visible = "private",
  ordered = true,
) {
  await page.getByRole("link", { name: "Paper Folders", exact: true }).click();
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("A browser-tested reading sequence.");
  await dialog.getByLabel("Ordered reading folder").setChecked(ordered);
  await dialog.getByLabel("Visibility").selectOption(visible);
  await dialog
    .getByRole("button", { name: "Create folder", exact: true })
    .click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return page.url().split("#folder/")[1];
}
test("full folder lifecycle, ordering, reading, collaboration, fork and discussion", async ({
  page,
  browser,
}) => {
  await login(page);
  const id = await createFolder(page, "Transport reading sequence", "public");
  await page.getByRole("button", { name: "Add papers", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Select all results", { exact: true }),
  ).toBeVisible();
  await expect(dialog.locator(".picker-row")).toHaveCount(40);
  for (const checkbox of await dialog
    .locator(".picker-row input")
    .all()
    .then((xs) => xs.slice(0, 3)))
    await checkbox.check();
  await dialog.getByRole("button", { name: "Review 3 papers" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Review additions" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Add 3 papers", exact: true })
    .click();
  await expect(page.locator(".folder-paper")).toHaveCount(3);
  const initialTitles = await page
    .locator(".folder-paper h2")
    .allTextContents();
  await page.getByLabel("Reading order", { exact: true }).selectOption("title");
  await page.getByRole("button", { name: "Save reading order" }).click();
  await expect(
    page.getByRole("button", { name: "Save reading order" }),
  ).toHaveCount(0);
  await expect(page.locator(".folder-paper")).toHaveCount(3);
  const titles = await page.locator(".folder-paper h2").allTextContents();
  expect([...titles].sort((a, b) => a.localeCompare(b, "en"))).toEqual(titles);
  expect(new Set(titles)).toEqual(new Set(initialTitles));
  await page.getByRole("link", { name: "Continue reading" }).click();
  await page
    .getByRole("button", { name: "Mark as completed", exact: true })
    .click();
  await expect(
    page.getByText("1 of 3 papers completed · Your progress is private"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next paper →" }).click();
  await expect(page.getByLabel("Current paper")).not.toHaveValue("");
  await page.reload();
  await expect(
    page.getByText("1 of 3 papers completed · Your progress is private"),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "← Transport reading sequence" })
    .click();
  await page
    .getByLabel("Add a comment", { exact: true })
    .fill("A useful starting point for our group.");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(
    page.getByText("A useful starting point for our group."),
  ).toBeVisible();
  await manage(page, "Collaborators");
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Add collaborator", exact: true })
    .selectOption({ label: "Bob (@bob)" });
  await dialog
    .getByRole("button", { name: "Add collaborator", exact: true })
    .click();
  await expect(page.getByText("1 collaborator", { exact: true })).toBeVisible();
  const context = await browser.newContext(),
    bob = await context.newPage();
  await login(bob, "bob");
  await bob.goto(`/#folder/${id}`);
  await expect(
    bob.getByRole("button", { name: "Add papers", exact: true }),
  ).toBeVisible();
  await expect(
    bob.getByRole("button", { name: "Collaborators", exact: true }),
  ).toHaveCount(0);
  await expect(
    bob.getByText("0 completed by you", { exact: true }),
  ).toBeVisible();
  await bob.getByRole("button", { name: "☆ Star · 0", exact: true }).click();
  await expect(
    bob.getByRole("button", { name: "★ Starred · 1", exact: true }),
  ).toBeVisible();
  await manage(bob, "Fork folder");
  dialog = bob.getByRole("dialog");
  await dialog.getByLabel("Copy name").fill("Bob independent copy");
  await dialog.getByRole("button", { name: "Create private copy" }).click();
  await expect(
    bob.getByRole("heading", { name: "Bob independent copy" }),
  ).toBeVisible();
  await expect(bob.getByText("private", { exact: true })).toBeVisible();
  await expect(
    bob.getByText("A useful starting point for our group."),
  ).toHaveCount(0);
  await manage(page, "Settings");
  await page
    .getByRole("dialog")
    .getByLabel("Visibility")
    .selectOption("private");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save settings" })
    .click();
  await expect(page.getByText("private", { exact: true })).toBeVisible();
  await manage(page, "Collaborators");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect(page.getByText("1 collaborator", { exact: true })).toHaveCount(
    0,
  );
  await bob.goto(`/#folder/${id}`);
  await expect(bob.getByRole("alert")).toContainText("Folder not found");
  await context.close();
});
test("paper ratings, comment editing and strict-majority topics through UI", async ({
  page,
  browser,
}) => {
  await login(page);
  await page.locator(".paper-card h2 a").first().click();
  const url = page.url();
  await page.getByLabel("Your rating").selectOption("5");
  await expect(page.getByLabel("Your rating")).toHaveValue("5");
  await page.reload();
  await expect(page.getByLabel("Your rating")).toHaveValue("5");
  await page
    .getByLabel("Add a comment", { exact: true })
    .fill("Worth discussing in the next session.");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(
    page.getByText("Worth discussing in the next session."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Comment", exact: true })
    .fill("Updated after reading the abstract.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save comment" })
    .click();
  await expect(
    page.getByText("Updated after reading the abstract."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Propose topic change" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("New topic name").fill("Network Systems, Transport");
  await dialog.getByRole("button", { name: "Add topic", exact: true }).click();
  await expect(
    dialog.getByRole("button", {
      name: "Network Systems, Transport",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("The abstract studies network and system behavior.");
  await dialog.getByRole("button", { name: "Submit proposal" }).click();
  await expect(page.getByText("2 required", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Pinned", { exact: true })).toBeVisible();
  const context = await browser.newContext(),
    bob = await context.newPage();
  await login(bob, "bob");
  await bob.goto(url);
  await bob.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    bob.getByText("Adopted with 2 of 3 members", { exact: true }),
  ).toBeVisible();
  await expect(
    bob
      .locator(".paper-card .chip")
      .getByText("Network Systems, Transport", { exact: true }),
  ).toBeVisible();
  await context.close();
});
test("responsive layout and core accessibility", async ({ page }) => {
  await page.goto("/");
  let scan = await accessibility(page);
  expect(scan.violations).toEqual([]);
  await login(page, "carol");
  scan = await accessibility(page);
  expect(scan.violations).toEqual([]);
  await page.screenshot({
    animations: "disabled",
    path: "reports/desktop-papers.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "All Paper" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    animations: "disabled",
    path: "reports/mobile-papers.png",
    fullPage: false,
  });
  await page.getByRole("link", { name: "Paper Folders", exact: true }).click();
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.locator("body").evaluate((el) => el.style.overflow)).toBe(
    "hidden",
  );
  scan = await accessibility(page);
  expect(scan.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New folder", exact: true }),
  ).toBeFocused();
  expect(await page.locator("body").evaluate((el) => el.style.overflow)).toBe(
    "",
  );
  const route = page.url();
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  expect(page.url()).toBe(route);
});

test("filter requests retain content and scroll, ignore stale results and debounce search", async ({
  page,
}) => {
  await login(page, "carol");
  await expect(page.locator(".paper-card")).toHaveCount(30);
  const title = await page.locator(".paper-card h2").first().innerText();
  await page.evaluate(() => window.scrollTo(0, 600));
  const position = await page.evaluate(() => ({
    y: scrollY,
    x: document.querySelector(".library-reading")!.getBoundingClientRect().x,
  }));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route("**/api/papers?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.getAll("conference").join() === "NSDI") {
      held = true;
      await gate;
    }
    await route.continue().catch(() => {});
  });
  const sidebar = page.getByRole("complementary", { name: "Paper filters" });
  try {
    await sidebar.getByRole("button", { name: "NSDI", exact: true }).click();
    await expect.poll(() => held).toBe(true);
    await expect(page.locator(".library-reading")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.locator(".paper-card")).toHaveCount(30);
    await expect(page.locator(".paper-card h2").first()).toHaveText(title);
    expect(await page.evaluate(() => scrollY)).toBe(position.y);
    expect(
      await page
        .locator(".library-reading")
        .evaluate((el) => el.getBoundingClientRect().x),
    ).toBe(position.x);
    await expect(
      page.getByRole("button", { name: "Select all results", exact: true }),
    ).toBeDisabled();
    await sidebar.getByRole("button", { name: "SIGCOMM", exact: true }).click();
    await expect(page.locator(".library-reading")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.locator(".library-count")).toContainText("1,919 papers");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(page.locator(".library-count")).toContainText("1,919 papers");
  const searches: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/papers" && url.searchParams.get("q"))
      searches.push(url.searchParams.get("q")!);
  });
  await page
    .getByRole("searchbox", { name: "Search the library" })
    .pressSequentially("MirSwitch", { delay: 20 });
  await expect(page.locator(".library-count")).toContainText("1 paper");
  await expect(page.locator(".paper-card")).toHaveCount(1);
  expect(searches).toEqual(["MirSwitch"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".paper-card")
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe("none");
});

test("cross-page selections, filtered bulk additions, manual ordering and unordered copies", async ({
  page,
}) => {
  await login(page);
  const sourceId = await createFolder(page, "Bulk source", "public");
  await page.getByRole("button", { name: "Add papers", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Conference", exact: true })
    .selectOption("NSDI");
  await dialog.getByLabel("Year", { exact: true }).fill("2024");
  await expect(dialog.locator(".picker-row")).toHaveCount(40);
  await expect(dialog.locator(".picker-row").first()).toContainText(
    "NSDI 2024",
  );
  await dialog.locator(".picker-row input").first().check();
  await dialog.getByRole("button", { name: "Next results" }).click();
  await expect(dialog.locator(".pagination")).toContainText("41–");
  await expect(dialog.locator(".picker-row input").first()).not.toBeChecked();
  await dialog.locator(".picker-row input").first().check();
  await dialog.getByRole("button", { name: "Previous results" }).click();
  await expect(dialog.locator(".pagination")).toContainText("1–40");
  await expect(dialog.locator(".picker-row input").first()).toBeChecked();
  await dialog.getByRole("button", { name: "Review 2 papers" }).click();
  await dialog
    .getByRole("button", { name: "Add 2 papers", exact: true })
    .click();
  await expect(page.locator(".folder-paper")).toHaveCount(2);
  const original = await page.locator(".folder-paper h2").allTextContents();
  await page.getByRole("button", { name: "Add papers", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Conference", exact: true })
    .selectOption("NSDI");
  await dialog.getByLabel("Year", { exact: true }).fill("2024");
  await expect(dialog.locator(".picker-row").first()).toContainText(
    "NSDI 2024",
  );
  await expect(dialog.locator(".picker-row input").first()).toBeDisabled();
  const total = Number(
    (await dialog.locator(".pagination").innerText()).match(/of\s+(\d+)/)![1],
  );
  expect(total).toBeGreaterThan(40);
  await dialog
    .getByRole("button", { name: "Select all results", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: `Review ${total - 2} papers` })
    .click();
  await expect(dialog.locator(".preview-list li")).toHaveCount(total - 2);
  await dialog.getByLabel("Sort additions").selectOption("title");
  await dialog.getByRole("button", { name: "Preview sort" }).click();
  const preview = await dialog
    .locator(".preview-list li > span")
    .allTextContents();
  expect(preview).toEqual(
    [...preview].sort((a, b) => a.localeCompare(b, "en")),
  );
  await dialog.getByLabel("Insert papers").selectOption("start");
  await dialog
    .getByRole("button", { name: `Add ${total - 2} papers`, exact: true })
    .click();
  await expect(page.locator(".folder-paper")).toHaveCount(total);
  const combined = await page.locator(".folder-paper h2").allTextContents();
  expect(combined).toEqual([...preview, ...original]);
  expect(new Set(combined).size).toBe(total);

  await page.locator(".folder-paper").last().getByRole("checkbox").check();
  await page.getByRole("button", { name: "Move to top" }).click();
  await expect(page.locator(".folder-paper h2").first()).toHaveText(
    combined.at(-1)!,
  );
  await page
    .locator(".folder-paper")
    .first()
    .getByRole("button", { name: / down$/ })
    .click();
  await expect(page.locator(".folder-paper h2").nth(1)).toHaveText(
    combined.at(-1)!,
  );
  await page.getByRole("button", { name: "Save reading order" }).click();
  await expect(
    page.getByRole("button", { name: "Save reading order" }),
  ).toHaveCount(0);
  await expect(page.locator(".folder-paper")).toHaveCount(total);
  await expect(page.locator(".folder-paper h2").nth(1)).toHaveText(
    combined.at(-1)!,
  );
  const sourceTitles = await page.locator(".folder-paper h2").allTextContents();

  await createFolder(page, "Unordered copied collection", "private", false);
  await expect(
    page.getByRole("link", { name: "Continue reading" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Reading order", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Add papers", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Copy from a folder" }).click();
  await dialog.getByLabel("Source folder").selectOption(sourceId);
  await expect(dialog.locator(".picker-row")).toHaveCount(total);
  await dialog.getByRole("button", { name: "Select all results" }).click();
  await dialog.getByRole("button", { name: `Review ${total} papers` }).click();
  await expect(dialog.locator(".preview-list li")).toHaveCount(total);
  await expect(dialog.getByLabel("Insert papers")).toHaveCount(0);
  expect(
    await dialog.locator(".preview-list li > span").allTextContents(),
  ).toEqual(sourceTitles);
  await dialog
    .getByRole("button", { name: `Add ${total} papers`, exact: true })
    .click();
  await expect(page.locator(".folder-paper")).toHaveCount(total);
  await page.reload();
  await expect(page.locator(".folder-paper")).toHaveCount(total);
  await page.getByRole("button", { name: "Add papers", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Copy from a folder" }).click();
  await dialog.getByLabel("Source folder").selectOption(sourceId);
  await expect(dialog.locator(".picker-row")).toHaveCount(total);
  await expect(
    dialog.getByRole("button", { name: "Select all results" }),
  ).toBeDisabled();
});

test("continuous library, multi-select filters and contextual return state", async ({
  page,
}) => {
  await login(page, "carol");
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }).getByRole("link"),
  ).toHaveText(["All Paper", "Paper Folders", "Community"]);
  const sidebar = page.getByRole("complementary", { name: "Paper filters" });
  await sidebar.getByRole("button", { name: "NSDI", exact: true }).click();
  await sidebar.getByRole("button", { name: "2024", exact: true }).click();
  await expect(page.locator(".paper-card .eyebrow").first()).toHaveText(
    "NSDI 2024",
  );
  await sidebar.getByRole("button", { name: "SIGCOMM", exact: true }).click();
  await expect(
    sidebar.getByRole("button", { name: "NSDI", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    sidebar.getByRole("button", { name: "SIGCOMM", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Single paper" })).toHaveCount(
    0,
  );
  await expect(page.locator(".library-reading")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator(".library-reading .paper-card")).toHaveCount(30);
  await expect(
    page.locator(".library-reading .abstract").first(),
  ).not.toHaveClass(/excerpt/);
  const second = await page.locator(".paper-card h2").nth(1).innerText();
  await page.locator(".paper-card h2 a").nth(1).click();
  await page.reload();
  await page.getByRole("link", { name: "← All Paper" }).click();
  await expect(page.locator(".paper-card h2").nth(1)).toHaveText(second);
  await expect(page.locator(".paper-card h2").nth(1)).toBeInViewport();
  await page.reload();
  await expect(page.locator(".paper-card h2").nth(1)).toHaveText(second);
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect((await accessibility(page)).violations).toEqual([]);
  await page.screenshot({
    animations: "disabled",
    path: "reports/dark-reading.png",
  });
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Filters (3)", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Paper filters" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Reset filters" })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Filters", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".library-reading .paper-card")).toHaveCount(30);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("unified folder tabs and community priorities, comments, votes and history", async ({
  page,
  request,
}) => {
  await login(page, "carol");
  const folderId = await createFolder(
    page,
    "Private community test",
    "private",
  );
  const post = async (path: string, body: unknown, method = "POST") => {
    const response = await page.request.fetch(`/api${path}`, {
      method,
      data: body,
      headers: { Origin: "http://127.0.0.1:4173" },
    });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  await post("/comments", {
    folderId,
    body: "A private folder-only conversation.",
  });
  const papers = (
    await (await page.request.get("/api/papers?offset=100&limit=3")).json()
  ).papers;
  // Create this test's own adopted proposal and historical comment.
  const history = await post(`/papers/${papers[2].id}/proposals`, {
    revision: papers[2].topicRevision,
    topics: ["Network systems"],
    reason: "The paper evaluates a network system.",
  });
  await post(`/proposals/${history.id}/vote`, { choice: "yes" });
  const headers = { Origin: "http://127.0.0.1:4173" };
  expect(
    (
      await request.post("/api/auth/login", {
        headers,
        data: { username: "bob", password },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post(`/api/proposals/${history.id}/vote`, {
        headers,
        data: { choice: "yes" },
      })
    ).ok(),
  ).toBe(true);
  await post("/comments", {
    paperId: papers[2].id,
    body: "A historical paper observation.",
  });
  const shared = await post("/folders", {
    name: "Community shared collection",
    visibility: "public",
    ordered: false,
    description: "Papers shared with members.",
  });
  await post(`/folders/${shared.id}/star`, { starred: true }, "PUT");
  await page.getByRole("link", { name: "Paper Folders", exact: true }).click();
  await page.getByRole("link", { name: "Shared Folders", exact: true }).click();
  await expect(
    page
      .locator(".folder-card")
      .filter({ hasText: "Community shared collection" }),
  ).toBeVisible();
  await expect(
    page.locator(".folder-card").filter({ hasText: "Private community test" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Starred", exact: true }).click();
  await expect(
    page
      .locator(".folder-card")
      .filter({ hasText: "Community shared collection" }),
  ).toBeVisible();
  await post(`/papers/${papers[0].id}/proposals`, {
    revision: papers[0].topicRevision,
    topics: ["Networks, measurement and performance"],
    reason: "The evaluation measures network performance under load.",
  });
  await post("/comments", {
    paperId: papers[0].id,
    body: "An earlier paper observation.",
  });
  await post("/comments", {
    paperId: papers[1].id,
    body: "The latest paper observation.",
  });
  await page.getByRole("link", { name: "Community", exact: true }).click();
  await expect(page.locator(".activity-item").first()).toContainText("Pinned");
  await expect(
    page.locator(".community-feed .comment-activity").first(),
  ).toContainText("The latest paper observation.");
  await expect(
    page.getByText("A private folder-only conversation."),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approved", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("1 for · 0 against", { exact: false }),
  ).toBeVisible();
  expect((await accessibility(page)).violations).toEqual([]);
  await page.screenshot({
    animations: "disabled",
    path: "reports/community-desktop.png",
  });
  await page
    .locator(".community-feed .comment-activity")
    .first()
    .getByRole("link", { name: "Discuss" })
    .click();
  await expect(
    page.getByRole("heading", { name: /Discussion/ }).first(),
  ).toBeInViewport();
  await page.getByRole("link", { name: "← Community" }).click();
  await expect(page.locator(".community-feed > .activity-item")).toHaveCount(5);
  await expect(page.getByText("Adopted with 2 of 3 members")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    animations: "disabled",
    path: "reports/community-mobile.png",
  });
});

test("folder notes, inline ordering and reading-discussion return survive navigation and reload", async ({
  page,
}) => {
  await login(page, "carol");
  const id = await createFolder(page, "Measurement reading plan", "public");
  await page.getByRole("button", { name: "Add papers", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".picker-row")).toHaveCount(40);
  for (const row of (await dialog.locator(".picker-row").all()).slice(0, 3))
    await row.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Review 3 papers" }).click();
  await dialog
    .getByRole("button", { name: "Add 3 papers", exact: true })
    .click();
  const rows = page.locator(".folder-paper");
  await expect(rows).toHaveCount(3);
  const titles = await rows.locator("h2").allTextContents();
  const note =
    "Read this after the baseline paper.\nCompare the measurement assumptions and limitations.";
  await rows
    .nth(1)
    .getByRole("button", { name: "Add note", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Folder note", exact: true })
    .fill(note);
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(rows.nth(1).locator(".folder-note")).toHaveText(note);
  await page.reload();
  await expect(rows.nth(1).locator(".folder-note")).toHaveText(note);

  await rows.nth(1).getByRole("button", { name: / up$/ }).click();
  await expect(rows.locator("h2").first()).toHaveText(titles[1]);
  await expect(rows.first().locator(".folder-note")).toHaveText(note);
  await page.getByRole("button", { name: "Cancel order" }).click();
  await expect(rows.locator("h2").nth(1)).toHaveText(titles[1]);
  await rows.last().locator(".drag-handle").dragTo(rows.first());
  await expect(rows.locator("h2").first()).toHaveText(titles[2]);
  // An unavailable server must keep the preview and allow a manual retry.
  const orderEndpoint = `**/api/folders/${id}/order`;
  await page.route(orderEndpoint, (route) => route.abort("connectionrefused"));
  await page.getByRole("button", { name: "Save reading order" }).click();
  await expect(
    page.getByText(
      "Cannot reach Paperclub. Check that the server is running, then try again.",
    ),
  ).toBeVisible();
  await expect(rows.locator("h2").first()).toHaveText(titles[2]);
  await expect(
    rows.filter({ hasText: titles[1] }).locator(".folder-note"),
  ).toHaveText(note);
  await expect(
    page.getByRole("button", { name: "Save reading order" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Discard changes and reload" }),
  ).toHaveCount(0);
  await page.unroute(orderEndpoint);
  await page.getByRole("button", { name: "Save reading order" }).click();
  await expect(
    page.getByRole("button", { name: "Save reading order" }),
  ).toHaveCount(0);
  await expect(page.getByText(/Cannot reach Paperclub/)).toHaveCount(0);
  await page.reload();
  await expect(rows.locator("h2").first()).toHaveText(titles[2]);
  const noted = rows.filter({ hasText: titles[1] });
  await expect(noted.locator(".folder-note")).toHaveText(note);
  await expect(noted.locator(".folder-abstract")).not.toHaveAttribute("open");
  await noted.getByRole("link", { name: "Read", exact: true }).click();
  await expect(page.locator(".reading-view .paper-card h2")).toHaveText(
    titles[1],
  );
  await expect(
    page.getByRole("complementary", { name: "Folder note" }),
  ).toContainText(note);
  const current = await page.getByLabel("Current paper").inputValue();
  await page.getByRole("link", { name: "Discuss & rate this paper →" }).click();
  await expect(
    page.getByRole("heading", { name: /Discussion/ }).first(),
  ).toBeInViewport();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Paper Folders" }),
  ).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(
    page.getByRole("link", { name: "← Back to reading" }),
  ).toBeInViewport();
  await page.goBack();
  await expect(page.getByLabel("Current paper")).toHaveValue(current);
  await page.goForward();
  await page
    .getByLabel("Add a comment", { exact: true })
    .fill("The measurement assumptions are useful to compare.");
  await page.getByRole("button", { name: "Post comment" }).click();
  await expect(
    page.getByText("The measurement assumptions are useful to compare."),
  ).toBeVisible();
  await page.getByRole("link", { name: "← Back to reading" }).click();
  await expect(page.getByLabel("Current paper")).toHaveValue(current);
  await page
    .getByRole("button", { name: "Mark as completed", exact: true })
    .click();
  await expect(
    page.getByText("1 of 3 papers completed · Your progress is private"),
  ).toBeVisible();
  await page.getByRole("link", { name: "← Measurement reading plan" }).click();
  await expect(noted.locator(".completion-mark")).toHaveText("✓ Read");
  await noted.locator("h2 a").click();
  await page.reload();
  await page.getByRole("link", { name: "← Back to folder" }).click();
  await expect(noted.locator("h2")).toBeInViewport();

  // Scope survives a detail-page visit, including a reload.
  await page.getByRole("link", { name: "Paper Folders", exact: true }).click();
  await page.getByRole("link", { name: "Shared Folders", exact: true }).click();
  await page
    .locator(".folder-card")
    .filter({ hasText: "Measurement reading plan" })
    .click();
  await page.reload();
  await page.getByRole("link", { name: "← Shared Folders" }).click();
  await expect(
    page.getByRole("link", { name: "Shared Folders", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page
    .locator(".folder-card")
    .filter({ hasText: "Measurement reading plan" })
    .click();
  expect((await accessibility(page)).violations).toEqual([]);
  await page.screenshot({
    path: "reports/folder-notes-desktop.png",
    animations: "disabled",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await accessibility(page)).violations).toEqual([]);
  await page.screenshot({
    path: "reports/folder-notes-mobile.png",
    animations: "disabled",
    fullPage: true,
  });
  const response = await page.request.get(`/api/folders/${id}`);
  expect((await response.json()).progress.currentPaperId).toBe(current);
});

test("admin initialization, mandatory password change, user management and invitations", async ({
  page,
  browser,
}) => {
  const db = new Store(browserDatabase);
  let credentials;
  try {
    credentials = (await initializeAdmin(db))!;
  } finally {
    db.close();
  }
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill(credentials.username);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText("Change your initial password to continue."),
  ).toBeVisible();
  expect((await page.request.get("/api/admin/users")).status()).toBe(403);
  await page
    .getByLabel("Current password", { exact: true })
    .fill(credentials.password);
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Update password" }).click();
  await page.getByRole("link", { name: "Admin", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Users", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".admin-users li")).toHaveCount(4);

  await page.getByRole("button", { name: "Edit admin", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Account enabled")).toBeDisabled();
  await dialog.getByLabel("Role", { exact: true }).selectOption("member");
  await dialog.getByRole("button", { name: "Save user" }).click();
  await expect(
    dialog.getByText("Keep at least one active administrator."),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  const memberContext = await browser.newContext();
  const bob = await memberContext.newPage();
  await login(bob, "bob");
  expect((await bob.request.get("/api/admin/users")).status()).toBe(403);
  await expect(
    bob.getByRole("link", { name: "Admin", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Search users").fill("bob");
  await expect(page.locator(".admin-users li")).toHaveCount(1);
  await page.getByRole("button", { name: "Edit bob", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Display name", { exact: true })
    .fill("Bob Researcher");
  await dialog.getByLabel("Account enabled").uncheck();
  await dialog.getByRole("button", { name: "Save user" }).click();
  await expect(page.locator(".admin-users li")).toContainText("Bob Researcher");
  await expect(page.locator(".admin-users li")).toContainText("Disabled");
  await bob.reload();
  await expect(
    bob.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit bob", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Account enabled").check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save user" })
    .click();
  await expect(page.locator(".admin-users li")).toContainText("Active");
  await login(bob, "bob");
  await memberContext.close();

  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Invitation code" });
  const token = await dialog.getByRole("textbox").inputValue();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  const newContext = await browser.newContext();
  const newcomer = await newContext.newPage();
  await newcomer.goto("/");
  await newcomer
    .getByRole("button", { name: "Have an invitation? Create an account" })
    .click();
  await newcomer.getByLabel("Username (public handle)").fill("new-reader");
  await newcomer.getByLabel("Display name", { exact: true }).fill("New Reader");
  await newcomer.getByLabel("Password", { exact: true }).fill(password);
  await newcomer.getByLabel("Invitation code", { exact: true }).fill(token);
  await newcomer
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    newcomer.getByRole("heading", { name: "All Paper" }),
  ).toBeVisible();
  await newContext.close();
  await page.getByLabel("Search users").fill("");
  await expect(page.locator(".admin-users li")).toHaveCount(5);
  expect((await accessibility(page)).violations).toEqual([]);
  await page.screenshot({
    path: "reports/admin-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect((await accessibility(page)).violations).toEqual([]);
  await page.screenshot({
    path: "reports/admin-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});
