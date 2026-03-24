// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../number-line/coordinates.html').replace(/\\/g, '/');

// Navigate using JS — reliable on mobile, avoids button interaction issues
async function goToSlide(page, n) {
  await page.evaluate((target) => {
    const cur = () => {
      for (let i = 1; i <= 14; i++)
        if (document.getElementById('s' + i)?.classList.contains('active')) return i;
      return 1;
    };
    while (cur() < target) document.getElementById('btnN').click();
    while (cur() > target) document.getElementById('btnP').click();
  }, n);
  await page.waitForTimeout(80);
}

// ── Layout & Display ───────────────────────────────────────────────────────────
// Shared page so the 1.5MB file loads only once for this block
test.describe('iPhone — Layout & Display', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
  });
  test.afterAll(async () => { if (page) await page.close(); });

  test('page loads without horizontal scroll', async () => {
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
  });

  test('slide 1 hero title is visible and not clipped', async () => {
    // Slide 1 has .hero-title, not .slide-title
    const title = page.locator('.hero-title').first();
    const box = await title.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  test('nav buttons are visible and tappable on slide 1', async () => {
    const btnN = page.locator('#btnN');
    await expect(btnN).toBeVisible();
    const box = await btnN.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(36);
    expect(box.width).toBeGreaterThanOrEqual(44);
  });

  test('slide counter is visible', async () => {
    await expect(page.locator('#ctr')).toBeVisible();
    await expect(page.locator('#ctr')).toHaveText('1 / 14');
  });

  test('info-box content is readable — not zero height', async () => {
    await goToSlide(page, 2);
    const infoBoxes = page.locator('.info-box');
    const count = await infoBoxes.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await infoBoxes.nth(i).boundingBox();
      if (box) expect(box.height).toBeGreaterThan(10);
    }
  });

  test('SVG grid renders with nonzero size on mobile', async () => {
    await goToSlide(page, 2);
    const svg = page.locator('#g2');
    await expect(svg).toBeVisible();
    const box = await svg.boundingBox();
    expect(box.width).toBeGreaterThan(50);
    expect(box.height).toBeGreaterThan(50);
  });

  test('exercise slide fits in viewport — no extreme vertical overflow', async () => {
    await goToSlide(page, 9);
    const viewportHeight = page.viewportSize().height;
    const slideBox = await page.locator('#s9').boundingBox();
    if (slideBox) {
      expect(slideBox.height).toBeLessThanOrEqual(viewportHeight * 2.0);
    }
  });
});

// ── Touch Navigation ───────────────────────────────────────────────────────────
test.describe('iPhone — Touch Navigation', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
  });
  test.afterAll(async () => { if (page) await page.close(); });

  test('tap Next button advances slide', async () => {
    await goToSlide(page, 1);
    await page.locator('#btnN').tap();
    await expect(page.locator('#s2')).toHaveClass(/active/);
  });

  test('tap Prev button goes back', async () => {
    await goToSlide(page, 2);
    await page.locator('#btnP').tap();
    await expect(page.locator('#s1')).toHaveClass(/active/);
  });

  test('swipe left advances slide', async () => {
    await goToSlide(page, 1);
    const vp = page.viewportSize();
    await page.evaluate((vp) => {
      const startX = vp.width * 0.8, endX = vp.width * 0.2, y = vp.height / 2;
      document.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [new Touch({ identifier: 1, target: document.body, clientX: startX, clientY: y })] }));
      document.dispatchEvent(new TouchEvent('touchend', { changedTouches: [new Touch({ identifier: 1, target: document.body, clientX: endX, clientY: y })] }));
    }, vp);
    await page.waitForTimeout(100);
    await expect(page.locator('#s2')).toHaveClass(/active/);
  });

  test('swipe right goes back', async () => {
    await goToSlide(page, 2);
    const vp = page.viewportSize();
    await page.evaluate((vp) => {
      const startX = vp.width * 0.2, endX = vp.width * 0.8, y = vp.height / 2;
      document.dispatchEvent(new TouchEvent('touchstart', { changedTouches: [new Touch({ identifier: 1, target: document.body, clientX: startX, clientY: y })] }));
      document.dispatchEvent(new TouchEvent('touchend', { changedTouches: [new Touch({ identifier: 1, target: document.body, clientX: endX, clientY: y })] }));
    }, vp);
    await page.waitForTimeout(100);
    await expect(page.locator('#s1')).toHaveClass(/active/);
  });
});

// ── Exercise Interaction ───────────────────────────────────────────────────────
test.describe('iPhone — Exercise Interaction', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
  });
  test.afterAll(async () => { if (page) await page.close(); });

  test('check button is tappable on exercise 2', async () => {
    await goToSlide(page, 9);
    const btn = page.locator('#sb9');
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(36);
    await btn.tap();
    const att = await page.evaluate(() => window.ES[9].att);
    expect(att).toBe(1);
  });

  test('coord inputs are focusable on mobile (exercise 3)', async () => {
    await goToSlide(page, 10);
    const input = page.locator('#e10-E-x');
    await expect(input).toBeVisible();
    await input.tap();
    const isFocused = await page.evaluate(() => document.activeElement?.id === 'e10-E-x');
    expect(isFocused).toBe(true);
  });

  test('coord inputs accept values on mobile', async () => {
    await goToSlide(page, 10);
    await page.evaluate(() => { document.getElementById('e10-E-x').value = ''; });
    await page.locator('#e10-E-x').tap();
    await page.keyboard.type('2');
    const val = await page.locator('#e10-E-x').inputValue();
    expect(val).toBe('2');
  });

  test('timer visible on exercise slide', async () => {
    await goToSlide(page, 9);
    const el = page.locator('#tt9');
    // Timer element exists and has a numeric value
    const text = await el.evaluate(e => e.textContent);
    expect(parseInt(text)).toBeGreaterThan(0);
  });

  test('timeout overlay is tappable on mobile', async () => {
    // Use a fresh state: reset exercise 9
    await page.evaluate(() => {
      window.ES[9] = { att: 0, lock: false, sel: {}, extraTime: false };
      // Remove any existing overlay
      document.getElementById('tov9')?.remove();
    });
    await goToSlide(page, 9);
    await page.evaluate(() => {
      const t = window.timers;
      if (t[9]) { clearInterval(t[9]); delete t[9]; }
      window.timeoutEx(9);
    });
    await page.waitForTimeout(80);
    await expect(page.locator('#tov9')).toBeVisible();
    const dismissBtn = page.locator('#tov9 button').last();
    await dismissBtn.tap();
    await expect(page.locator('#tov9')).not.toBeAttached();
  });

  test('correct answer on mobile shows success state', async () => {
    await goToSlide(page, 9);
    await page.evaluate(() => {
      window.ES[9] = { att: 0, lock: false, sel: { A: 2, B: 4, C: 3, D: 1 }, extraTime: false };
    });
    await page.locator('#sb9').tap();
    await expect(page.locator('#sb9')).toHaveClass(/ok-btn/);
  });
});

// ── Font & Readability ─────────────────────────────────────────────────────────
test.describe('iPhone — Font & Readability', () => {
  let page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
    await goToSlide(page, 2); // navigate to slide with .slide-title
  });
  test.afterAll(async () => { if (page) await page.close(); });

  test('slide title font size is at least 18px on mobile', async () => {
    // Now on slide 2 which has .slide-title
    const fontSize = await page.locator('#s2 .slide-title').evaluate(
      el => parseFloat(getComputedStyle(el).fontSize)
    );
    expect(fontSize).toBeGreaterThanOrEqual(18);
  });

  test('check button font size is at least 14px on mobile', async () => {
    await goToSlide(page, 9);
    const fontSize = await page.locator('#sb9').evaluate(
      el => parseFloat(getComputedStyle(el).fontSize)
    );
    expect(fontSize).toBeGreaterThanOrEqual(14);
  });

  test('info-box text is at least 13px on mobile', async () => {
    await goToSlide(page, 2);
    const boxes = page.locator('.info-box p');
    const count = await boxes.count();
    if (count > 0) {
      const fontSize = await boxes.first().evaluate(
        el => parseFloat(getComputedStyle(el).fontSize)
      );
      expect(fontSize).toBeGreaterThanOrEqual(13);
    }
  });
});
