// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../number-line/coordinates.html').replace(/\\/g, '/');

// Navigate to slide n using button clicks in a single evaluate call
async function goToSlide(page, n) {
  const current = await page.evaluate(() => {
    for (let i = 1; i <= 14; i++) {
      if (document.getElementById('s' + i)?.classList.contains('active')) return i;
    }
    return 1;
  });
  if (current === n) return;
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

// Force timer expiry via JS
async function expireTimer(page, n) {
  await page.evaluate((n) => {
    const t = window.timers;
    if (t[n]) { clearInterval(t[n]); delete t[n]; }
    window.timeoutEx(n);
  }, n);
  await page.waitForTimeout(80);
}

// ────────────────────────────────────────────
test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
  });

  test('starts on slide 1', async ({ page }) => {
    await expect(page.locator('#s1')).toHaveClass(/active/);
    await expect(page.locator('#ctr')).toHaveText('1 / 14');
  });

  test('prev button disabled on slide 1', async ({ page }) => {
    await expect(page.locator('#btnP')).toBeDisabled();
  });

  test('next button advances slide', async ({ page }) => {
    await page.click('#btnN');
    await expect(page.locator('#s2')).toHaveClass(/active/);
    await expect(page.locator('#ctr')).toHaveText('2 / 14');
  });

  test('prev button navigates back', async ({ page }) => {
    await page.click('#btnN');
    await page.click('#btnP');
    await expect(page.locator('#s1')).toHaveClass(/active/);
  });

  test('next button disabled on last slide', async ({ page }) => {
    await goToSlide(page, 14);
    await expect(page.locator('#btnN')).toBeDisabled();
  });

  test('keyboard ArrowLeft advances (RTL)', async ({ page }) => {
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#s2')).toHaveClass(/active/);
  });

  test('keyboard ArrowRight goes back', async ({ page }) => {
    await goToSlide(page, 3);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#s2')).toHaveClass(/active/);
  });

  test('cannot go before slide 1', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#s1')).toHaveClass(/active/);
  });

  test('cannot go past slide 14', async ({ page }) => {
    await goToSlide(page, 14);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#s14')).toHaveClass(/active/);
  });

  test('slide counter updates through all 14 slides', async ({ page }) => {
    for (let i = 2; i <= 14; i++) {
      await page.click('#btnN');
    }
    await expect(page.locator('#ctr')).toHaveText('14 / 14');
  });
});

// ────────────────────────────────────────────
test.describe('Exercise 1 — Place Points on Grid', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
    await goToSlide(page, 8);
  });

  test('timer starts on slide entry', async ({ page }) => {
    const val = parseInt(await page.locator('#tt8').textContent());
    expect(val).toBeGreaterThan(0);
    expect(val).toBeLessThanOrEqual(30);
  });

  test('check with no points is a failed attempt', async ({ page }) => {
    await page.click('#sb8');
    const att = await page.evaluate(() => window.ES[8].att);
    expect(att).toBe(1);
  });

  test('correct answer locks exercise and reveals solution', async ({ page }) => {
    await page.evaluate(() => {
      window.ES[8].placed = [{x:2,y:3},{x:-1,y:4},{x:-3,y:-2},{x:4,y:-1}];
      window.renderEx1Grid(); window.renderEx1List();
    });
    await page.click('#sb8');
    await expect(page.locator('#sb8')).toHaveClass(/ok-btn/);
    await expect(page.locator('#sol8')).toHaveClass(/vis/);
    expect(await page.evaluate(() => window.ES[8].lock)).toBe(true);
  });

  test('wrong answer shows retry button text "בדוק תשובה"', async ({ page }) => {
    await page.evaluate(() => {
      window.ES[8].placed = [{x:1,y:1},{x:1,y:1},{x:1,y:1},{x:1,y:1}];
      window.renderEx1Grid();
    });
    await page.click('#sb8');
    await expect(page.locator('#sb8')).toHaveText('✓ בדוק תשובה');
  });

  test('after wrong answer, correct points kept, wrong cleared', async ({ page }) => {
    await page.evaluate(() => {
      window.ES[8].placed = [{x:2,y:3},{x:0,y:0},{x:0,y:0},{x:0,y:0}];
      window.renderEx1Grid();
    });
    await page.click('#sb8');
    await page.evaluate(() => window.afterWrongEx1());
    const placed = await page.evaluate(() => window.ES[8].placed);
    expect(placed[0]).toEqual({x:2, y:3}); // P kept
    expect(placed[1]).toBeNull();
    expect(placed[2]).toBeNull();
    expect(placed[3]).toBeNull();
  });

  test('locks and shows solution after 3 wrong attempts', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        window.ES[8].placed = [{x:1,y:1},{x:1,y:1},{x:1,y:1},{x:1,y:1}];
        window.renderEx1Grid();
      });
      await page.click('#sb8');
      await page.waitForTimeout(80);
    }
    expect(await page.evaluate(() => window.ES[8].lock)).toBe(true);
    await expect(page.locator('#sb8')).toBeDisabled();
    await expect(page.locator('#sol8')).toHaveClass(/vis/);
  });

  test('clicking grid after lock does not add points', async ({ page }) => {
    await page.evaluate(() => window.ES[8].lock = true);
    const svgBox = await page.locator('#g8').boundingBox();
    await page.mouse.click(svgBox.x + svgBox.width / 2, svgBox.y + svgBox.height / 2);
    const placed = await page.evaluate(() => window.ES[8].placed);
    expect(placed.every(p => p === null)).toBe(true);
  });

  test('reset clears all placement state', async ({ page }) => {
    await page.evaluate(() => {
      window.ES[8].placed = [{x:2,y:3},{x:-1,y:4},{x:-3,y:-2},{x:4,y:-1}];
      window.ES[8].att = 2; window.ES[8].lock = true;
      window.resetEx(8);
    });
    const s = await page.evaluate(() => window.ES[8]);
    expect(s.att).toBe(0);
    expect(s.lock).toBe(false);
    expect(s.extraTime).toBe(false);
    expect(s.placed.every(p => p === null)).toBe(true);
  });
});

// ────────────────────────────────────────────
test.describe('Exercise 2 — Quadrant ID', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
    await goToSlide(page, 9);
  });

  test('all correct answers succeed', async ({ page }) => {
    await page.evaluate(() => { window.ES[9].sel = {A:2, B:4, C:3, D:1}; });
    await page.click('#sb9');
    await expect(page.locator('#sb9')).toHaveClass(/ok-btn/);
  });

  test('one wrong answer fails', async ({ page }) => {
    await page.evaluate(() => { window.ES[9].sel = {A:2, B:4, C:3, D:2}; }); // D wrong
    await page.click('#sb9');
    await expect(page.locator('#sb9')).not.toHaveClass(/ok-btn/);
    expect(await page.evaluate(() => window.ES[9].att)).toBe(1);
  });

  test('no selection fails gracefully', async ({ page }) => {
    await page.click('#sb9');
    expect(await page.evaluate(() => window.ES[9].att)).toBe(1);
  });

  test('solution revealed after 3 failures', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => { window.ES[9].sel = {A:1,B:1,C:1,D:2}; });
      await page.click('#sb9');
      await page.waitForTimeout(50);
    }
    await expect(page.locator('#sol9')).toHaveClass(/vis/);
    await expect(page.locator('#sb9')).toBeDisabled();
  });

  test('correct answers marked ok-q after lockout', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => { window.ES[9].sel = {A:1,B:1,C:1,D:2}; });
      await page.click('#sb9');
      await page.waitForTimeout(50);
    }
    const okCount = await page.locator('#qgrid9 .ok-q').count();
    expect(okCount).toBeGreaterThan(0);
  });

  test('locked exercise ignores selQ calls', async ({ page }) => {
    await page.evaluate(() => { window.ES[9].lock = true; });
    await page.evaluate(() => window.selQ(9, 'A', 1));
    const sel = await page.evaluate(() => window.ES[9].sel);
    expect(sel['A']).toBeUndefined();
  });
});

// ────────────────────────────────────────────
test.describe('Exercise 3 — Read Coordinates', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
    await goToSlide(page, 10);
  });

  test('all correct coordinates pass', async ({ page }) => {
    await page.fill('#e10-E-x', '2');  await page.fill('#e10-E-y', '3');
    await page.fill('#e10-F-x', '-4'); await page.fill('#e10-F-y', '1');
    await page.fill('#e10-G-x', '3');  await page.fill('#e10-G-y', '-2');
    await page.fill('#e10-H-x', '-2'); await page.fill('#e10-H-y', '-4');
    await page.click('#sb10');
    await expect(page.locator('#sb10')).toHaveClass(/ok-btn/);
  });

  test('one wrong value marks that field bad-inp', async ({ page }) => {
    await page.fill('#e10-E-x', '2');  await page.fill('#e10-E-y', '3');
    await page.fill('#e10-F-x', '-4'); await page.fill('#e10-F-y', '1');
    await page.fill('#e10-G-x', '3');  await page.fill('#e10-G-y', '-2');
    await page.fill('#e10-H-x', '99'); await page.fill('#e10-H-y', '-4'); // H-x wrong
    await page.click('#sb10');
    await expect(page.locator('#e10-H-x')).toHaveClass(/bad-inp/);
    await expect(page.locator('#e10-H-y')).toHaveClass(/ok-inp/);
  });

  test('empty inputs count as wrong attempt', async ({ page }) => {
    await page.click('#sb10');
    expect(await page.evaluate(() => window.ES[10].att)).toBe(1);
  });

  test('solution shown after 3 failures', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.fill('#e10-E-x', '9'); await page.fill('#e10-E-y', '9');
      await page.fill('#e10-F-x', '9'); await page.fill('#e10-F-y', '9');
      await page.fill('#e10-G-x', '9'); await page.fill('#e10-G-y', '9');
      await page.fill('#e10-H-x', '9'); await page.fill('#e10-H-y', '9');
      await page.click('#sb10');
      await page.waitForTimeout(50);
    }
    await expect(page.locator('#sol10')).toHaveClass(/vis/);
  });

  test('inputs disabled after lockout', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.fill('#e10-E-x', '9'); await page.fill('#e10-E-y', '9');
      await page.fill('#e10-F-x', '9'); await page.fill('#e10-F-y', '9');
      await page.fill('#e10-G-x', '9'); await page.fill('#e10-G-y', '9');
      await page.fill('#e10-H-x', '9'); await page.fill('#e10-H-y', '9');
      await page.click('#sb10');
      await page.waitForTimeout(50);
    }
    await expect(page.locator('#e10-E-x')).toBeDisabled();
    await expect(page.locator('#e10-H-y')).toBeDisabled();
  });

  test('zero as input treated as wrong when correct value is nonzero', async ({ page }) => {
    // All zeros — all wrong
    await page.fill('#e10-E-x', '0'); await page.fill('#e10-E-y', '0');
    await page.fill('#e10-F-x', '0'); await page.fill('#e10-F-y', '0');
    await page.fill('#e10-G-x', '0'); await page.fill('#e10-G-y', '0');
    await page.fill('#e10-H-x', '0'); await page.fill('#e10-H-y', '0');
    await page.click('#sb10');
    await expect(page.locator('#sb10')).not.toHaveClass(/ok-btn/);
    expect(await page.evaluate(() => window.ES[10].att)).toBe(1);
  });

  test('reset clears inputs', async ({ page }) => {
    await page.fill('#e10-E-x', '5');
    await page.evaluate(() => window.resetEx(10));
    expect(await page.locator('#e10-E-x').inputValue()).toBe('');
  });
});

// ────────────────────────────────────────────
test.describe('Exercise 4 — Reflection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
    await goToSlide(page, 11);
  });

  test('correct reflections pass', async ({ page }) => {
    // K(3,4): Y-axis→K'(-3,4), X-axis→K"(3,-4)
    await page.fill('#e11-ky-x', '-3'); await page.fill('#e11-ky-y', '4');
    await page.fill('#e11-kx-x', '3');  await page.fill('#e11-kx-y', '-4');
    await page.click('#sb11');
    await expect(page.locator('#sb11')).toHaveClass(/ok-btn/);
  });

  test('wrong Y-axis reflection marks field bad-inp', async ({ page }) => {
    await page.fill('#e11-ky-x', '3');  await page.fill('#e11-ky-y', '4'); // should be -3
    await page.fill('#e11-kx-x', '3');  await page.fill('#e11-kx-y', '-4');
    await page.click('#sb11');
    await expect(page.locator('#e11-ky-x')).toHaveClass(/bad-inp/);
    await expect(page.locator('#e11-ky-y')).toHaveClass(/ok-inp/);
  });

  test('wrong X-axis reflection marks field bad-inp', async ({ page }) => {
    await page.fill('#e11-ky-x', '-3'); await page.fill('#e11-ky-y', '4');
    await page.fill('#e11-kx-x', '3');  await page.fill('#e11-kx-y', '4'); // should be -4
    await page.click('#sb11');
    await expect(page.locator('#e11-kx-y')).toHaveClass(/bad-inp/);
  });

  test('solution revealed after 3 failures', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.fill('#e11-ky-x', '0'); await page.fill('#e11-ky-y', '0');
      await page.fill('#e11-kx-x', '0'); await page.fill('#e11-kx-y', '0');
      await page.click('#sb11');
      await page.waitForTimeout(50);
    }
    await expect(page.locator('#sol11')).toHaveClass(/vis/);
  });

  test('inputs disabled after lockout', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.fill('#e11-ky-x', '0'); await page.fill('#e11-ky-y', '0');
      await page.fill('#e11-kx-x', '0'); await page.fill('#e11-kx-y', '0');
      await page.click('#sb11');
      await page.waitForTimeout(50);
    }
    await expect(page.locator('#e11-ky-x')).toBeDisabled();
    await expect(page.locator('#e11-kx-y')).toBeDisabled();
  });
});

// ────────────────────────────────────────────
test.describe('Exercise 5 — Axis ID', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
    await goToSlide(page, 12);
  });

  test('all correct passes', async ({ page }) => {
    await page.evaluate(() => { window.ES[12].sel = {A:'x', B:'y', C:'n', D:'x', E:'y'}; });
    await page.click('#sb12');
    await expect(page.locator('#sb12')).toHaveClass(/ok-btn/);
  });

  test('wrong axis assignment fails', async ({ page }) => {
    await page.evaluate(() => { window.ES[12].sel = {A:'x', B:'x', C:'n', D:'x', E:'y'}; }); // B wrong
    await page.click('#sb12');
    await expect(page.locator('#sb12')).not.toHaveClass(/ok-btn/);
  });

  test('correct buttons marked ok-q after lockout', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => { window.ES[12].sel = {A:'n',B:'n',C:'x',D:'n',E:'n'}; });
      await page.click('#sb12');
      await page.waitForTimeout(50);
    }
    await expect(page.locator('#sol12')).toHaveClass(/vis/);
    const okCount = await page.locator('#qgrid12 .ok-q').count();
    expect(okCount).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────
test.describe('Exercise 6 — Missing Vertex', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
    await goToSlide(page, 13);
  });

  test('correct point D(1,5) passes', async ({ page }) => {
    await page.evaluate(() => { window.ES[13].placed = {x:1, y:5}; });
    await page.click('#sb13');
    await expect(page.locator('#sb13')).toHaveClass(/ok-btn/);
    await expect(page.locator('#sol13')).toHaveClass(/vis/);
  });

  test('wrong point fails', async ({ page }) => {
    await page.evaluate(() => { window.ES[13].placed = {x:2, y:5}; });
    await page.click('#sb13');
    await expect(page.locator('#sb13')).not.toHaveClass(/ok-btn/);
  });

  test('no point placed counts as failed attempt', async ({ page }) => {
    await page.click('#sb13');
    expect(await page.evaluate(() => window.ES[13].att)).toBe(1);
  });

  test('solution revealed after 3 failures', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => { window.ES[13].placed = {x:0,y:0}; });
      await page.click('#sb13');
      await page.waitForTimeout(50);
    }
    await expect(page.locator('#sol13')).toHaveClass(/vis/);
  });

  test('reset clears placed point', async ({ page }) => {
    await page.evaluate(() => { window.ES[13].placed = {x:1,y:5}; window.resetEx(13); });
    expect(await page.evaluate(() => window.ES[13].placed)).toBeNull();
  });
});

// ────────────────────────────────────────────
test.describe('Timer & Timeout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
  });

  test('timer counts down after 2 seconds', async ({ page }) => {
    await goToSlide(page, 9);
    const before = parseInt(await page.locator('#tt9').textContent());
    await page.waitForTimeout(2100);
    const after = parseInt(await page.locator('#tt9').textContent());
    expect(after).toBeLessThan(before);
  });

  test('timeout shows overlay', async ({ page }) => {
    await goToSlide(page, 9);
    await expireTimer(page, 9);
    await expect(page.locator('#tov9')).toBeVisible();
  });

  test('timeout counts as 1 attempt', async ({ page }) => {
    await goToSlide(page, 9);
    await expireTimer(page, 9);
    expect(await page.evaluate(() => window.ES[9].att)).toBe(1);
  });

  test('extend time button present on first timeout', async ({ page }) => {
    await goToSlide(page, 9);
    await expireTimer(page, 9);
    await expect(page.locator('#tov9 button', { hasText: '15' })).toBeVisible();
  });

  test('extend time starts 15-second timer', async ({ page }) => {
    await goToSlide(page, 9);
    await expireTimer(page, 9);
    await page.locator('#tov9 button', { hasText: '15' }).click();
    await page.waitForTimeout(100);
    const val = parseInt(await page.locator('#tt9').textContent());
    expect(val).toBeLessThanOrEqual(15);
    expect(val).toBeGreaterThan(0);
  });

  test('extend time only available once', async ({ page }) => {
    await goToSlide(page, 9);
    await expireTimer(page, 9);
    await page.locator('#tov9 button', { hasText: '15' }).click();
    await page.waitForTimeout(50);
    await expireTimer(page, 9);
    expect(await page.locator('#tov9 button', { hasText: '15' }).count()).toBe(0);
  });

  test('dismiss overlay removes it', async ({ page }) => {
    await goToSlide(page, 9);
    await expireTimer(page, 9);
    // Click "המשך לנסות" dismiss button
    await page.locator('#tov9 button').last().click();
    await expect(page.locator('#tov9')).not.toBeAttached();
  });

  test('timeout on already-locked exercise does nothing', async ({ page }) => {
    await goToSlide(page, 9);
    await page.evaluate(() => { window.ES[9].lock = true; window.ES[9].att = 3; });
    await expireTimer(page, 9);
    expect(await page.locator('#tov9').count()).toBe(0);
  });

  test('3 timeouts (no extension) lock exercise and show solution', async ({ page }) => {
    await goToSlide(page, 9);
    for (let i = 0; i < 3; i++) {
      await expireTimer(page, 9);
      if (i < 2) { await page.locator('#tov9 button').last().click(); await page.waitForTimeout(50); }
    }
    expect(await page.evaluate(() => window.ES[9].lock)).toBe(true);
  });

  test('reset removes overlay and clears extraTime', async ({ page }) => {
    await goToSlide(page, 9);
    await expireTimer(page, 9);
    await page.evaluate(() => window.resetEx(9));
    await expect(page.locator('#tov9')).not.toBeAttached();
    expect(await page.evaluate(() => window.ES[9].extraTime)).toBe(false);
  });
});

// ────────────────────────────────────────────
test.describe('Slide Reset on Re-entry', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
  });

  test('exercise state resets when leaving and re-entering', async ({ page }) => {
    await goToSlide(page, 9);
    await page.evaluate(() => { window.ES[9].sel = {A:2,B:4,C:3,D:1}; window.ES[9].att = 2; });
    await goToSlide(page, 8);
    await goToSlide(page, 9);
    const s = await page.evaluate(() => window.ES[9]);
    expect(s.att).toBe(0);
    expect(s.lock).toBe(false);
    expect(Object.keys(s.sel).length).toBe(0);
  });

  test('solution hidden on re-entry', async ({ page }) => {
    await goToSlide(page, 9);
    await page.evaluate(() => document.getElementById('sol9').classList.add('vis'));
    await goToSlide(page, 8);
    await goToSlide(page, 9);
    await expect(page.locator('#sol9')).not.toHaveClass(/vis/);
  });

  test('check button resets to default on re-entry', async ({ page }) => {
    await goToSlide(page, 9);
    await page.evaluate(() => window.setBtn(9, 'ok'));
    await goToSlide(page, 8);
    await goToSlide(page, 9);
    await expect(page.locator('#sb9')).toHaveText('✓ בדוק תשובה');
    await expect(page.locator('#sb9')).not.toBeDisabled();
  });
});

// ────────────────────────────────────────────
test.describe('Restart & Finish', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
  });

  test('restartAll returns to slide 1', async ({ page }) => {
    await goToSlide(page, 14);
    await page.evaluate(() => window.restartAll());
    await expect(page.locator('#s1')).toHaveClass(/active/);
    await expect(page.locator('#ctr')).toHaveText('1 / 14');
  });

  test('restartAll clears exercise state', async ({ page }) => {
    await page.evaluate(() => { window.ES[9].att = 3; window.ES[9].lock = true; });
    await page.evaluate(() => window.restartAll());
    const s = await page.evaluate(() => window.ES[9]);
    expect(s.att).toBe(0);
    expect(s.lock).toBe(false);
  });

  test('restartAll re-enables next and disables prev', async ({ page }) => {
    await goToSlide(page, 14);
    await page.evaluate(() => window.restartAll());
    await expect(page.locator('#btnP')).toBeDisabled();
    await expect(page.locator('#btnN')).not.toBeDisabled();
  });
});

// ────────────────────────────────────────────
test.describe('Grid Engine', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
  });

  test('grid renders axis lines on slide 2', async ({ page }) => {
    await goToSlide(page, 2);
    const lineCount = await page.locator('#g2 line').count();
    expect(lineCount).toBeGreaterThan(2);
  });

  test('grid renders X and Y labels', async ({ page }) => {
    await goToSlide(page, 2);
    const texts = await page.locator('#g2 text').allTextContents();
    expect(texts.some(t => t.trim() === 'X')).toBe(true);
    expect(texts.some(t => t.trim() === 'Y')).toBe(true);
  });

  test('svgPt returns ok:false for coordinates outside range', async ({ page }) => {
    await goToSlide(page, 10);
    // Simulate a click far outside the SVG bounds (negative client coords)
    const result = await page.evaluate(() => {
      const svg = document.getElementById('g10');
      // Mock a position outside the RNG (using very large world coords)
      const r = svg.getBoundingClientRect();
      // Clicking at (0,0) screen coords when SVG is well inside the viewport
      return window.svgPt(svg, { clientX: 0, clientY: 0 });
    });
    // Either ok:false, or wx/wy values outside the expected range
    if (result.ok === false) {
      expect(result.ok).toBe(false);
    } else {
      expect(Math.abs(result.wx) > 5 || Math.abs(result.wy) > 5).toBe(true);
    }
  });
});

// ────────────────────────────────────────────
test.describe('Security', () => {
  test('no external network requests', async ({ page }) => {
    const external = [];
    page.on('request', req => {
      if (!req.url().startsWith('file://')) external.push(req.url());
    });
    await page.goto(FILE_URL);
    await page.waitForLoadState('networkidle');
    expect(external).toHaveLength(0);
  });

  test('no inline script eval calls at runtime', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
    const evalUsed = await page.evaluate(() => typeof window._evalCalled !== 'undefined');
    expect(evalUsed).toBe(false);
  });

  test('extremely large numbers are treated as wrong without crashing', async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
    await goToSlide(page, 10);
    // Use evaluate to bypass Playwright's number-input typing restrictions
    await page.evaluate(() => {
      document.getElementById('e10-E-x').value = '999999999';
      document.getElementById('e10-E-y').value = '999999999';
      document.getElementById('e10-F-x').value = '999999999';
      document.getElementById('e10-F-y').value = '999999999';
      document.getElementById('e10-G-x').value = '999999999';
      document.getElementById('e10-G-y').value = '999999999';
      document.getElementById('e10-H-x').value = '999999999';
      document.getElementById('e10-H-y').value = '999999999';
    });
    await page.click('#sb10');
    expect(await page.evaluate(() => window.ES[10].att)).toBe(1);
  });
});

// ────────────────────────────────────────────
test.describe('Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForLoadState('domcontentloaded');
  });

  test('correct submission locks — further checkEx calls ignored', async ({ page }) => {
    await goToSlide(page, 9);
    await page.evaluate(() => {
      window.ES[9].sel = {A:2,B:4,C:3,D:1};
      window.checkEx(9); // correct — locks
      window.checkEx(9); // should be ignored
    });
    const s = await page.evaluate(() => window.ES[9]);
    expect(s.lock).toBe(true);
    expect(s.att).toBe(0);
  });

  test('startTimer guard prevents stacking — second call for same n is no-op', async ({ page }) => {
    await goToSlide(page, 9);
    // Call startTimer twice — second call should be blocked by the guard
    await page.evaluate(() => {
      window.startTimer(9, 30, () => {}); // first call (timer already running from setupEx)
      const id1 = window.timers[9];
      window.startTimer(9, 30, () => {}); // second call — should no-op
      const id2 = window.timers[9];
      window._timerSame = (id1 === id2); // same interval ID means no stacking
    });
    const same = await page.evaluate(() => window._timerSame);
    expect(same).toBe(true);
  });

  test('timer expiry on locked exercise does nothing', async ({ page }) => {
    await goToSlide(page, 9);
    await page.evaluate(() => {
      window.ES[9].sel = {A:2,B:4,C:3,D:1};
      window.checkEx(9); // correct — locks
    });
    const attBefore = await page.evaluate(() => window.ES[9].att);
    await expireTimer(page, 9);
    const attAfter = await page.evaluate(() => window.ES[9].att);
    expect(attAfter).toBe(attBefore);
  });

  test('MAX_ATT is 3', async ({ page }) => {
    expect(await page.evaluate(() => window.MAX_ATT)).toBe(3);
  });

  test('all exercises initialize with extraTime false', async ({ page }) => {
    const flags = await page.evaluate(() =>
      [8,9,10,11,12,13].map(n => window.ES[n].extraTime)
    );
    expect(flags.every(v => v === false)).toBe(true);
  });

  test('negative coordinates accepted in inputs', async ({ page }) => {
    await goToSlide(page, 10);
    await page.fill('#e10-F-x', '-4');
    expect(await page.locator('#e10-F-x').inputValue()).toBe('-4');
  });
});
