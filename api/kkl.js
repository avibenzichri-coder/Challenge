// Vercel Function: KKL wildflower proxy
// Modes:
//   ?name=<hebrew>        — search by Hebrew name
//   ?sciname=<latin>      — search by scientific name → returns hebrewName + structured data
//   &debug=1              — returns raw search HTML for parser inspection

const KKL_REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; FlowerID/1.0)',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'he-IL,he;q=0.9',
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const { name, sciname, debug } = req.query || {};
  const isDebug = debug === '1';

  if (!name && !sciname) {
    return res.status(400).json({ error: 'missing name or sciname param' });
  }

  const searchTerm = name || sciname;

  try {
    // Step 1: Search KKL
    const searchUrl  = `https://www.kkl.org.il/wild-flower/plants/?Name=${encodeURIComponent(searchTerm)}`;
    const searchResp = await fetch(searchUrl, { headers: KKL_REQUEST_HEADERS });

    if (!searchResp.ok) {
      return res.status(502).json({ error: `KKL search returned ${searchResp.status}` });
    }

    const searchHtml = await searchResp.text();

    if (isDebug) {
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send(searchHtml);
    }

    // Step 2: Extract plant ID from search results
    const idMatch = searchHtml.match(/\/wild-flower\/plants\/(\d+)(?:\.aspx)?["'/]/i);
    if (!idMatch) {
      return res.status(404).json({ error: 'Plant not found in KKL search results', searchTerm });
    }

    const plantId  = idMatch[1];
    const plantUrl = `https://www.kkl.org.il/wild-flower/plants/${plantId}.aspx`;

    // Step 3: Fetch plant detail page
    const plantResp = await fetch(plantUrl, { headers: KKL_REQUEST_HEADERS });

    if (!plantResp.ok) {
      return res.status(502).json({ error: `KKL plant page returned ${plantResp.status}`, plantId });
    }

    const plantHtml = await plantResp.text();

    // Step 4: Parse structured fields
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

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
