'use strict';

// ============================================================
// CONFIG
// ============================================================
const PLANTNET_FUNCTION  = '/api/plantnet';
const KKL_FUNCTION       = '/api/kkl';
const CONFIDENCE_THRESHOLD = 0.15;
const CONFIDENCE_LOW       = 0.65;
const WIKIDATA_SPARQL      = 'https://query.wikidata.org/sparql';
const DEBUG_MODE           = new URLSearchParams(window.location.search).get('debug') === '1';

// ============================================================
// STATE
// ============================================================
const STATE = {
  currentFile:    null,
  previewDataURL: null,
};

// Session-level cache keyed by scientific name (or Hebrew name for KKL)
const CACHE = new Map();

// ============================================================
// UTILITIES
// ============================================================

// Fetch with AbortController timeout
async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Escape SPARQL string literals fully
function escapeSparql(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g,  '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

// Client-side image compression — resizes to max 1200px, JPEG 0.82
// Skips compression if image is already small (<= 300KB)
function compressImage(file) {
  return new Promise((resolve) => {
    if (file.size <= 300 * 1024) { resolve(file); return; }

    const img    = new Image();
    const objUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objUrl);
      const MAX = 1200;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width >= height) { height = Math.round(height * MAX / width);  width = MAX; }
        else                  { width  = Math.round(width  * MAX / height); height = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(file); };
    img.src = objUrl;
  });
}


// ============================================================
// SCREEN MANAGEMENT
// ============================================================
const SCREEN_IDS = ['landing', 'preview', 'loading', 'result', 'candidates', 'error'];

function showScreen(name) {
  SCREEN_IDS.forEach(id => {
    const el = document.getElementById('screen-' + id);
    el.classList.toggle('active',  id === name);
    el.classList.toggle('hidden',  id !== name);
  });
  const header = document.getElementById('app-header');
  header.classList.toggle('hidden', name === 'landing' || name === 'loading');
}

// ============================================================
// FILE HANDLING
// ============================================================
function handleFileSelected(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  const file = files[0];
  event.target.value = '';

  if (!file.type.startsWith('image/')) { alert('נא לבחור קובץ תמונה בלבד'); return; }
  if (file.size === 0)                 { alert('הקובץ שנבחר ריק. נא לנסות שוב.'); return; }
  if (file.size > 10 * 1024 * 1024)   { alert('התמונה גדולה מדי (מקסימום 10MB). נא לבחור תמונה קטנה יותר.'); return; }

  STATE.currentFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    STATE.previewDataURL = e.target.result;
    document.getElementById('preview-img').src = STATE.previewDataURL;
    showScreen('preview');
  };
  reader.readAsDataURL(file);
}

// ============================================================
// PLANTNET API (via proxy)
// ============================================================
async function callPlantNetAPI(blob, filename) {
  // Convert blob to base64 for JSON transport
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const payload = {
    image:    base64,
    filename: filename || 'flower.jpg',
  };

  const response = await fetchWithTimeout(
    PLANTNET_FUNCTION,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
    30000  // 30s — image upload can be slow on mobile
  );

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    if (DEBUG_MODE) console.error('PlantNet proxy error', response.status, errBody);
    const err  = new Error('API error');
    // PlantNet 404 = no plant detected in image → treat as not_found, not api_error
    err.type   = response.status === 404 ? 'not_found' : 'api';
    err.status = response.status;
    throw err;
  }

  return response.json();
}

// ============================================================
// WIKIDATA
// ============================================================
async function callWikidata(taxonName) {
  const cacheKey = 'wd:' + taxonName;
  if (CACHE.has(cacheKey)) return CACHE.get(cacheKey);

  try {
    const safe  = escapeSparql(taxonName);
    const sparql = `SELECT ?heLabel ?heWikiTitle WHERE {
      ?item wdt:P225 "${safe}".
      OPTIONAL { ?item rdfs:label ?heLabel. FILTER(LANG(?heLabel)="he") }
      OPTIONAL {
        ?article schema:about ?item;
                 schema:inLanguage "he";
                 schema:isPartOf <https://he.wikipedia.org/>;
                 schema:name ?heWikiTitle.
      }
    } LIMIT 1`;

    const resp = await fetchWithTimeout(
      WIKIDATA_SPARQL + '?query=' + encodeURIComponent(sparql) + '&format=json',
      { headers: { 'Accept': 'application/sparql-results+json' } },
      8000
    );
    if (!resp.ok) { CACHE.set(cacheKey, null); return null; }

    const data = await resp.json();
    const b    = data.results?.bindings?.[0];
    const result = b ? {
      hebrewLabel: b.heLabel     ? b.heLabel.value     : null,
      wikiTitle:   b.heWikiTitle ? b.heWikiTitle.value : null,
    } : null;

    CACHE.set(cacheKey, result);
    return result;
  } catch { CACHE.set(cacheKey, null); return null; }
}

async function callFamilyHE(familySciName) {
  if (!familySciName) return null;
  const cacheKey = 'fam:' + familySciName;
  if (CACHE.has(cacheKey)) return CACHE.get(cacheKey);

  try {
    const safe   = escapeSparql(familySciName);
    const sparql = `SELECT ?heLabel WHERE {
      ?item wdt:P225 "${safe}".
      ?item rdfs:label ?heLabel.
      FILTER(LANG(?heLabel)="he")
    } LIMIT 1`;

    const resp = await fetchWithTimeout(
      WIKIDATA_SPARQL + '?query=' + encodeURIComponent(sparql) + '&format=json',
      { headers: { 'Accept': 'application/sparql-results+json' } },
      8000
    );
    if (!resp.ok) { CACHE.set(cacheKey, null); return null; }

    const data   = await resp.json();
    const b      = data.results?.bindings?.[0];
    const result = b?.heLabel ? b.heLabel.value : null;
    CACHE.set(cacheKey, result);
    return result;
  } catch { CACHE.set(cacheKey, null); return null; }
}

// ============================================================
// GBIF VERNACULAR NAMES
// ============================================================
async function callGBIF(sciName) {
  const cacheKey = 'gbif:' + sciName;
  if (CACHE.has(cacheKey)) return CACHE.get(cacheKey);

  try {
    // Step 1: match scientific name → usageKey
    const matchResp = await fetchWithTimeout(
      'https://api.gbif.org/v1/species/match?name=' + encodeURIComponent(sciName) + '&verbose=false',
      {},
      8000
    );
    if (!matchResp.ok) { CACHE.set(cacheKey, null); return null; }

    const matchData = await matchResp.json();
    const usageKey  = matchData.usageKey;
    if (!usageKey) { CACHE.set(cacheKey, null); return null; }

    // Step 2: fetch vernacular names, filter for Hebrew
    const vernResp = await fetchWithTimeout(
      `https://api.gbif.org/v1/species/${usageKey}/vernacularNames?limit=100`,
      {},
      8000
    );
    if (!vernResp.ok) { CACHE.set(cacheKey, null); return null; }

    const vernData = await vernResp.json();
    const heb = (vernData.results || []).find(n => n.language === 'heb' && n.vernacularName);
    const result = heb ? heb.vernacularName : null;

    CACHE.set(cacheKey, result);
    return result;
  } catch { CACHE.set(cacheKey, null); return null; }
}

// ============================================================
// iNATURALIST — with Israel place filter
// ============================================================
async function callInatTaxa(sciName) {
  const cacheKey = 'inat:' + sciName;
  if (CACHE.has(cacheKey)) return CACHE.get(cacheKey);

  try {
    const resp = await fetchWithTimeout(
      'https://api.inaturalist.org/v1/taxa?q=' + encodeURIComponent(sciName) +
      '&locale=he&place_id=6986&per_page=5',
      {},
      6000
    );
    if (!resp.ok) { CACHE.set(cacheKey, null); return null; }

    const data  = await resp.json();
    const taxon = (data.results || []).find(
      t => (t.name || '').toLowerCase() === sciName.toLowerCase()
    );
    if (!taxon) { CACHE.set(cacheKey, null); return null; }

    const name =
      taxon.preferred_common_name ||
      (taxon.names || []).find(n => n.locale === 'he' && n.name)?.name ||
      null;

    CACHE.set(cacheKey, name);
    return name;
  } catch { CACHE.set(cacheKey, null); return null; }
}

// ============================================================
// KKL PROXY
// ============================================================

// Forward lookup: Hebrew name → structured data (original mode)
async function fetchKKLByHebrewName(hebrewName) {
  const cacheKey = 'kkl:he:' + hebrewName;
  if (CACHE.has(cacheKey)) return CACHE.get(cacheKey);

  try {
    const url  = `${KKL_FUNCTION}?name=${encodeURIComponent(hebrewName)}`;
    if (DEBUG_MODE) console.log('🌿 KKL by Hebrew name:', url);
    const resp = await fetchWithTimeout(url, {}, 10000);
    if (!resp.ok) { CACHE.set(cacheKey, null); return null; }
    const data = await resp.json();
    if (data.error) { if (DEBUG_MODE) console.warn('KKL error:', data.error); CACHE.set(cacheKey, null); return null; }
    if (DEBUG_MODE) console.log('KKL data:', data);
    CACHE.set(cacheKey, data);
    return data;
  } catch (e) {
    if (DEBUG_MODE) console.warn('KKL fetch failed:', e.message);
    CACHE.set(cacheKey, null); return null;
  }
}

// Reverse lookup: scientific name → hebrewName + structured data (new mode)
async function fetchKKLBySciName(sciName) {
  const cacheKey = 'kkl:sci:' + sciName;
  if (CACHE.has(cacheKey)) return CACHE.get(cacheKey);

  try {
    const url  = `${KKL_FUNCTION}?sciname=${encodeURIComponent(sciName)}`;
    if (DEBUG_MODE) console.log('🌿 KKL by sciname:', url);
    const resp = await fetchWithTimeout(url, {}, 10000);
    if (!resp.ok) { CACHE.set(cacheKey, null); return null; }
    const data = await resp.json();
    if (data.error) { CACHE.set(cacheKey, null); return null; }
    if (DEBUG_MODE) console.log('KKL sciname data:', data);
    CACHE.set(cacheKey, data);
    return data;
  } catch (e) {
    if (DEBUG_MODE) console.warn('KKL sciname fetch failed:', e.message);
    CACHE.set(cacheKey, null); return null;
  }
}

// ============================================================
// WIKIPEDIA (Hebrew)
// ============================================================
// Fetch a specific section from a Wikipedia page by searching section titles
async function callWikipediaHESection(pageName, sectionTitle) {
  try {
    const sectionUrl = 'https://he.wikipedia.org/w/api.php?action=parse' +
      '&page=' + encodeURIComponent(pageName) +
      '&prop=sections&format=json&origin=*';
    const secResp = await fetchWithTimeout(sectionUrl, {}, 6000);
    if (!secResp.ok) return null;
    const secData = await secResp.json();
    const sections = secData.parse?.sections || [];
    if (DEBUG_MODE) console.log(`📖 Wiki sections for "${pageName}":`, sections.map(s => `[${s.index}] "${s.line}"`));
    const match = sections.find(s => s.line === sectionTitle || s.anchor === sectionTitle.replace(/ /g, '_'));
    if (!match) return null;
    const contentUrl = 'https://he.wikipedia.org/w/api.php?action=parse' +
      '&page=' + encodeURIComponent(pageName) +
      '&section=' + match.index +
      '&prop=text&format=json&origin=*';
    const contentResp = await fetchWithTimeout(contentUrl, {}, 6000);
    if (!contentResp.ok) return null;
    const contentData = await contentResp.json();
    const html = contentData.parse?.text?.['*'] || '';
    const extract = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800) || null;
    if (DEBUG_MODE) console.log(`📖 Wiki section match: [${match.index}] "${match.line}", extract=${extract?.length}`);
    return extract ? { extract, url: `https://he.wikipedia.org/wiki/${encodeURIComponent(pageName)}#${match.anchor}` } : null;
  } catch { return null; }
}

async function callWikipediaHE(hebrewTitle) {
  const cacheKey = 'wiki:' + hebrewTitle;
  if (DEBUG_MODE) console.log(`📖 callWikipediaHE("${hebrewTitle}") — cached=${CACHE.has(cacheKey)}`);
  if (CACHE.has(cacheKey)) return CACHE.get(cacheKey);

  try {
    // action=query with redirects=1 resolves "חלמית גדולה" → { to:"חלמית", tofragment:"חלמית_גדולה" }
    const url = 'https://he.wikipedia.org/w/api.php?action=query' +
      '&titles=' + encodeURIComponent(hebrewTitle) +
      '&redirects=1&prop=extracts|info&exintro=1&inprop=url&format=json&origin=*';
    const resp = await fetchWithTimeout(url, {}, 6000);
    if (!resp.ok) { CACHE.set(cacheKey, null); return null; }
    const data = await resp.json();
    const pages = data.query?.pages;
    if (!pages) { CACHE.set(cacheKey, null); return null; }
    const page = Object.values(pages)[0];

    let extract = null;
    const redirect = data.query?.redirects?.[0];

    // If page is missing entirely (no redirect), try first word as genus page + section search
    if (!page || page.missing !== undefined) {
      const firstWord = hebrewTitle.split(' ')[0];
      if (firstWord === hebrewTitle) { CACHE.set(cacheKey, null); return null; }
      if (DEBUG_MODE) console.log(`📖 Wiki: "${hebrewTitle}" missing — trying genus page "${firstWord}"`);
      const genusResult = await callWikipediaHESection(firstWord, hebrewTitle);
      CACHE.set(cacheKey, genusResult);
      return genusResult;
    }

    if (DEBUG_MODE) console.log(`📖 Wiki query [${hebrewTitle}]: page="${page.title}", redirect=`, redirect, 'extract length=', page.extract?.length);

    // If redirected to a different page, try to find a section matching the original title
    const targetPage = redirect?.to || page.title;
    if (redirect && targetPage !== hebrewTitle) {
      const sectionResult = await callWikipediaHESection(targetPage, hebrewTitle);
      if (sectionResult?.extract) extract = sectionResult.extract;
    }

    // Fall back to intro of the (possibly redirected) page
    if (!extract && page.extract) {
      extract = page.extract.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
    }

    const result = {
      extract: extract || null,
      url:     page.fullurl || (redirect?.to ? `https://he.wikipedia.org/wiki/${encodeURIComponent(redirect.to)}` : null),
    };
    CACHE.set(cacheKey, result);
    return result;
  } catch { CACHE.set(cacheKey, null); return null; }
}

// Hebrew Wikipedia full-text search with genus validation
async function searchWikipediaHE(sciName) {
  try {
    const genus      = sciName.trim().split(/\s+/)[0];
    const searchResp = await fetchWithTimeout(
      'https://he.wikipedia.org/w/api.php?action=query&list=search' +
      '&srsearch=' + encodeURIComponent(sciName) +
      '&srlimit=1&format=json&origin=*',
      {},
      6000
    );
    if (!searchResp.ok) return null;

    const searchData  = await searchResp.json();
    const hebrewTitle = searchData.query?.search?.[0]?.title;
    if (!hebrewTitle) return null;

    const summaryResp = await fetchWithTimeout(
      'https://he.wikipedia.org/w/api.php?action=query' +
      '&titles=' + encodeURIComponent(hebrewTitle) +
      '&redirects=1&prop=extracts|info&exintro=1&inprop=url&format=json&origin=*',
      {},
      6000
    );
    if (!summaryResp.ok) return null;

    const summaryData = await summaryResp.json();
    const page        = Object.values(summaryData.query?.pages || {})[0];
    if (!page || page.missing !== undefined) return null;

    const extract = page.extract ? page.extract.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (!extract.includes(genus)) return null;   // genus validation

    return {
      title:   hebrewTitle,
      extract: extract || null,
      url:     page.fullurl || null,
    };
  } catch { return null; }
}

// English Wikipedia thumbnail fallback for candidates
async function fetchEnWikiThumbnail(sciName) {
  try {
    const resp = await fetchWithTimeout(
      'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(sciName),
      {},
      6000
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.thumbnail?.source || null;
  } catch { return null; }
}

// "More info" URL priority chain
function buildMoreInfoUrl(speciesWikiUrl, genusWikiUrl, sciName) {
  if (speciesWikiUrl) return speciesWikiUrl;
  if (genusWikiUrl)   return genusWikiUrl;
  const genus = sciName.trim().split(/\s+/)[0];
  if (genus) return 'https://flora.org.il/plants/systematics/' + genus.toLowerCase() + '/';
  return null;
}

// ============================================================
// HEBREW NAME RESOLUTION — core helper
// Tries all sources for a given name (species or genus).
// Returns { hebrewName, wikidataResult, inatResult, gbifResult, kklResult }
// ============================================================
async function resolveHebrewName(sciName) {
  // Run Wikidata, GBIF, iNat, and KKL reverse lookup in parallel
  const [wdRes, gbifRes, inatRes, kklRes] = await Promise.allSettled([
    callWikidata(sciName),
    callGBIF(sciName),
    callInatTaxa(sciName),
    fetchKKLBySciName(sciName),
  ]);

  const wd   = wdRes.status   === 'fulfilled' ? wdRes.value   : null;
  const gbif = gbifRes.status === 'fulfilled' ? gbifRes.value : null;
  const inat = inatRes.status === 'fulfilled' ? inatRes.value : null;
  const kkl  = kklRes.status  === 'fulfilled' ? kklRes.value  : null;

  // Priority: Wikidata label → GBIF → iNaturalist → KKL hebrewName field
  const hebrewName =
    wd?.hebrewLabel ||
    gbif           ||
    inat           ||
    kkl?.hebrewName||
    null;

  return { hebrewName, wd, gbif, inat, kkl };
}

// ============================================================
// RESULT PROCESSING
// ============================================================

function extractCandidate(result) {
  if (!result?.species) return null;
  return {
    sciName:   result.species.scientificNameWithoutAuthor || '',
    familySci: result.species.family?.scientificNameWithoutAuthor || '',
    score:     result.score,
    imageURL:  result.species.images?.[0]?.url?.m || null,
  };
}

// Lightweight check: does this species have a Hebrew name? (used to filter candidates)
// Returns { hasHebrew, ...resolved } so callers can reuse the data.
async function quickHebrewCheck(sciName) {
  const resolved = await resolveHebrewName(sciName);
  const hasHebrew = !!(resolved.hebrewName);

  // Genus fallback if species-level lookup found nothing
  if (!hasHebrew) {
    const genus = sciName.trim().split(/\s+/)[0];
    if (genus !== sciName) {
      const genusResolved = await resolveHebrewName(genus);
      if (genusResolved.hebrewName) {
        if (DEBUG_MODE) console.log(`  genus fallback "${genus}" → "${genusResolved.hebrewName}"`);
        // Merge genus Hebrew name into resolved so resolveAndRender doesn't repeat the lookup
        return { hasHebrew: true, ...resolved, hebrewName: genusResolved.hebrewName, _genusFallback: true };
      }
    }
  }

  if (DEBUG_MODE) console.log(`Hebrew check [${sciName}]: "${resolved.hebrewName || '-'}" (wd="${resolved.wd?.hebrewLabel || '-'}", gbif="${resolved.gbif || '-'}", inat="${resolved.inat || '-'}", kkl="${resolved.kkl?.hebrewName || '-'}")`);
  return { hasHebrew, ...resolved };
}

// Full enrichment for a confirmed species — reuses cached data from quickHebrewCheck
async function resolveAndRender(sciName, familySci, score, apiImageURL, prefetched = {}) {
  showScreen('loading');

  const genus = sciName.trim().split(/\s+/)[0];

  // Reuse whatever was already fetched during filtering
  let { wd: speciesWD, inat: inatResult, kkl: kklFromReverse } = prefetched;

  // If not prefetched, fetch now
  if (speciesWD === undefined || inatResult === undefined) {
    const fresh = await resolveHebrewName(sciName);
    speciesWD  = speciesWD  === undefined ? fresh.wd   : speciesWD;
    inatResult = inatResult === undefined ? fresh.inat : inatResult;
    if (kklFromReverse === undefined) kklFromReverse = fresh.kkl;
  }

  // Determine Hebrew name
  let hebrewName =
    speciesWD?.hebrewLabel                     ||
    prefetched.gbif                            ||
    (await callGBIF(sciName).catch(() => null)) ||   // might already be cached
    inatResult                                 ||
    kklFromReverse?.hebrewName                 ||
    null;

  // Genus fallback for display name
  let isGenusLevel = false;
  if (!hebrewName) {
    const genusResolved = await resolveHebrewName(genus !== sciName ? genus : '___');
    if (genusResolved.hebrewName) {
      hebrewName   = genusResolved.hebrewName + ' (סוג)';
      isGenusLevel = true;
    }
  }

  // Parallel: family Hebrew + genus Wikidata + Wikipedia summary
  // Also start KKL early if we have a Hebrew name
  const tasks = [
    callFamilyHE(familySci),
    genus !== sciName ? callWikidata(genus) : Promise.resolve(null),
    speciesWD?.wikiTitle ? callWikipediaHE(speciesWD.wikiTitle) : Promise.resolve(null),
  ];

  // Fire KKL in parallel if we already have the Hebrew name
  // (skip if we already got structured data from the reverse lookup)
  const kklPromise = kklFromReverse
    ? Promise.resolve(kklFromReverse)
    : hebrewName && !isGenusLevel
      ? fetchKKLByHebrewName(hebrewName)
      : Promise.resolve(null);

  const [
    [hebrewFamilyRes, genusWDRes, wikiSummaryRes],
    kklData,
  ] = await Promise.all([
    Promise.allSettled(tasks),
    kklPromise,
  ]);

  const hebrewFamily  = hebrewFamilyRes.status  === 'fulfilled' ? hebrewFamilyRes.value  : null;
  const genusWD       = genusWDRes.status       === 'fulfilled' ? genusWDRes.value       : null;
  let   wikiData      = wikiSummaryRes.status   === 'fulfilled' ? wikiSummaryRes.value   : null;

  let speciesWikiUrl = wikiData?.url || null;
  let wikiSummary    = wikiData?.extract || null;

  // Genus Wikipedia link (for "more info" fallback, no summary needed)
  let genusWikiUrl = null;
  if (!speciesWikiUrl && genusWD?.wikiTitle) {
    const genusWikiData = await callWikipediaHE(genusWD.wikiTitle);
    genusWikiUrl = genusWikiData?.url || null;
  }

  // Last resort: Hebrew Wikipedia full-text search
  if (!speciesWikiUrl) {
    const wikiSearch = await searchWikipediaHE(sciName);
    if (wikiSearch) {
      speciesWikiUrl = wikiSearch.url;
      if (!hebrewName || isGenusLevel) { hebrewName = wikiSearch.title; isGenusLevel = false; }
      if (!wikiSummary) wikiSummary = wikiSearch.extract;
    }
  }

  // Try fetching Wikipedia summary by Hebrew name directly
  // If "חלמית גדולה" fails (no dedicated page), fall back to first word "חלמית" (genus page often contains species info)
  if (!wikiSummary && hebrewName && !isGenusLevel) {
    const heNameWiki = await callWikipediaHE(hebrewName);
    if (heNameWiki?.extract) {
      wikiSummary = heNameWiki.extract;
      if (!speciesWikiUrl) speciesWikiUrl = heNameWiki.url;
    } else {
      const firstWord = hebrewName.split(' ')[0];
      if (firstWord !== hebrewName) {
        const genusHeWiki = await callWikipediaHE(firstWord);
        if (genusHeWiki?.extract) {
          wikiSummary = genusHeWiki.extract;
          if (!speciesWikiUrl) speciesWikiUrl = genusHeWiki.url;
        }
      }
    }
  }

  // If still no Hebrew name, try KKL reverse lookup (may not have run yet)
  if (!hebrewName && !kklData) {
    const kklFinal = await fetchKKLBySciName(sciName);
    if (kklFinal?.hebrewName) hebrewName = kklFinal.hebrewName;
  }

  const moreInfoUrl = buildMoreInfoUrl(speciesWikiUrl, genusWikiUrl, sciName);

  renderResult({
    hebrewName,
    sciName,
    family: familySci,
    hebrewFamily,
    score,
    apiImageURL,
    wikiSummary,
    moreInfoUrl,
    kklData,
  });
}

async function processResult(plantnetJson) {
  const results = plantnetJson?.results || [];
  const best    = results[0];

  if (!best || best.score < CONFIDENCE_THRESHOLD) {
    renderError('not_found');
    return;
  }

  // High confidence path
  if (best.score >= CONFIDENCE_LOW) {
    const c = extractCandidate(best);
    if (!c) { renderError('not_found'); return; }
    const checked = await quickHebrewCheck(c.sciName);
    if (DEBUG_MODE) console.log(`High-confidence "${c.sciName}" (${Math.round(c.score * 100)}%): hasHebrew=${checked.hasHebrew}`);
    if (checked.hasHebrew) {
      await resolveAndRender(c.sciName, c.familySci, c.score, c.imageURL, checked);
      return;
    }
    if (DEBUG_MODE) console.warn(`"${c.sciName}" failed Hebrew filter — demoting to candidates`);
  }

  // Low-medium confidence: check top 5 candidates
  const pool = results.slice(0, 5).map(extractCandidate).filter(Boolean);

  const hebrewChecks = await Promise.allSettled(
    pool.map(async c => ({ ...c, checked: await quickHebrewCheck(c.sciName) }))
  );

  const checked  = hebrewChecks.filter(r => r.status === 'fulfilled').map(r => r.value);
  const filtered = checked.filter(c => c.checked.hasHebrew);

  if (DEBUG_MODE) {
    console.log('Pool of 5:', pool.map(c => c.sciName));
    console.log('Passed Hebrew filter:', filtered.map(c => c.sciName));
  }

  if (filtered.length === 0) {
    renderError('no_israeli_match');
    return;
  }

  const finalCandidates = filtered.slice(0, 3);

  if (finalCandidates.length === 1) {
    const c = finalCandidates[0];
    await resolveAndRender(c.sciName, c.familySci, c.score, c.imageURL, c.checked);
    return;
  }

  // Fetch English Wikipedia thumbnails for multi-candidate screen
  await Promise.allSettled(finalCandidates.map(async c => {
    c.imageURL = c.imageURL || await fetchEnWikiThumbnail(c.sciName);
  }));

  renderCandidates(finalCandidates);
}

// ============================================================
// RENDERING
// ============================================================

function renderCandidates(candidates) {
  const list = document.getElementById('candidates-list');
  list.innerHTML = '';

  candidates.forEach(c => {
    const card = document.createElement('div');
    card.className = 'candidate-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    if (c.imageURL) {
      const img = document.createElement('img');
      img.className = 'candidate-thumb';
      img.src = c.imageURL;
      img.alt = c.sciName;
      img.onerror = () => img.replaceWith(makePlaceholder());
      card.appendChild(img);
    } else {
      card.appendChild(makePlaceholder());
    }

    const info = document.createElement('div');
    info.className = 'candidate-info';
    const hebrewLabel = c.checked?.hebrewName || c.checked?.wd?.hebrewLabel || c.checked?.inat || c.checked?.gbif || '';
    info.innerHTML = `
      ${hebrewLabel ? `<div class="candidate-heb">${hebrewLabel}</div>` : ''}
      <div class="candidate-sci">${c.sciName}</div>
      <div class="candidate-family">${c.familySci}</div>`;
    card.appendChild(info);

    const badge = document.createElement('span');
    badge.className   = 'candidate-score';
    badge.textContent = Math.round(c.score * 100) + '%';
    card.appendChild(badge);

    const pick = () => resolveAndRender(c.sciName, c.familySci, c.score, c.imageURL, c.checked || {});
    card.addEventListener('click', pick);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') pick(); });

    list.appendChild(card);
  });

  showScreen('candidates');
}

function makePlaceholder() {
  const el = document.createElement('div');
  el.className   = 'candidate-thumb-placeholder';
  el.textContent = '🌸';
  return el;
}

function renderResult({ hebrewName, sciName, family, hebrewFamily, score, apiImageURL, wikiSummary, moreInfoUrl, kklData }) {
  const imgWrap = document.getElementById('result-img-wrap');
  imgWrap.innerHTML = '';

  if (STATE.previewDataURL || apiImageURL) {
    const img = document.createElement('img');
    img.className = 'result-photo';
    img.alt = hebrewName || sciName || 'תמונת הפרח';
    img.src = STATE.previewDataURL || apiImageURL;
    if (STATE.previewDataURL && apiImageURL) {
      img.onerror = () => { img.src = apiImageURL; img.onerror = null; };
    }
    imgWrap.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className   = 'result-photo-placeholder';
    ph.textContent = '🌸';
    imgWrap.appendChild(ph);
  }

  const badge = document.getElementById('result-confidence');
  const scorePct = Math.round(score * 100);
  badge.textContent   = `ביטחון ${scorePct}%`;
  badge.style.display = 'inline-block';
  badge.className = 'result-confidence-badge ' +
    (scorePct >= 70 ? 'confidence-high' : scorePct >= 40 ? 'confidence-mid' : 'confidence-low');

  document.getElementById('result-heb-name').textContent = hebrewName || sciName || '—';
  document.getElementById('result-sci-name').textContent = hebrewName ? sciName : '';

  const familyDisplay = hebrewFamily || family;
  if (familyDisplay) {
    document.getElementById('result-family').textContent      = familyDisplay;
    document.getElementById('result-family-row').style.display = 'flex';
  } else {
    document.getElementById('result-family-row').style.display = 'none';
  }

  document.getElementById('result-summary').textContent = wikiSummary || '';

  // KKL structured data grid
  const kklDiv = document.getElementById('result-kkl-data');
  const kklFields = kklData && ['englishName','arabicName','petalCount','leafShape','leafEdge',
    'lifeForm','stemShape','habitat','floweringSeason','distribution'].some(k => kklData[k]);

  const fields = kklData ? [
    { label: 'עונת פריחה',     value: kklData.floweringSeason, wide: false },
    { label: 'בית גידול',      value: kklData.habitat,         wide: false },
    { label: 'צורת חיים',      value: kklData.lifeForm,        wide: false },
    { label: 'שם עממי',        value: kklData.englishName,     wide: false },
    { label: 'שם ערבי',        value: kklData.arabicName,      wide: false },
    { label: "מס' עלי כותרת", value: kklData.petalCount,      wide: false },
    { label: 'תפוצה בארץ',     value: kklData.distribution,    wide: true  },
  ].filter(f => f.value) : [];

  if (fields.length > 0) {
    const gridHTML = fields.map(f =>
      `<div class="kkl-field${f.wide ? ' full-width' : ''}">
        <span class="kkl-label">${f.label}</span>
        <span class="kkl-value">${f.value}</span>
      </div>`
    ).join('');

    const kklLink = kklData.kklUrl
      ? `<div class="kkl-url-row"><a href="${kklData.kklUrl}" target="_blank" rel="noopener">מקור: KKL ↗</a></div>`
      : '';

    kklDiv.innerHTML     = `<div class="kkl-grid">${gridHTML}</div>${kklLink}`;
    kklDiv.style.display = '';
  } else {
    kklDiv.style.display = 'none';
  }

  const moreBtn    = document.getElementById('result-more-info');
  const finalMoreUrl = (kklData?.kklUrl) || moreInfoUrl;
  if (finalMoreUrl) {
    moreBtn.href         = finalMoreUrl;
    moreBtn.style.display = '';
  } else {
    moreBtn.style.display = 'none';
  }

  showScreen('result');
}

// ============================================================
// ERROR HANDLING
// ============================================================
const ERROR_CONFIGS = {
  not_found: {
    icon: '🌿', title: 'פרח לא נמצא',
    message: 'לא הצלחנו לזהות את הפרח. נסה לצלם שוב:',
    tips: [
      'התקרב לפרח — מלא את רוב המסגרת',
      'התרחק מעט אם הפרח גדול מאוד',
      'הקש על המסך לפני הצילום כדי להתמקד',
      'צלם באור יום טבעי — הימנע מפלאש',
      'הימנע מרקע עמוס — שמיים או קיר נקי עדיפים',
      'ודא שהפרח במרכז התמונה',
    ],
  },
  no_israeli_match: {
    icon: '📷', title: 'לא זוהה פרח ישראלי',
    message: 'לא הצלחנו להתאים את הצילום לפרח ישראלי מוכר. נסה לצלם מחדש:',
    tips: [
      'התקרב לפרח — מלא את רוב המסגרת',
      'הקש על המסך לפני הצילום כדי להתמקד',
      'צלם את הפרח בלבד, ללא עלים או ענפים אחרים',
      'צלם באור יום טבעי — הימנע מפלאש',
      'נסה זווית אחרת — מלפנים או מהצד',
    ],
  },
  network: {
    icon: '📡', title: 'שגיאת תקשורת',
    message: 'לא ניתן להתחבר לשירות הזיהוי. בדוק את חיבור האינטרנט שלך ונסה שוב.',
    tips: [],
  },
  api_error: {
    icon: '⚠️', title: 'שגיאה בשירות הזיהוי',
    message: 'שירות הזיהוי החזיר שגיאה. נסה שוב מאוחר יותר.',
    tips: [],
  },
};

function renderError(type, httpStatus) {
  const cfg        = ERROR_CONFIGS[type] || ERROR_CONFIGS.api_error;
  const statusNote = httpStatus ? ` (שגיאה ${httpStatus})` : '';
  document.getElementById('error-icon').textContent    = cfg.icon;
  document.getElementById('error-title').textContent   = cfg.title;
  document.getElementById('error-message').textContent = cfg.message + statusNote;

  const tipsList = document.getElementById('error-tips');
  if (cfg.tips && cfg.tips.length > 0) {
    tipsList.innerHTML    = cfg.tips.map(t => `<li>${t}</li>`).join('');
    tipsList.style.display = 'block';
  } else {
    tipsList.innerHTML    = '';
    tipsList.style.display = 'none';
  }
  showScreen('error');
}

// ============================================================
// MAIN IDENTIFY FLOW
// ============================================================
async function identifyFlower(blob, filename) {
  const btnIdentify = document.getElementById('btn-identify');
  btnIdentify.disabled = true;
  showScreen('loading');
  try {
    const compressedBlob = await compressImage(blob);
    const plantnetJson   = await callPlantNetAPI(compressedBlob, filename);

    if (DEBUG_MODE) {
      console.group('🌸 Flower ID Debug');
      (plantnetJson?.results?.slice(0, 3) || []).forEach((r, i) => {
        console.log(`Result ${i + 1} (${Math.round(r.score * 100)}%):`,
          r.species?.scientificNameWithoutAuthor,
          '| images:', r.species?.images?.length ?? 'none',
          r.species?.images?.[0]?.url?.m ?? '(no URL)');
      });
      console.groupEnd();
    }

    await processResult(plantnetJson);

  } catch (err) {
    if (err.type === 'not_found') renderError('not_found');
    else if (err.type === 'api')  renderError('api_error', err.status);
    else                          renderError('network');
  } finally {
    btnIdentify.disabled = false;
  }
}

// ============================================================
// STATE RESET
// ============================================================
function resetState() {
  STATE.currentFile    = null;
  STATE.previewDataURL = null;
  document.getElementById('preview-img').src        = '';
  document.getElementById('result-img-wrap').innerHTML = '';
}

// ============================================================
// EVENT BINDING
// ============================================================
function bindEvents() {
  document.getElementById('input-camera').addEventListener('change',  handleFileSelected);
  document.getElementById('input-gallery').addEventListener('change', handleFileSelected);

  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const btnCamera = document.getElementById('btn-camera');
  if (!isMobile) {
    btnCamera.classList.add('btn-disabled');
    btnCamera.disabled = true;
    btnCamera.setAttribute('aria-disabled', 'true');
    document.getElementById('camera-desktop-note').style.display = '';
  }
  btnCamera.addEventListener('click', () => {
    if (!isMobile) return;
    const inp = document.getElementById('input-camera');
    inp.value = ''; inp.click();
  });
  document.getElementById('btn-gallery').addEventListener('click', () => {
    const inp = document.getElementById('input-gallery');
    inp.value = ''; inp.click();
  });

  document.getElementById('btn-identify').addEventListener('click', () => {
    if (STATE.currentFile) identifyFlower(STATE.currentFile, STATE.currentFile.name);
  });
  document.getElementById('btn-retake').addEventListener('click', () => {
    resetState(); showScreen('landing');
  });
  document.getElementById('btn-back').addEventListener('click', () => {
    const active = document.querySelector('.screen.active');
    const id     = active ? active.id.replace('screen-', '') : '';
    if (id === 'preview' || id === 'candidates') {
      showScreen(STATE.currentFile ? 'preview' : 'landing');
    } else {
      showScreen(STATE.currentFile ? 'preview' : 'landing');
    }
  });
  document.getElementById('btn-new-search').addEventListener('click', () => {
    resetState(); showScreen('landing');
  });
  document.getElementById('btn-candidates-new').addEventListener('click', () => {
    resetState(); showScreen('landing');
  });
  document.getElementById('btn-try-again').addEventListener('click', () => {
    showScreen(STATE.currentFile ? 'preview' : 'landing');
  });
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  showScreen('landing');
});
