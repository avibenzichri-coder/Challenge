// Netlify Function: KKL wildflower proxy
// Modes:
//   ?name=<hebrew>        — search by Hebrew name (original mode)
//   ?sciname=<latin>      — search by scientific name → returns hebrewName + structured data
//   &debug=1              — returns raw search HTML for parser inspection

const KKL_REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; FlowerID/1.0)',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'he-IL,he;q=0.9',
};

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  const params   = event.queryStringParameters || {};
  const debug    = params.debug === '1';
  const name     = params.name;
  const sciname  = params.sciname;

  if (!name && !sciname) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'missing name or sciname param' }) };
  }

  // The search term sent to KKL — Hebrew name takes priority, sciname is a fallback attempt
  const searchTerm = name || sciname;

  try {
    // ── Step 1: Search KKL ─────────────────────────────────────────────────
    const searchUrl = `https://www.kkl.org.il/wild-flower/plants/?Name=${encodeURIComponent(searchTerm)}`;
    const searchResp = await fetch(searchUrl, { headers: KKL_REQUEST_HEADERS });

    if (!searchResp.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: `KKL search returned ${searchResp.status}` }) };
    }

    const searchHtml = await searchResp.text();

    if (debug) {
      return {
        statusCode: 200,
        headers: { ...headers, 'Content-Type': 'text/html' },
        body: searchHtml,
      };
    }

    // ── Step 2: Extract plant ID from search results ────────────────────────
    const idMatch = searchHtml.match(/\/wild-flower\/plants\/(\d+)(?:\.aspx)?["'/]/i);
    if (!idMatch) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Plant not found in KKL search results', searchTerm }) };
    }

    const plantId  = idMatch[1];
    const plantUrl = `https://www.kkl.org.il/wild-flower/plants/${plantId}.aspx`;

    // ── Step 3: Fetch plant detail page ────────────────────────────────────
    const plantResp = await fetch(plantUrl, { headers: KKL_REQUEST_HEADERS });

    if (!plantResp.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: `KKL plant page returned ${plantResp.status}`, plantId }) };
    }

    const plantHtml = await plantResp.text();

    // ── Step 4: Parse structured fields ────────────────────────────────────

    function extractDtDd(html, label) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(`${escaped}[^<]*</dt>\\s*<dd[^>]*>\\s*([\\s\\S]*?)\\s*</dd>`, 'i');
      const m = html.match(rx);
      return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
    }

    function extractTableRow(html, label) {
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
      kklUrl:          plantUrl,
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
    };

    // Only include raw snippet in debug mode
    if (debug) data._rawSnippet = plantHtml.slice(0, 2000);

    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
