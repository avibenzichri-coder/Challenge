// Netlify Function: KKL wildflower proxy
// Fetches structured plant data from kkl.org.il by Hebrew name (server-side, no CORS issue)

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  const name = (event.queryStringParameters || {}).name;
  if (!name) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing name param' }) };
  }

  const debug = (event.queryStringParameters || {}).debug === '1';

  try {
    // ── Step 1: Search KKL by Hebrew name ──────────────────────────────────
    const searchUrl = `https://www.kkl.org.il/wild-flower/plants/?Name=${encodeURIComponent(name)}`;
    const searchResp = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FlowerID/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'he-IL,he;q=0.9',
      },
    });

    if (!searchResp.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: `KKL search returned ${searchResp.status}` }) };
    }

    const searchHtml = await searchResp.text();

    if (debug) {
      // Return raw search HTML so we can inspect the structure
      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'text/html' },
        body: searchHtml,
      };
    }

    // ── Step 2: Extract plant ID from search results ────────────────────────
    // Try common link patterns: /wild-flower/plants/330.aspx or /wild-flower/plants/330/
    const idMatch = searchHtml.match(/\/wild-flower\/plants\/(\d+)(?:\.aspx)?["'/]/i);
    if (!idMatch) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Plant not found in KKL search results', name }) };
    }

    const plantId = idMatch[1];
    const plantUrl = `https://www.kkl.org.il/wild-flower/plants/${plantId}.aspx`;

    // ── Step 3: Fetch plant detail page ────────────────────────────────────
    const plantResp = await fetch(plantUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FlowerID/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'he-IL,he;q=0.9',
      },
    });

    if (!plantResp.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: `KKL plant page returned ${plantResp.status}`, plantId }) };
    }

    const plantHtml = await plantResp.text();

    // ── Step 4: Parse structured fields ────────────────────────────────────
    // KKL likely uses <dt>label</dt><dd>value</dd> or a table structure.
    // We try both patterns; raw HTML is available via ?debug=1&name=... if we need to refine.

    function extractDtDd(html, label) {
      // Pattern: <dt>שם הצמח:</dt> ... <dd>value</dd>
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(`${escaped}[^<]*</dt>\\s*<dd[^>]*>\\s*([\\s\\S]*?)\\s*</dd>`, 'i');
      const m = html.match(rx);
      return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
    }

    function extractTableRow(html, label) {
      // Pattern: <td>label</td><td>value</td>
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(`${escaped}[^<]*</td>\\s*<td[^>]*>\\s*([\\s\\S]*?)\\s*</td>`, 'i');
      const m = html.match(rx);
      return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
    }

    function extract(html, label) {
      return extractDtDd(html, label) || extractTableRow(html, label) || null;
    }

    const data = {
      plantId,
      kklUrl: plantUrl,
      hebrewName:      extract(plantHtml, 'שם הצמח'),
      sciName:         extract(plantHtml, 'שם מדעי'),
      englishName:     extract(plantHtml, 'שם עממי'),
      arabicName:      extract(plantHtml, 'שם ערבי'),
      family:          extract(plantHtml, 'משפחה'),
      petalCount:      extract(plantHtml, "מס' עלי כותרת"),
      leafShape:       extract(plantHtml, 'צורת העלה'),
      leafEdge:        extract(plantHtml, 'שפת העלה'),
      habitat:         extract(plantHtml, 'בית גידול'),
      lifeForm:        extract(plantHtml, 'צורת חיים'),
      stemShape:       extract(plantHtml, 'צורת הגבעול'),
      distribution:    extract(plantHtml, 'תפוצה בארץ'),
      floweringSeason: extract(plantHtml, 'עונת הפריחה'),
      // Raw HTML snippet for debugging the parser if needed
      _rawSnippet: plantHtml.slice(0, 2000),
    };

    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
