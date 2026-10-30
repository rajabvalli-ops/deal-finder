// Renders the SVG icons to the PNG sizes browsers and phones ask for:
//   node assets/icons/render.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, "../../public");
const jobs = [
  ["icon.svg", "icon-192.png", 192],
  ["icon.svg", "icon-512.png", 512],
  ["icon.svg", "apple-touch-icon.png", 180],
  ["badge.svg", "badge-96.png", 96],
];

(async () => {
  const browser = await chromium.launch();
  for (const [source, target, size] of jobs) {
    const svg = fs.readFileSync(path.join(__dirname, source), "utf8");
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await page.screenshot({ path: path.join(out, target), omitBackground: true });
    await page.close();
  }
  await browser.close();
})();
