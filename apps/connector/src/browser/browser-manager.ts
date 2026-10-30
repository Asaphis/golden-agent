import { randomUUID } from "node:crypto";
import type { Browser, BrowserContext, Page } from "playwright";

export interface BrowserPage {
  url: string;
  status: number;
  title: string;
  text: string;
  links: Array<{ text: string; href: string }>;
}

interface BrowserSession { sessionId: string; context: BrowserContext; page: Page; }

export class BrowserManager {
  private browser?: Browser;
  private readonly sessions = new Map<string, BrowserSession>();

  async open(): Promise<{ sessionId: string }> {
    if (process.platform === "android") throw new Error("Browser automation is unavailable on Android/Termux");
    const { chromium } = await import("playwright");
    this.browser ??= await chromium.launch({ headless: true });
    const context = await this.browser.newContext();
    const page = await context.newPage();
    const sessionId = randomUUID();
    this.sessions.set(sessionId, { sessionId, context, page });
    return { sessionId };
  }

  async navigate(sessionId: string, url: string, timeoutMs = 30_000): Promise<BrowserPage> {
    const session = this.requireSession(sessionId);
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Browser navigation supports only HTTP(S) URLs");
    const response = await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.min(timeoutMs, 120_000) });
    return this.inspect(sessionId, response?.status() ?? 0);
  }

  async inspect(sessionId: string, status = 200): Promise<BrowserPage> {
    const page = this.requireSession(sessionId).page;
    const data = await page.evaluate(() => ({ title: document.title, text: document.body?.innerText ?? "", links: [...document.querySelectorAll("a[href]")].slice(0, 200).map((element) => ({ text: (element.textContent ?? "").trim(), href: (element as HTMLAnchorElement).href })) }));
    return { url: page.url(), status, title: data.title, text: data.text.slice(0, 1_000_000), links: data.links };
  }

  async screenshot(sessionId: string): Promise<Record<string, unknown>> {
    const buffer = await this.requireSession(sessionId).page.screenshot({ type: "png" });
    return { sessionId, mimeType: "image/png", base64: buffer.toString("base64") };
  }

  async click(sessionId: string, selector: string): Promise<Record<string, unknown>> {
    const page = this.requireSession(sessionId).page;
    await page.locator(selector).click({ timeout: 30_000 });
    return { sessionId, url: page.url(), clicked: selector };
  }

  async type(sessionId: string, selector: string, text: string): Promise<Record<string, unknown>> {
    const page = this.requireSession(sessionId).page;
    if (text.length > 100_000) throw new Error("Browser input exceeds the connector limit");
    await page.locator(selector).fill(text, { timeout: 30_000 });
    return { sessionId, selector, characters: text.length };
  }

  async close(sessionId: string): Promise<{ closed: boolean }> {
    const session = this.sessions.get(sessionId);
    if (!session) return { closed: false };
    await session.context.close();
    this.sessions.delete(sessionId);
    if (!this.sessions.size && this.browser) { await this.browser.close(); this.browser = undefined; }
    return { closed: true };
  }

  async closeAll(): Promise<void> {
    for (const session of this.sessions.values()) await session.context.close();
    this.sessions.clear();
    if (this.browser) await this.browser.close();
    this.browser = undefined;
  }

  private requireSession(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Browser session not found");
    return session;
  }
}
