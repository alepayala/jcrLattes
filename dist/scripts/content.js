// Private metrics have been moved to private_tools.js
let COLORS = window.JCRReportUtils.COLORS;
let GRAPH_COLORS = window.JCRReportUtils.GRAPH_COLORS;

const SECTIONS = {
  citations: { ref: 'Citacoes', selector: 'a[name="Citacoes"]' },
  articles: { ref: 'ArtigosCompletos', selector: '#artigos-completos' },
  books: { ref: 'LivrosCapitulos', selector: 'a[name="LivrosCapitulos"]' },
  congress: { ref: 'TrabalhosPublicadosAnaisCongresso', selector: 'a[name="TrabalhosPublicadosAnaisCongresso"]' }
};

let observer;
const observerConfig = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['original-title', 'cvuri']
};

const SETTINGS_KEY = 'jcr_lattes_settings';
let jcrTablesState = { publicacoes: false, citacoes: false, orientacoes: false, patentes: false, eventos: false, opcoes: false, graficos: false };

async function saveSettings() {
  const settings = {
    highJcr: parseFloat(document.getElementById('high-jcr-input')?.value) || 7,
    lowJcr: parseFloat(document.getElementById('low-jcr-input')?.value) || 1.5,
    customYears: parseInt(document.getElementById('custom-year-input')?.value) || 1,
    colors: {
      high: document.getElementById('color-jcr-high')?.value || COLORS.highJcr,
      mid: document.getElementById('color-jcr-mid')?.value || COLORS.midJcr,
      low: document.getElementById('color-jcr-low')?.value || COLORS.lowJcr,
      none: document.getElementById('color-jcr-none')?.value || COLORS.noJcr
    },
    toggles: {
      disableReport: document.getElementById('toggle-disable-report')?.checked ?? false,
      disableExtraInfo: document.getElementById('toggle-disable-extra-info')?.checked ?? false,
      identification: document.getElementById('toggle-group-identification')?.checked ?? true,
      tables: jcrTablesState,
      sections: {},
      jcr: {
        high: document.getElementById('toggle-jcr-high')?.checked ?? true,
        mid: document.getElementById('toggle-jcr-mid')?.checked ?? true,
        low: document.getElementById('toggle-jcr-low')?.checked ?? true,
        none: document.getElementById('toggle-jcr-none')?.checked ?? true
      },
      period: document.querySelector('input[name="toggle-period"]:checked')?.value || 'all',
      author: {
        first: document.getElementById('toggle-author-first')?.checked ?? true,
        last: document.getElementById('toggle-author-last')?.checked ?? true,
        others: document.getElementById('toggle-author-others')?.checked ?? true,
        gc: document.getElementById('toggle-author-gc')?.checked ?? true
      }
    }
  };

  // Capture individual section toggles
  document.querySelectorAll('input[id^="toggle-section-"]').forEach(cb => {
    const id = cb.id.replace('toggle-section-', '');
    settings.toggles.sections[id] = cb.checked;
  });

  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [SETTINGS_KEY]: settings }, () => {
        if (chrome.runtime.lastError) {
          console.warn('JCRLattes: Error saving settings', chrome.runtime.lastError);
        }
        resolve();
      });
    } catch (e) {
      console.warn('JCRLattes: Exception saving settings', e);
      resolve();
    }
  });
}

async function loadSettings() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(SETTINGS_KEY, (result) => {
        if (chrome.runtime.lastError) {
          console.warn('JCRLattes: Error loading settings', chrome.runtime.lastError);
          resolve(null);
        } else {
          resolve(result ? result[SETTINGS_KEY] : null);
        }
      });
    } catch (e) {
      console.warn('JCRLattes: Exception loading settings', e);
      resolve(null);
    }
  });
}

(async () => await main())();

async function main() {
  // attempt to get CV name and link from Lattes page
  const nameLink = getLattesNameAndLink();

  // check whether name and link were not found (if not this is not a CV Lattes!)
  if (!nameLink['name']) return;

  // Abort if this is the Capitcha page
  if (document.querySelector('.tituloCaptcha') || document.getElementById('idSecaoCaptcha')) {
    console.log('JCR Lattes: Captcha page detected. Aborting.');
    hideLoading(true); // Ensure it's hidden if somehow it was shown

    if (window.JCRDBTools) {
      await window.JCRDBTools.loadSettings();
      if (window.JCRDBTools.isUnlocked) {
        const btn = document.createElement('div');
        btn.innerHTML = '🗄️';
        btn.title = 'Abrir Banco de Dados JCRLattes';
        btn.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          font-size: 30px;
          cursor: pointer;
          background: #fff;
          border: 2px solid #1565C0;
          border-radius: 50%;
          width: 50px;
          height: 50px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 6px rgba(0,0,0,0.3);
          z-index: 999999;
          transition: transform 0.2s;
        `;
        btn.onmouseover = () => btn.style.transform = 'scale(1.1)';
        btn.onmouseout = () => btn.style.transform = 'scale(1)';
        btn.onclick = () => window.JCRDBTools.viewDB();
        document.body.appendChild(btn);
      }
    }

    return;
  }

  // Success! Show loading message now that we know we are on a valid CV page
  showLoading();

  // Initial processing
  processLattesPage(nameLink);

  // Identify requested sections
  try { identifySections(); } catch (e) { console.error('[JCR Lattes] Error during initial section identification:', e); }

  // Debounced processor
  const processDebounced = debounce(() => {
    processLattesPage(nameLink);
  }, 1000);

  // Initialize observer
  observer = new MutationObserver((mutations) => {
    // Only trigger if mutation is relevant (child list changes or JCR/CVURI attributes)
    const isRelevant = mutations.some(m =>
      m.type === 'childList' ||
      (m.type === 'attributes' && (
        m.target.classList.contains('ajaxJCR') ||
        m.target.hasAttribute('cvuri') ||
        m.target.classList.contains('artigo-completo')
      ))
    );

    if (isRelevant) {
      processDebounced();
    }
  });

  const articlesDiv = document.getElementById('artigos-completos');
  if (articlesDiv) {
    observer.observe(articlesDiv, observerConfig);
  } else {
    // Fallback if articles div is not yet present - use body
    observer.observe(document.body, observerConfig);
  }
}

// Helper to safely update DOM without triggering observer loop
async function updateSafe(callback) {
  if (observer) observer.disconnect();
  try {
    await callback();
  } finally {
    if (observer) {
      const articlesDiv = document.getElementById('artigos-completos');
      if (articlesDiv) {
        observer.observe(articlesDiv, observerConfig);
      } else {
        observer.observe(document.body, observerConfig);
      }
    }
  }
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function getLattesNameAndLink() {
  // find name element
  let nameElem = document.querySelector("h2[class='nome']");
  if (!nameElem) {
    // try printed version
    nameElem = document.querySelector("div[class='nome']");
  }
  if (!nameElem) {
    // try fallback for printed version
    const h2s = document.querySelectorAll('h2');
    if (h2s.length > 0) nameElem = h2s[0];
  }

  if (!nameElem) return { name: '', link: '' };

  let link = '';
  // Use textContent for name
  let name = nameElem.textContent.trim();

  // Extract Fellowship (Bolsa) Information
  let fellowshipText = '';
  let fellowshipString = '';
  
  // Usually the second h2.nome or div.nome contains the fellowship
  const allNames = document.querySelectorAll("h2[class='nome'], div[class='nome']");
  if (allNames.length > 1) {
    // Check if the second one looks like a fellowship
    const secondElem = allNames[1];
    fellowshipText = secondElem.textContent.trim();
  }

  if (fellowshipText) {
    const fellowshipsDict = {
      "Produtividade em Pesquisa do CNPq": "PQ",
      "Produtividade em Desenvolvimento Tecnológico e Extensão Inovadora do CNPq": "DT",
      "Produtividade Desen. Tec. e Extensão Inovadora do CNPq": "DT"
    };

    let acronim = "";
    for (const [key, value] of Object.entries(fellowshipsDict)) {
      if (fellowshipText.includes(key)) {
        acronim = value;
        break;
      }
    }

    if (acronim) {
      // Extract Level (e.g. "Nível 1B")
      const levelMatch = fellowshipText.match(/N[íi]vel\s+([A-Z0-9]+)/i);
      const level = levelMatch ? levelMatch[1] : "";
      fellowshipString = level ? `${acronim}-${level}` : acronim;
    }
  }

  // find link element
  let linkElem = document.querySelector("ul[class='informacoes-autor']");
  if (!linkElem) {
    // try printed version - look for the text "Endereço para acessar este CV"
    const allSpans = document.querySelectorAll('span, td, div');
    for (const el of allSpans) {
      if (el.innerText && el.innerText.includes('Endereço para acessar este CV')) {
        linkElem = el;
        link = linkElem.innerText.match(/\bhttps?:\/\/\S+/gi)?.[0] || '';
        break;
      }
    }
  } else {
    // extract URL from link element text
    const match = linkElem.innerText.match(/\bhttps?:\/\/\S+/gi);
    if (match) link = match[0];
  }

  let researcherIdLink = '';
  const ridAnchor = document.querySelector('a[href*="researcherid.com/rid/"]');
  if (ridAnchor) {
      researcherIdLink = ridAnchor.href;
  }

  return { name, link, researcherIdLink, fellowshipText, fellowshipString };
}

async function processLattesPage(nameLink) {
  showLoading();
  // Load saved settings if any
  const saved = await loadSettings();

  if (saved?.toggles?.tables) {
    jcrTablesState = { ...jcrTablesState, ...saved.toggles.tables };
  }

  if (saved?.colors) {
    COLORS.highJcr = saved.colors.high || COLORS.highJcr;
    COLORS.midJcr = saved.colors.mid || COLORS.midJcr;
    COLORS.lowJcr = saved.colors.low || COLORS.lowJcr;
    COLORS.noJcr = saved.colors.none || COLORS.noJcr;

    GRAPH_COLORS.highJcr = COLORS.highJcr;
    GRAPH_COLORS.midJcr = COLORS.midJcr;
    GRAPH_COLORS.lowJcr = COLORS.lowJcr;
    GRAPH_COLORS.noJcr = COLORS.noJcr;
  }

  // Update from current on-page inputs if they exist
  const colorHigh = document.getElementById('color-jcr-high');
  if (colorHigh) COLORS.highJcr = GRAPH_COLORS.highJcr = colorHigh.value;
  const colorMid = document.getElementById('color-jcr-mid');
  if (colorMid) COLORS.midJcr = GRAPH_COLORS.midJcr = colorMid.value;
  const colorLow = document.getElementById('color-jcr-low');
  if (colorLow) COLORS.lowJcr = GRAPH_COLORS.lowJcr = colorLow.value;
  const colorNone = document.getElementById('color-jcr-none');
  if (colorNone) COLORS.noJcr = GRAPH_COLORS.noJcr = colorNone.value;

  // Default values
  let highJcr = saved?.highJcr ?? 7;
  let lowJcr = saved?.lowJcr ?? 1.5;

  // Try to get values from existing inputs
  const highInput = document.getElementById('high-jcr-input');
  const lowInput = document.getElementById('low-jcr-input');

  if (highInput) highJcr = parseFloat(highInput.value);
  if (lowInput) lowJcr = parseFloat(lowInput.value);

  // Custom year span
  let customYears = saved?.customYears ?? 1;
  const customInput = document.getElementById('custom-year-input');
  if (customInput) customYears = parseInt(customInput.value);

  // Wrap updates in updateSafe to prevent infinite loop
  await updateSafe(async () => {
    try {
      // Annotate Lattes page and return annotated Lattes info
      const authorNames = getAuthorNames();
      const lattesInfo = annotateLattesPage(highJcr, lowJcr, authorNames);
      const supervisions = extractSupervisions();
      const patents = extractPatents();
      const events = extractEvents();

      // inject report table into Lattes page
      if (lattesInfo) {
        const currentYear = new Date().getFullYear();
        const startYearRecent = currentYear - 5;
        const startYearLast10 = currentYear - 10;
        const startYearCustom = currentYear - customYears;

        const finalStats = window.JCRReportUtils.calculateReportStats(
          lattesInfo, patents, events, supervisions, extractDeclaredCitations(),
          currentYear, customYears, startYearRecent, startYearLast10, startYearCustom, highJcr, lowJcr
        );
        const minYear = finalStats.minYear;
        const maxYear = finalStats.maxYear;

        await injectReportTable(finalStats, startYearRecent, startYearLast10, startYearCustom, customYears, currentYear, highJcr, lowJcr, nameLink, minYear, maxYear, lattesInfo);
      }
    } finally {
      hideLoading();
    }
  });
}

// Annotate and extract journal info form Lattes page
function annotateLattesPage(highJcr, lowJcr, authorNames) {
  console.log('Searching for journal publications...');

  // find all full articles - be resilient to different page structures
  let pubElems = document.querySelectorAll("div[class='artigo-completo']");

  // if not found, try to look inside the specific div if it exists
  if (pubElems.length === 0) {
    const startElem = document.getElementById('artigos-completos');
    if (startElem) {
      pubElems = startElem.querySelectorAll("div[class='artigo-completo']");
    }
  }

  if (pubElems.length === 0) return [];

  // Remove existing year separators
  document.querySelectorAll('.jcr-lattes-year-separator').forEach(el => el.remove());
  let lastYear = null;

  const pubInfoList = [];

  for (const pubElem of pubElems) {
    // Reset visibility to match default checked state of toggles
    pubElem.style.display = '';

    const pubInfo = {
      year: NaN,
      issn: '',
      title: '',
      impactFactor: null,
      jcrYear: null,
      wosCitations: 0,
      scopusCitations: 0,
      hasEtAl: false,
      isFirstAuthor: false,
      isLastAuthor: false,
      authorCount: 0,
      authorCountStr: '',
      authorRank: -1,
      doi: '',
      reference: ''
    };

    // Store the clean text before any annotations are injected
    pubInfo.reference = pubElem.innerText.replace(/\s+/g, ' ').trim();

    // get year of publication
    const yearElem = pubElem.querySelector(
      "span[class='informacao-artigo'][data-tipo-ordenacao='ano']"
    );

    if (yearElem) {
      pubInfo.year = parseInt(yearElem.textContent);
    } else {
      // Try to find year in the text content if specific span is missing
      const yearMatch = pubElem.innerText.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        pubInfo.year = parseInt(yearMatch[0]);
      }
    }

    // Insert year separator if year changed
    if (!isNaN(pubInfo.year)) {
      if (pubInfo.year !== lastYear) {
        injectYearSeparator(pubElem, pubInfo.year);
        lastYear = pubInfo.year;
      }
    }

    // Check for et al or COLLABORATION in authors
    // VERY IMPORTANT: do not look for variations of "et.al". It must be a strict search.
    // COLLABORATION is checked case-insensitively as requested.
    if (pubElem.innerText.includes('et.al') || pubElem.innerText.toUpperCase().includes('COLLABORATION')) {
      pubInfo.hasEtAl = true;
    }

    // Calculate author count and extract author list
    const parts = pubElem.innerText.split(';');

    const pubAuthors = [];
    let authorCount = 0;

    for (const part of parts) {
      // Remove leading numbering like "54." or "54 . " or "54" at start of string
      let p = part.replace(/^\d+\s*\.\s*/, '').trim();
      p = p.trim();

      if (p.startsWith('et.al') || p.toUpperCase().includes('COLLABORATION')) {
        continue;
      }

      if (p.includes(',')) {
        authorCount++;
        pubAuthors.push(p);
      }
    }

    // Determine Main Author Rank
    let mainAuthorRank = -1;
    let highlightedAuthorCandidate = null;

    // 1. Try to find the bolded author in the content cell
    const contentCell = pubElem.querySelector('.layout-cell-11');
    if (contentCell) {
      const boldTags = contentCell.querySelectorAll('b');
      for (const b of boldTags) {
        const text = b.innerText.trim();
        // Filter out known non-author bold tags
        // Ignroe "53." (numbering), "Citações:", "Fator de Impacto", numeric values
        if (/^\d+\.$/.test(text)) continue;
        if (text.includes('Citações') || text.includes('Fator de Impacto')) continue;
        if (/^[\d\.]+$/.test(text)) continue;

        // Assume this is the author
        highlightedAuthorCandidate = text.replace(/;$/, '').trim();
        break;
      }
    }

    // 2. Priority check: Match against highlighted author
    if (highlightedAuthorCandidate) {
      for (let i = 0; i < pubAuthors.length; i++) {
        // Use loose check (includes) to handle slight differences
        if (pubAuthors[i].toUpperCase().includes(highlightedAuthorCandidate.toUpperCase())) {
          mainAuthorRank = i + 1;
          break;
        }
      }
    }

    // 3. Fallback: Use provided authorNames list
    if (mainAuthorRank === -1 && authorNames && authorNames.length > 0) {
      for (let i = 0; i < pubAuthors.length; i++) {
        const authorStr = pubAuthors[i];
        const match = authorNames.some(alias => authorStr.toUpperCase().includes(alias.toUpperCase()));
        if (match) {
          mainAuthorRank = i + 1;
          break;
        }
      }
    }

    // Apply Author Logic
    pubInfo.authorRank = mainAuthorRank;
    
    // 1o (First): Includes First Author papers (even if et al).
    if (mainAuthorRank === 1) {
      pubInfo.isFirstAuthor = true;
    }

    // If hasEtAl is true (due to "et.al" or "COLLABORATION"), author count is at least 21.
    pubInfo.authorCount = pubInfo.hasEtAl ? Math.max(authorCount, 21) : authorCount;
    pubInfo.authorCountStr = `${pubInfo.authorCount} autor${pubInfo.authorCount !== 1 ? 'es' : ''}`;
    if (pubInfo.hasEtAl) {
      pubInfo.authorCountStr += ' + et al.';
    }

    if (mainAuthorRank !== -1) {
      // Últ (Last): Includes Last Author papers (strictly NO "et.al").
      if (mainAuthorRank === authorCount && !pubInfo.hasEtAl && authorCount > 1) {
        pubInfo.isLastAuthor = true;
      }

      const isFirst = pubInfo.isFirstAuthor;
      const isLast = pubInfo.isLastAuthor;

      let rankLabel = `, ordem: ${mainAuthorRank}`;
      if (isFirst) {
        rankLabel = `, <span style="color: ${COLORS.midJcr}; font-weight: bold;">Primeiro</span>`;
      } else if (isLast) {
        rankLabel = `, <span style="color: ${COLORS.highJcr}; font-weight: bold;">Último</span>`;
      }
      pubInfo.authorCountStr += rankLabel;
    }

    // Extract citations using DOM traversal
    const isiImg = pubElem.querySelector('img[src*="isi.gif"]');
    if (isiImg) {
      const countSpan = isiImg.nextElementSibling;
      if (countSpan && countSpan.classList.contains('numero-citacao')) {
        pubInfo.wosCitations = parseInt(countSpan.textContent);
      }
    }

    const scopusImg = pubElem.querySelector('img[src*="scopus.png"]');
    if (scopusImg) {
      const countSpan = scopusImg.nextElementSibling;
      if (countSpan && countSpan.classList.contains('numero-citacao')) {
        pubInfo.scopusCitations = parseInt(countSpan.textContent);
      }
    }

    if (isNaN(pubInfo.year)) continue;

    const jcrElem = pubElem.querySelector(".ajaxJCR");
    if (jcrElem) {
      const jcrTitle = jcrElem.getAttribute('original-title');
      if (jcrTitle) {
        const match = jcrTitle.match(/Fator de impacto \(JCR (\d{4})\): ([\d\.]+)/);
        if (match && match[2]) {
          pubInfo.jcrYear = match[1];
          pubInfo.impactFactor = match[2];
        }
      }
    }

    let jcrLevel = 'none';
    if (pubInfo.impactFactor) {
      const ifVal = parseFloat(pubInfo.impactFactor);
      if (ifVal > 0) {
        if (ifVal >= highJcr) jcrLevel = 'high';
        else if (ifVal >= lowJcr) jcrLevel = 'mid';
        else jcrLevel = 'low';
      }
    }
    pubElem.setAttribute('data-jcr-level', jcrLevel);
    if (!isNaN(pubInfo.year)) {
      pubElem.setAttribute('data-year', pubInfo.year);
    }
    pubElem.setAttribute('data-is-first', pubInfo.isFirstAuthor);
    pubElem.setAttribute('data-is-last', pubInfo.isLastAuthor);
    pubElem.setAttribute('data-is-gc', pubInfo.hasEtAl);

    const pubElemLastItem = pubElem.querySelector('[cvuri]');
    if (pubElemLastItem) {
      const pubInfoString = escapeHtml(pubElemLastItem.getAttribute('cvuri'));
      const pubInfoItems = pubInfoString.split(/\?(?!&)|&(?=\w+)/);

      for (const pubInfoItem of pubInfoItems) {
        if (pubInfoItem.includes('issn=')) {
          const issnStr = pubInfoItem.split('issn=')[1];
          pubInfo.issn = issnStr.substring(0, 4) + '-' + issnStr.substring(4, 8);
        }
        if (pubInfoItem.includes('doi=')) {
          pubInfo.doi = pubInfoItem.split('doi=')[1];
        }
      }

      // Fallback to extract doi from icone-doi if missing
      if (!pubInfo.doi) {
        const doiElem = pubElem.querySelector('a.icone-doi');
        if (doiElem && doiElem.href) {
          const urlMatch = doiElem.href.match(/doi\.org\/(.+)$/);
          if (urlMatch) {
            pubInfo.doi = urlMatch[1];
          }
        }
      }

      const journalInfo = {
        impactFactor: pubInfo.impactFactor,
        jcrYear: pubInfo.jcrYear
      };

      injectJournalAnnotation(
        pubElemLastItem,
        pubInfo.issn,
        journalInfo,
        highJcr,
        lowJcr,
        pubInfo.authorCountStr
      );
    }
    pubInfoList.push(pubInfo);
  }

  return pubInfoList;
}

function escapeHtml(text) {
  return text
    .replace('&amp;', '&')
    .replace('&lt;', '<')
    .replace('&gt;', '>')
    .replace('&quot;', '"')
    .replace('&#039;', "'");
}

function injectJournalAnnotation(
  elem,
  issn,
  journalInfo,
  highJcr,
  lowJcr,
  authorCountStr
) {
  const annotElem = document.createElement('span');

  let journalAnnot;

  if (!journalInfo.impactFactor) {
    journalAnnot = ` <b style="color: ${COLORS.noJcr}">Não classificado</b>`;
  } else {
    const ifVal = parseFloat(journalInfo.impactFactor);
    let color = COLORS.lowJcr;
    if (ifVal >= highJcr) color = COLORS.highJcr;
    else if (ifVal >= lowJcr) color = COLORS.midJcr;

    journalAnnot = ` <b style="color: ${color}">Fator de Impacto: ${journalInfo.impactFactor}</b>`;
  }

  if (authorCountStr) {
    journalAnnot += ` <span style="color: ${COLORS.authorCount}; margin-left: 5px; font-weight: bold;">(${authorCountStr})</span>`;
  }

  annotElem.innerHTML = journalAnnot;

  const existingAnnot = elem.parentNode.querySelector('.jcr-lattes-annotation');
  if (existingAnnot) {
    existingAnnot.remove();
  }

  setAttributes(annotElem, {
    class: 'jcr-lattes-annotation',
    style: 'font-size: 11px; line-height: 1.2; margin-top: 2px; display: block;'
  });

  elem.insertAdjacentElement('afterend', annotElem);
}

function injectYearSeparator(pubElem, year) {
  const separator = document.createElement('div');
  setAttributes(separator, {
    class: 'jcr-lattes-year-separator',
    'data-year': year,
    style: 'margin-top: 25px; margin-bottom: 15px; clear: both;'
  });

  separator.innerHTML = `
    <div style="
      padding: 8px 15px;
      background: linear-gradient(to right, #f8f9fa, #ffffff);
      border-left: 5px solid ${COLORS.midJcr};
      border-bottom: 1px solid #eee;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-radius: 4px;
    ">
      <span style="font-size: 1.4em; font-weight: bold; color: #333; font-family: inherit;">${year}</span>
      <span style="font-size: 0.85em; color: #777; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Publicações de ${year}</span>
    </div>
  `;

  pubElem.parentNode.insertBefore(separator, pubElem);
}

async function injectReportTable(stats, startYearRecent, startYearLast10, startYearCustom, customYears, currentYear, highJcr, lowJcr, nameLink, minYear, maxYear, lattesInfo) {
  // get main content div
  const mainContentDiv = document.getElementsByClassName('main-content')[0];



  const getSoftColor = window.JCRReportUtils.getSoftColor.bind(window.JCRReportUtils);
  const bgTotal = '#f8f9fa';
  const bgHigh = getSoftColor(COLORS.highJcr, 0.85);
  const bgMid = getSoftColor(COLORS.midJcr, 0.85);
  const bgLow = getSoftColor(COLORS.lowJcr, 0.85);
  const bgNone = getSoftColor(COLORS.noJcr, 0.85);

  // create table HTML
  const tableHTML = `
  <style>
    /* Force input spinners to be visible */
    input[type=number]::-webkit-inner-spin-button, 
    input[type=number]::-webkit-outer-spin-button { 
      opacity: 1;
    }
  </style>
  <div class="rodape-cv" style="margin-top: 0px; color: ${COLORS.footerText}; font-size: 1.1em;">
      <table style="width: 100%; border-collapse: collapse; text-align: center; font-family: inherit; font-size: 0.9em;">
        <thead>
          <tr style="background-color: ${COLORS.backgroundHeader}; border-bottom: 1px solid ${COLORS.border};">
            <th class="jcr-main-header-cell" colspan="${jcrTablesState.publicacoes ? 18 : 1}" style="padding: 8px; text-align: left; vertical-align: middle;">
              <span class="toggle-table-btn" data-target="publicacoes" style="cursor: pointer; user-select: none; margin-right: 5px;">${jcrTablesState.publicacoes ? '[+]' : '[-]'}</span> Publicações
            </th>
            <th class="jcr-main-header-extra" rowspan="2" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; padding: 8px; border-left: 1px solid #ccc; text-align: center; background-color: ${bgTotal};" title="Quantidade total de artigos">Qtd<br><label style="display:inline-block;margin-top:6px;font-weight:normal;font-size:0.9em;cursor:pointer;" title="Recalcular as estatísticas com base nos filtros selecionados"><input type="checkbox" id="tbl-chk-filtrar" style="margin:0 2px 0 0;vertical-align:middle;"><span style="vertical-align:middle;">Filtrar</span></label></th>
            <th class="jcr-main-header-extra" colspan="2" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; padding: 8px; border-left: 1px solid #eee; text-align: center; background-color: #ffffff;" title="Métricas de Fator de Impacto (JCR)">JCR</th>
            <th class="jcr-main-header-extra" colspan="3" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; padding: 8px; border-left: 1px solid #eee; text-align: center; background-color: ${bgTotal};" title="Estatísticas de Autoria">Autores</th>
            <th class="jcr-main-header-extra" rowspan="2" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; padding: 8px; border-left: 1px solid #ccc; vertical-align: middle; text-align: center;" title="Grandes Colaborações (et al. ou COLLABORATION)">GC</th>
            <th class="jcr-main-header-extra" colspan="3" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; padding: 8px; border-left: 1px solid #ccc; text-align: center; background-color: ${bgHigh};" title="Artigos com Fator de Impacto Alto">
              JCR Alto (>= <input type="number" id="high-jcr-input" value="${highJcr}" step="0.5" style="width: 40px; padding: 2px; text-align: center;">)
            </th>
            <th class="jcr-main-header-extra" colspan="3" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; padding: 8px; border-left: 1px solid #ccc; text-align: center; background-color: ${bgMid};" title="Artigos com Fator de Impacto Médio">
              JCR Médio (>= <input type="number" id="low-jcr-input" value="${lowJcr}" step="0.5" style="width: 40px; padding: 2px; text-align: center;">)
            </th>
            <th class="jcr-main-header-extra" colspan="3" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; padding: 8px; border-left: 1px solid #ccc; text-align: center; background-color: ${bgLow};" title="Artigos com Fator de Impacto Baixo">JCR Baixo (< ${lowJcr})</th>
            <th class="jcr-main-header-extra" rowspan="2" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; padding: 8px; border-left: 1px solid #ccc; vertical-align: middle; text-align: center; background-color: ${bgNone};" title="Artigos sem Fator de Impacto classificado">Sem JCR</th>
          </tr>
          <tr class="jcr-main-header-subrow" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; background-color: ${COLORS.backgroundSubHeader}; border-bottom: 2px solid ${COLORS.border}; font-size: 0.85em;">
            <th style="padding: 4px; text-align: center;" title="Intervalo de anos analisado">Período</th>
            <!-- Total Sub-headers -->
            <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: #ffffff;" title="Soma total dos Fatores de Impacto">Σ</th>
            <th style="padding: 4px; text-align: center; background-color: #ffffff;" title="Média do Fator de Impacto (Soma / Artigos com JCR)">μ</th>
            
            <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgTotal};" title="Quantidade de artigos como Primeiro Autor">1o</th>
            <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgTotal};" title="Quantidade de artigos como Último Autor">Últ</th>
            <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgTotal};" title="Média de autores por artigo (exclui Grandes Colaborações)">μ</th>
            <!-- High Sub-headers -->
            <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgHigh};" title="Quantidade de artigos nesta faixa">Qtd</th>
            <th style="padding: 4px; text-align: center; background-color: ${bgHigh};" title="Soma do Fator de Impacto nesta faixa">Σ</th>
            <th style="padding: 4px; text-align: center; background-color: ${bgHigh};" title="Média do Fator de Impacto nesta faixa">μ</th>
            <!-- Mid Sub-headers -->
            <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgMid};" title="Quantidade de artigos nesta faixa">Qtd</th>
            <th style="padding: 4px; text-align: center; background-color: ${bgMid};" title="Soma do Fator de Impacto nesta faixa">Σ</th>
            <th style="padding: 4px; text-align: center; background-color: ${bgMid};" title="Média do Fator de Impacto nesta faixa">μ</th>
            <!-- Low Sub-headers -->
            <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgLow};" title="Quantidade de artigos nesta faixa">Qtd</th>
            <th style="padding: 4px; text-align: center; background-color: ${bgLow};" title="Soma do Fator de Impacto nesta faixa">Σ</th>
            <th style="padding: 4px; text-align: center; background-color: ${bgLow};" title="Média do Fator de Impacto nesta faixa">μ</th>
          </tr>
        </thead>
        <tbody id="tbody-publicacoes" style="display: ${jcrTablesState.publicacoes ? 'none' : ''};">
          ${window.JCRReportUtils.generateRow(`Total (${minYear} - ${maxYear})`, stats.all)}
          ${window.JCRReportUtils.generateRow(`5 anos (${startYearRecent} - ${maxYear})`, stats.recent)}
          ${window.JCRReportUtils.generateRow(`10 anos (${startYearLast10} - ${maxYear})`, stats.last10)}
          ${window.JCRReportUtils.generateRow(`<input type="number" id="custom-year-input" value="${customYears}" min="0" style="width: 40px; padding: 2px; text-align: center;"> ${customYears == 1 || customYears == 0 ? 'ano' : 'anos'} (${startYearCustom} - ${maxYear})`, stats.custom)}
        </tbody>
      </table>
    </div>`;

  // create new alert div
  let alertDiv = document.querySelector('#annotation-alert-div');
  if (!alertDiv) {
    alertDiv = document.createElement('div');
    setAttributes(alertDiv, {
      class: 'max-width min-width', // Removed main-content class as it is now nested
      id: 'annotation-alert-div',
      style: `margin-bottom: 10px; border-bottom: 4px double ${COLORS.alertBorder}; padding-bottom: 10px;`
    });
    // inject alert div into Lattes page as the first child of the main content div
    mainContentDiv.insertBefore(alertDiv, mainContentDiv.firstChild);
  }


  let declaredHTML = '';
  if (stats.declaredCitations && (stats.declaredCitations.wosCitations || stats.declaredCitations.wosHIndex || stats.declaredCitations.scopusCitations || stats.declaredCitations.scopusHIndex)) {
    declaredHTML = `
          <tr style="border-bottom: 1px solid #ddd;">
             <td style="padding: 8px; text-align: left;"><strong>Declarado</strong></td>
             <td style="padding: 8px; text-align: center;"><strong>${stats.declaredCitations.wosCitations || ''}</strong></td>
             <td style="padding: 8px; text-align: center;"><strong>${stats.declaredCitations.wosHIndex || ''}</strong></td>
             <td style="padding: 8px; text-align: center;"><strong>${stats.declaredCitations.scopusCitations || ''}</strong></td>
             <td style="padding: 8px; text-align: center;"><strong>${stats.declaredCitations.scopusHIndex || ''}</strong></td>
          </tr>
    `;
  }

  const citationTableHTML = `
    <div class="rodape-cv" style="margin-top: 10px; color: ${COLORS.footerText}; font-size: 1.1em;">
      <table style="width: 100%; border-collapse: collapse; text-align: center; font-family: inherit; font-size: 0.9em;">
        <thead>
          <tr style="background-color: ${COLORS.backgroundHeader}; border-bottom: 1px solid ${COLORS.border};">
            <th class="jcr-main-header-cell" data-total-cols="5" colspan="${jcrTablesState.citacoes ? 5 : 1}" style="padding: 8px; text-align: left;">
              <span class="toggle-table-btn" data-target="citacoes" style="cursor: pointer; user-select: none; margin-right: 5px;">${jcrTablesState.citacoes ? '[+]' : '[-]'}</span> Citações
            </th>
            <th class="jcr-main-header-extra" style="display: ${jcrTablesState.citacoes ? 'none' : ''}; padding: 8px; text-align: center;" title="Total de citações extraídas da Web of Science">Citações Web of Science</th>
            <th class="jcr-main-header-extra" style="display: ${jcrTablesState.citacoes ? 'none' : ''}; padding: 8px; text-align: center;" title="Índice H calculado a partir das citações da Web of Science">Índice H Web of Science</th>
            <th class="jcr-main-header-extra" style="display: ${jcrTablesState.citacoes ? 'none' : ''}; padding: 8px; text-align: center;" title="Total de citações extraídas da Scopus">Citações Scopus</th>
            <th class="jcr-main-header-extra" style="display: ${jcrTablesState.citacoes ? 'none' : ''}; padding: 8px; text-align: center;" title="Índice H calculado a partir das citações da Scopus">Índice H Scopus</th>
          </tr>
        </thead>
        <tbody id="tbody-citacoes" style="display: ${jcrTablesState.citacoes ? 'none' : ''};">
          ${declaredHTML}
          <tr style="border-bottom: 1px solid #ddd;">
             <td style="padding: 8px; text-align: left;">Total (${minYear} - ${maxYear})</td>
             <td style="padding: 8px; text-align: center;">${stats.all.citations.wos.sum}</td>
             <td style="padding: 8px; text-align: center;">${stats.all.citations.wos.hIndex}</td>
             <td style="padding: 8px; text-align: center;">${stats.all.citations.scopus.sum}</td>
             <td style="padding: 8px; text-align: center;">${stats.all.citations.scopus.hIndex}</td>
          </tr>
          <tr style="border-bottom: 1px solid #ddd;">
             <td style="padding: 8px; text-align: left;">5 anos (${startYearRecent} - ${maxYear})</td>
             <td style="padding: 8px; text-align: center;">${stats.recent.citations.wos.sum}</td>
             <td style="padding: 8px; text-align: center;">${stats.recent.citations.wos.hIndex}</td>
             <td style="padding: 8px; text-align: center;">${stats.recent.citations.scopus.sum}</td>
             <td style="padding: 8px; text-align: center;">${stats.recent.citations.scopus.hIndex}</td>
          </tr>
          <tr style="border-bottom: 1px solid #ddd;">
             <td style="padding: 8px; text-align: left;">10 anos (${startYearLast10} - ${maxYear})</td>
             <td style="padding: 8px; text-align: center;">${stats.last10.citations.wos.sum}</td>
             <td style="padding: 8px; text-align: center;">${stats.last10.citations.wos.hIndex}</td>
             <td style="padding: 8px; text-align: center;">${stats.last10.citations.scopus.sum}</td>
             <td style="padding: 8px; text-align: center;">${stats.last10.citations.scopus.hIndex}</td>
          </tr>
          <tr style="border-bottom: 1px solid #ddd;">
             <td style="padding: 8px; text-align: left;">${customYears} ${customYears == 1 || customYears == 0 ? 'ano' : 'anos'} (${startYearCustom} - ${maxYear})</td>
             <td style="padding: 8px; text-align: center;">${stats.custom.citations.wos.sum}</td>
             <td style="padding: 8px; text-align: center;">${stats.custom.citations.wos.hIndex}</td>
             <td style="padding: 8px; text-align: center;">${stats.custom.citations.scopus.sum}</td>
             <td style="padding: 8px; text-align: center;">${stats.custom.citations.scopus.hIndex}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  // Supervision Table
  let supervisionTableHTML = '';
  if (stats.supervisions) {
    const allTypes = new Set([
      ...Object.keys(stats.supervisions.inCourse),
      ...Object.keys(stats.supervisions.concluded)
    ]);

    if (allTypes.size > 0) {
      const PRIORITY_ORDER = [
        "Dissertação de mestrado",
        "Tese de doutorado",
        "Supervisão de pós-doutorado",
        "Iniciação científica",
        "Trabalho de conclusão de curso de graduação",
        "Monografia de conclusão de curso de aperfeiçoamento/especialização",
        "Orientações de outra natureza"
      ];

      const sortedTypes = [];
      const typesSet = new Set(allTypes);

      // Add types in priority order
      PRIORITY_ORDER.forEach(type => {
        // Add main type
        if (typesSet.has(type)) {
          sortedTypes.push(type);
          typesSet.delete(type);
        }
        // Add Coorientador variant
        const coType = `${type} (Coorientador)`;
        if (typesSet.has(coType)) {
          sortedTypes.push(coType);
          typesSet.delete(coType);
        }
      });

      // Add remaining types
      typesSet.forEach(type => {
        sortedTypes.push(type);
      });

      let rows = '';
      sortedTypes.forEach(type => {
        const inCourseCount = stats.supervisions.inCourse[type] || 0;
        const concludedYears = stats.supervisions.concluded[type] || [];
        const concludedCount = Array.isArray(concludedYears) ? concludedYears.length : 0;
        const total = inCourseCount + concludedCount;

        // Calculate 5 and 10+ custom years counts
        const count5 = Array.isArray(concludedYears) ? concludedYears.filter(y => !isNaN(y) && y >= startYearRecent).length : 0;
        const count10 = Array.isArray(concludedYears) ? concludedYears.filter(y => !isNaN(y) && y >= startYearLast10).length : 0;
        const countCustom = Array.isArray(concludedYears) ? concludedYears.filter(y => !isNaN(y) && y >= startYearCustom).length : 0;

        rows += `
                <tr style="border-bottom: 1px solid #ddd;">
                    <td style="padding: 8px; text-align: left;">${type}</td>
                    <td style="padding: 8px; text-align: center;">${inCourseCount}</td>
                    <td style="padding: 8px; text-align: center;"><strong>${concludedCount}</strong></td>
                    <td style="padding: 8px; text-align: center;">${count5}</td>
                    <td style="padding: 8px; text-align: center;">${count10}</td>
                    <td style="padding: 8px; text-align: center;">${countCustom}</td>
                </tr>
              `;
      });

      supervisionTableHTML = `
            <div class="rodape-cv" style="margin-top: 10px; color: ${COLORS.footerText}; font-size: 1.1em;">
              <table style="width: 100%; border-collapse: collapse; text-align: center; font-family: inherit; font-size: 0.9em;">
                <thead>
                  <tr style="background-color: ${COLORS.backgroundHeader}; border-bottom: 1px solid ${COLORS.border};">
                    <th class="jcr-main-header-cell" data-total-cols="6" colspan="${jcrTablesState.orientacoes ? 6 : 1}" style="padding: 8px; text-align: left;">
                      <span class="toggle-table-btn" data-target="orientacoes" style="cursor: pointer; user-select: none; margin-right: 5px;">${jcrTablesState.orientacoes ? '[+]' : '[-]'}</span> Orientações
                    </th>
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.orientacoes ? 'none' : ''}; padding: 8px; text-align: center;" title="Total de orientações atualmente em curso">Em Andamento</th>
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.orientacoes ? 'none' : ''}; padding: 8px; text-align: center;" title="Total histórico de orientações concluídas">Concluídas</th>
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.orientacoes ? 'none' : ''}; padding: 8px; text-align: center;" title="Orientações concluídas nos últimos 5 anos">5 Anos</th>
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.orientacoes ? 'none' : ''}; padding: 8px; text-align: center;" title="Orientações concluídas nos últimos 10 anos">10 Anos</th>
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.orientacoes ? 'none' : ''}; padding: 8px; text-align: center;" title="Orientações concluídas nos últimos ${customYears} anos">${customYears} ${customYears == 1 || customYears == 0 ? 'Ano' : 'Anos'}</th>
                  </tr>
                </thead>
                <tbody id="tbody-orientacoes" style="display: ${jcrTablesState.orientacoes ? 'none' : ''};">
                  ${rows}
                </tbody>
              </table>
            </div>
          `;
    }
  }

  // Patent Table
  let patentTableHTML = '';
  if (stats.all.patents.total > 0) {
    // 1. Identify all unique rows (statuses) from 'all' stats
    const allStatuses = Object.keys(stats.all.patents.statusCounts).sort();

    // 2. Build Rows for each Status
    let rowsHtml = '';

    // Status Rows
    allStatuses.forEach(status => {
      const countAll = stats.all.patents.statusCounts[status] || 0;
      // const countRecent = stats.recent.patents.statusCounts[status] || 0;
      // const countLast10 = stats.last10.patents.statusCounts[status] || 0;

      // Safe access helper
      const getCount = (periodStats, s) => (periodStats.patents.statusCounts[s] || 0);

      rowsHtml += `
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 8px; text-align: left;">${status}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.all, status)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.recent, status)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.last10, status)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.custom, status)}</td>
        </tr>
      `;
    });

    // Total Row
    rowsHtml += `
      <tr style="border-bottom: 1px solid #ddd; background-color: ${COLORS.backgroundSubHeader}; font-weight: bold;">
        <td style="padding: 8px; text-align: left;">Total</td>
        <td style="padding: 8px; text-align: center;">${stats.all.patents.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.recent.patents.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.last10.patents.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.custom.patents.total}</td>
      </tr>
    `;

    patentTableHTML = `
            <div class="rodape-cv" style="margin-top: 10px; color: ${COLORS.footerText}; font-size: 1.1em;">
              <table style="width: 100%; border-collapse: collapse; text-align: center; font-family: inherit; font-size: 0.9em;">
                <thead>
                  <tr style="background-color: ${COLORS.backgroundHeader}; border-bottom: 1px solid ${COLORS.border};">
                    <th class="jcr-main-header-cell" data-total-cols="5" colspan="${jcrTablesState.patentes ? 5 : 1}" style="padding: 8px; text-align: left;">
                      <span class="toggle-table-btn" data-target="patentes" style="cursor: pointer; user-select: none; margin-right: 5px;">${jcrTablesState.patentes ? '[+]' : '[-]'}</span> Patentes
                    </th>
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.patentes ? 'none' : ''}; padding: 8px; text-align: center;" title="Total de patentes (todos os anos)">Total (${minYear} - ${maxYear})</th>
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.patentes ? 'none' : ''}; padding: 8px; text-align: center;" title="Patentes registradas nos últimos 5 anos">5 Anos (${startYearRecent} - ${maxYear})</th>
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.patentes ? 'none' : ''}; padding: 8px; text-align: center;" title="Patentes registradas nos últimos 10 anos">10 Anos (${startYearLast10} - ${maxYear})</th>
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.patentes ? 'none' : ''}; padding: 8px; text-align: center;" title="Patentes registradas nos últimos ${customYears} anos">${customYears} ${customYears == 1 || customYears == 0 ? 'Ano' : 'Anos'} (${startYearCustom} - ${maxYear})</th>
                  </tr>
                </thead>
                <tbody id="tbody-patentes" style="display: ${jcrTablesState.patentes ? 'none' : ''};">
                  ${rowsHtml}
                </tbody>
              </table>
            </div>
      `;
  }

  // Event Table
  let eventTableHTML = '';
  if (stats.all.events.total > 0) {
    const allTypes = Object.keys(stats.all.events.typeCounts).sort();
    let rowsHtml = '';

    allTypes.forEach(type => {
      const getCount = (periodStats, t) => (periodStats.events.typeCounts[t] || 0);

      rowsHtml += `
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 8px; text-align: left;">${type}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.all, type)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.recent, type)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.last10, type)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.custom, type)}</td>
        </tr>
      `;
    });

    rowsHtml += `
      <tr style="border-bottom: 1px solid #ddd; background-color: ${COLORS.backgroundSubHeader}; font-weight: bold;">
        <td style="padding: 8px; text-align: left;">Total</td>
        <td style="padding: 8px; text-align: center;">${stats.all.events.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.recent.events.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.last10.events.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.custom.events.total}</td>
      </tr>
    `;

    eventTableHTML = `
            <div class="rodape-cv" style="margin-top: 10px; color: ${COLORS.footerText}; font-size: 1.1em;">
              <table style="width: 100%; border-collapse: collapse; text-align: center; font-family: inherit; font-size: 0.9em;">
                <thead>
                  <tr style="background-color: ${COLORS.backgroundHeader}; border-bottom: 1px solid ${COLORS.border};">
                    <th class="jcr-main-header-cell" data-total-cols="5" colspan="${jcrTablesState.eventos ? 5 : 1}" style="padding: 8px; text-align: left;">
                      <span class="toggle-table-btn" data-target="eventos" style="cursor: pointer; user-select: none; margin-right: 5px;">${jcrTablesState.eventos ? '[+]' : '[-]'}</span> Participação em Eventos
                    </th>
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.eventos ? 'none' : ''}; padding: 8px; text-align: center;" title="Total de participações em eventos (todos os anos)">Total (${minYear} - ${maxYear})</th>
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.eventos ? 'none' : ''}; padding: 8px; text-align: center;" title="Participações em eventos nos últimos 5 anos">5 Anos (${startYearRecent} - ${maxYear})</th>
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.eventos ? 'none' : ''}; padding: 8px; text-align: center;" title="Participações em eventos nos últimos 10 anos">10 Anos (${startYearLast10} - ${maxYear})</th>
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.eventos ? 'none' : ''}; padding: 8px; text-align: center;" title="Participações em eventos nos últimos ${customYears} anos">${customYears} ${customYears == 1 || customYears == 0 ? 'Ano' : 'Anos'} (${startYearCustom} - ${maxYear})</th>
                  </tr>
                </thead>
                <tbody id="tbody-eventos" style="display: ${jcrTablesState.eventos ? 'none' : ''};">
                  ${rowsHtml}
                </tbody>
              </table>
            </div>
      `;
  }

  const headerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; padding: 10px; background-color: ${COLORS.backgroundHeader}; border-bottom: 2px solid ${COLORS.border}; border-radius: 4px;">
      <h2 style="margin: 0; font-size: 1.25em; color: ${COLORS.footerText}; font-weight: bold;">JCR Lattes Report <span id="jcr-report-name" style="color: #326C99; font-weight: 900; margin-left: 5px;">- ${nameLink.name}</span></h2>
      <div style="display: flex; gap: 20px; align-items: center;">
        <span id="jcr-db-tools-mount" style="display: inline-flex; gap: 8px; margin-right: 10px;"></span>
        <label style="cursor: pointer; display: inline-flex; align-items: center; font-size: 0.95em; font-weight: bold; color: ${COLORS.footerText};">
          <input type="checkbox" id="toggle-disable-report" style="margin-right: 6px; width: 15px; height: 15px;"> Ocultar Tabelas e Gráficos
        </label>
        <label style="cursor: pointer; display: inline-flex; align-items: center; font-size: 0.95em; font-weight: bold; color: ${COLORS.footerText};">
          <input type="checkbox" id="toggle-disable-extra-info" style="margin-right: 6px; width: 15px; height: 15px;"> Ocultar Anotações Adicionais
        </label>
        <span style="cursor: help; font-size: 1.2em; display: inline-flex; align-items: center;" title="ATENÇÃO AOS RELATÓRIOS:&#10;&#10;• A extração depende da formatação do Lattes; preenchimentos atípicos podem gerar erros.&#10;• O carregamento do CV é dinâmico e o script aguarda por essas atualizações, tornando-se suscetível a oscilações na conexão com o servidor.&#10;• As informações extraídas do ResearcherID também podem sofrer falhas. Preferencialmente, esteja logado na Web of Science ou use acesso institucional.&#10;• Relatórios de grupos com muitos CVs são demorados. Se o navegador alertar inatividade, selecione 'Aguardar' e tenha paciência.">⚠️</span>
      </div>
    </div>
  `;

  alertDiv.innerHTML = headerHTML + `
    <div id="jcr-report-content">
      <div id="jcr-report-tables">
         ${tableHTML}
         ${citationTableHTML}
         ${supervisionTableHTML}
         ${patentTableHTML}
         ${eventTableHTML}
      </div>
    </div>
  `;

  const reportContent = alertDiv.querySelector('#jcr-report-content');

  // --- Section Toggles ---
  const sections = getSections();
  sections.forEach(s => {
    s.element.style.display = ''; // Reset visibility to match default checked state of toggles
    if (s.footerElement) s.footerElement.style.display = '';
  });

  // Find the index of the first "Produção" section to determine the split
  let splitIndex = sections.findIndex(section =>
    (section.label && section.label.toLowerCase().includes('produção')) ||
    (section.label && section.label.toLowerCase().includes('produções')) ||
    (section.id && section.id.toLowerCase().includes('producao'))
  );

  if (splitIndex === -1) splitIndex = 0;

  const identificationSections = splitIndex > 0 ? sections.slice(0, splitIndex) : [];
  const otherSections = splitIndex > -1 ? sections.slice(splitIndex) : sections;

  const togglesHTML = generateSectionToggles(identificationSections, otherSections);

  // Append toggles to the reportContent
  const toggleContainer = document.createElement('div');
  toggleContainer.style.display = 'flex';
  toggleContainer.style.flexDirection = 'column';
  toggleContainer.style.gap = '10px';

  const histogramHTML = window.JCRReportUtils.generateHistogramHTML(lattesInfo, highJcr, lowJcr);
  const papersPerYearHTML = window.JCRReportUtils.generatePapersPerYearGraphHTML(lattesInfo, highJcr, lowJcr);

  toggleContainer.innerHTML = `
    <div style="width: 100%;">
        ${togglesHTML}
    </div>
    <div style="width: 100%; display: flex; flex-direction: column; gap: 10px;" id="graphs-wrapper">
      <div class="rodape-cv" style="margin-top: 0px; color: ${COLORS.footerText}; font-size: 1.1em;">
        <table style="width: 100%; border-collapse: collapse; text-align: center; font-family: inherit; font-size: 0.9em;">
          <thead>
            <tr style="background-color: ${COLORS.backgroundHeader}; border-bottom: 1px solid ${COLORS.border};">
              <th style="padding: 8px; text-align: left;">
                <span class="toggle-table-btn" data-target="graficos" style="cursor: pointer; user-select: none; margin-right: 5px;">${jcrTablesState.graficos ? '[+]' : '[-]'}</span> Gráficos
              </th>
            </tr>
          </thead>
          <tbody id="tbody-graficos" style="display: ${jcrTablesState.graficos ? 'none' : ''};">
            <tr>
              <td style="padding: 0; text-align: left;">
                <div style="padding: 10px; background-color: ${COLORS.backgroundSubHeader}; font-size: 0.9em; color: ${COLORS.footerText};">
                  <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 300px;" id="histogram-container">
                        ${histogramHTML}
                    </div>
                    <div style="flex: 1; min-width: 300px;" id="papers-year-container">
                        ${papersPerYearHTML}
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
  reportContent.appendChild(toggleContainer);

  // --- Cache DB Elements ---
  const cachedPubElems = Array.from(document.querySelectorAll('.artigo-completo')).map(el => {
    const yearStr = el.getAttribute('data-year');
    return {
      el: el,
      level: el.getAttribute('data-jcr-level'),
      year: yearStr ? parseInt(yearStr) : NaN,
      isFirst: el.getAttribute('data-is-first') === 'true',
      isLast: el.getAttribute('data-is-last') === 'true',
      isGc: el.getAttribute('data-is-gc') === 'true'
    };
  });

  let lastGraphCutoffYear = null;

  // --- Apply Saved Toggles ---
  const saved = await loadSettings();
  if (saved?.toggles) {
    const isReportHidden = saved.toggles.disableReport === true;

    // 0. Global Toggles
    const disableReportCb = document.getElementById('toggle-disable-report');
    if (disableReportCb && saved.toggles.disableReport !== undefined) {
      disableReportCb.checked = saved.toggles.disableReport;
      reportContent.style.display = isReportHidden ? 'none' : '';
      const nameSpan = document.getElementById('jcr-report-name');
      if (nameSpan) nameSpan.style.display = isReportHidden ? 'none' : '';
    }

    const disableExtraInfoCb = document.getElementById('toggle-disable-extra-info');
    if (disableExtraInfoCb && saved.toggles.disableExtraInfo !== undefined) {
      disableExtraInfoCb.checked = saved.toggles.disableExtraInfo;
      // Apply style to hide annotations
      let style = document.getElementById('jcr-lattes-extra-info-style');
      if (!style) {
        style = document.createElement('style');
        style.id = 'jcr-lattes-extra-info-style';
        document.head.appendChild(style);
      }
      style.innerHTML = disableExtraInfoCb.checked ? '.jcr-lattes-annotation { display: none !important; }' : '';
    }



    // 1. Identification
    const identCb = document.getElementById('toggle-group-identification');
    if (identCb) {
      identCb.checked = saved.toggles.identification;
      identificationSections.forEach(section => {
        section.element.style.display = (isReportHidden || identCb.checked) ? '' : 'none';
        if (section.footerElement) section.footerElement.style.display = section.element.style.display;
      });
    }

    // 2. Sections
    otherSections.forEach(section => {
      const cb = document.getElementById(`toggle-section-${section.id}`);
      if (cb && saved.toggles.sections[section.id] !== undefined) {
        cb.checked = saved.toggles.sections[section.id];
        section.element.style.display = (isReportHidden || cb.checked) ? '' : 'none';
        if (section.footerElement) section.footerElement.style.display = section.element.style.display;
      }
    });

    // 3. JCR Levels
    ['high', 'mid', 'low', 'none'].forEach(level => {
      const savedVal = saved.toggles.jcr[level];
      const cb = document.getElementById(`toggle-jcr-${level}`);
      if (cb && savedVal !== undefined) cb.checked = savedVal;
      const tCb = document.getElementById(`tbl-chk-${level}`);
      if (tCb && savedVal !== undefined) tCb.checked = savedVal;
    });

    // 4. Period
    if (saved.toggles.period) {
      const radio = document.querySelector(`input[name="toggle-period"][value="${saved.toggles.period}"]`);
      if (radio) radio.checked = true;
    }

    // 5. Author Roles
    ['first', 'last', 'others', 'gc'].forEach(role => {
      const savedVal = saved.toggles.author[role];
      const cb = document.getElementById(`toggle-author-${role}`);
      if (cb && savedVal !== undefined) cb.checked = savedVal;
      const tCb = document.getElementById(`tbl-chk-${role}`);
      if (tCb && savedVal !== undefined) tCb.checked = savedVal;
    });

    // Sync table header checkboxes with bottom toggles
    ['high', 'mid', 'low', 'none'].forEach(level => {
      const tCb = document.getElementById(`tbl-chk-${level}`);
      if (tCb) tCb.addEventListener('change', (e) => {
        const bCb = document.getElementById(`toggle-jcr-${level}`);
        if (bCb) { bCb.checked = e.target.checked; bCb.dispatchEvent(new Event('change')); }
      });
    });
    ['gc'].forEach(role => {
      const tCb = document.getElementById(`tbl-chk-${role}`);
      if (tCb) tCb.addEventListener('change', (e) => {
        const bCb = document.getElementById(`toggle-author-${role}`);
        if (bCb) { bCb.checked = e.target.checked; bCb.dispatchEvent(new Event('change')); }
      });
    });

    // Apply visibility based on JCR/Period/Author (Initial Refresh)
    // Wait a tiny bit to ensure DOM attributes are there if possible, 
    // but processLattesPage calls this AFTER annotateLattesPage, so attributes should be there.

    const filtrarCbInit = document.getElementById('tbl-chk-filtrar');
    if (filtrarCbInit) {
      filtrarCbInit.addEventListener('change', () => {
        refreshPubFilters(true);
      });
    }

    refreshPubFilters();
  }

  // Table Toggle Listeners
  document.querySelectorAll('.toggle-table-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetId = e.target.getAttribute('data-target');
      const tbody = document.getElementById('tbody-' + targetId);
      if (tbody) {
        if (tbody.style.display === 'none') {
          tbody.style.display = '';
          e.target.innerText = '[-]';
          jcrTablesState[targetId] = false;
        } else {
          tbody.style.display = 'none';
          e.target.innerText = '[+]';
          jcrTablesState[targetId] = true;
        }

        // Generic logic for table header retraction
        const table = tbody.closest('table');
        if (table) {
          const headerCell = table.querySelector('.jcr-main-header-cell');
          const extraCells = table.querySelectorAll('.jcr-main-header-extra');
          const subRow = table.querySelector('.jcr-main-header-subrow');
          const isCollapsed = jcrTablesState[targetId];
          
          if (headerCell) {
            let totalCols = parseInt(headerCell.getAttribute('data-total-cols'));
            // Special case for main table (publicacoes) where totalCols varies by settings
            if (targetId === 'publicacoes') {
              totalCols = 18;
            }
            headerCell.setAttribute('colspan', isCollapsed ? totalCols : 1);
          }
          if (subRow) subRow.style.display = isCollapsed ? 'none' : '';
          extraCells.forEach(cell => cell.style.display = isCollapsed ? 'none' : '');
        }

        saveSettings();
      }
    });
  });

  // Add event listeners for toggles with Save Logic
  const addListenerWithSave = (id, event = 'change') => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, () => {
      saveSettings();
    });
  };

  // Listeners for Global Toggles
  const disableReportCb = document.getElementById('toggle-disable-report');
  if (disableReportCb) {
    disableReportCb.addEventListener('change', () => {
      const isHidden = disableReportCb.checked;
      reportContent.style.display = isHidden ? 'none' : '';
      const nameSpan = document.getElementById('jcr-report-name');
      if (nameSpan) nameSpan.style.display = isHidden ? 'none' : '';

      if (isHidden) {
        // Show all sections when report is hidden
        identificationSections.forEach(s => {
          s.element.style.display = '';
          if (s.footerElement) s.footerElement.style.display = '';
        });
        otherSections.forEach(s => {
          s.element.style.display = '';
          if (s.footerElement) s.footerElement.style.display = '';
        });
      } else {
        // Restore based on individual checkboxes
        const identCb = document.getElementById('toggle-group-identification');
        if (identCb) {
          identificationSections.forEach(s => {
            s.element.style.display = identCb.checked ? '' : 'none';
            if (s.footerElement) s.footerElement.style.display = s.element.style.display;
          });
        }
        otherSections.forEach(s => {
          const cb = document.getElementById(`toggle-section-${s.id}`);
          if (cb) {
            s.element.style.display = cb.checked ? '' : 'none';
            if (s.footerElement) s.footerElement.style.display = s.element.style.display;
          }
        });
      }

      refreshPubFilters();
      saveSettings();
    });
  }

  const disableExtraInfoCb = document.getElementById('toggle-disable-extra-info');
  if (disableExtraInfoCb) {
    disableExtraInfoCb.addEventListener('change', () => {
      let style = document.getElementById('jcr-lattes-extra-info-style');
      if (!style) {
        style = document.createElement('style');
        style.id = 'jcr-lattes-extra-info-style';
        document.head.appendChild(style);
      }
      style.innerHTML = disableExtraInfoCb.checked ? '.jcr-lattes-annotation { display: none !important; }' : '';
      saveSettings();
    });
  }

  const disableGraphsCb = document.getElementById('toggle-disable-graphs');
  if (disableGraphsCb) {
    disableGraphsCb.addEventListener('change', () => {
      const graphsWrapper = document.getElementById('graphs-wrapper');
      if (graphsWrapper) graphsWrapper.style.display = disableGraphsCb.checked ? 'none' : 'flex';
      saveSettings();
    });
  }

  // Listeners for Inputs
  ['high-jcr-input', 'low-jcr-input', 'custom-year-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      saveSettings();
      processLattesPage(nameLink);
    });
  });

  // 1. Identificação Group
  if (identificationSections.length > 0) {
    const identCheckbox = document.getElementById('toggle-group-identification');
    if (identCheckbox) {
      identCheckbox.addEventListener('change', (e) => {
        const isReportHidden = document.getElementById('toggle-disable-report')?.checked ?? false;
        const isVisible = e.target.checked || isReportHidden;
        identificationSections.forEach(section => {
          section.element.style.display = isVisible ? '' : 'none';
          if (section.footerElement) section.footerElement.style.display = section.element.style.display;
        });
        saveSettings();
      });
    }
  }

  // 2. Other Sections
  otherSections.forEach(section => {
    const checkbox = document.getElementById(`toggle-section-${section.id}`);
    if (checkbox) {
      checkbox.addEventListener('change', (e) => {
        const isReportHidden = document.getElementById('toggle-disable-report')?.checked ?? false;
        const isVisible = e.target.checked || isReportHidden;
        section.element.style.display = isVisible ? '' : 'none';
        if (section.footerElement) section.footerElement.style.display = section.element.style.display;
        saveSettings();
      });
    }
  });

  // 3. Unified Publication Filters (JCR Level + Time Span + Author Role)
  function refreshPubFilters(isFiltrarClick = false) {
    const filtrarCb = document.getElementById('tbl-chk-filtrar');
    const isTableFiltered = filtrarCb ? filtrarCb.checked : false;

    const isReportHidden = document.getElementById('toggle-disable-report')?.checked ?? false;

    const selectedJcrLevels = {
      high: document.getElementById('toggle-jcr-high')?.checked ?? true,
      mid: document.getElementById('toggle-jcr-mid')?.checked ?? true,
      low: document.getElementById('toggle-jcr-low')?.checked ?? true,
      none: document.getElementById('toggle-jcr-none')?.checked ?? true
    };

    const periodChecked = document.querySelector('input[name="toggle-period"]:checked');
    const selectedPeriod = periodChecked ? periodChecked.value : 'all';
    let cutoffYear = 0;
    if (selectedPeriod === 'recent') cutoffYear = startYearRecent;
    else if (selectedPeriod === 'last10') cutoffYear = startYearLast10;
    else if (selectedPeriod === 'custom') cutoffYear = startYearCustom;

    const selectedRoles = {
      first: document.getElementById('toggle-author-first')?.checked ?? true,
      last: document.getElementById('toggle-author-last')?.checked ?? true,
      others: document.getElementById('toggle-author-others')?.checked ?? true,
      gc: document.getElementById('toggle-author-gc')?.checked ?? true
    };

    // Sync from bottom to top checkboxes
    ['high', 'mid', 'low', 'none'].forEach(level => {
      const tCb = document.getElementById(`tbl-chk-${level}`);
      if (tCb) tCb.checked = selectedJcrLevels[level];
    });
    ['gc'].forEach(role => {
      const tCb = document.getElementById(`tbl-chk-${role}`);
      if (tCb) tCb.checked = selectedRoles[role];
    });

    const visibleYears = new Set();
    cachedPubElems.forEach(pub => {
      const matchesJcr = selectedJcrLevels[pub.level];
      const matchesPeriod = isNaN(pub.year) || pub.year >= cutoffYear;

      let matchesRole = false;
      if (pub.isGc) {
        // GC papers are controlled independently by the GC checkbox
        matchesRole = selectedRoles.gc;
      } else {
        // Non-GC papers are controlled by the First, Last, and Others checkboxes
        if (pub.isFirst && selectedRoles.first) matchesRole = true;
        if (pub.isLast && selectedRoles.last) matchesRole = true;

        const isOther = !pub.isFirst && !pub.isLast;
        if (isOther && selectedRoles.others) matchesRole = true;
      }

      const isVisible = (matchesJcr && matchesPeriod && matchesRole);
      if (isVisible && !isNaN(pub.year)) {
        visibleYears.add(pub.year);
      }

      if (isReportHidden) {
        pub.el.style.display = ''; // Show everything if report is hidden
      } else {
        pub.el.style.display = isVisible ? '' : 'none';
      }
    });

    // Update year separators visibility
    document.querySelectorAll('.jcr-lattes-year-separator').forEach(sep => {
      const year = parseInt(sep.getAttribute('data-year'));
      sep.style.display = (!isReportHidden && visibleYears.has(year)) ? '' : 'none';
    });

    // Update graphs based on period filter ONLY if changed
    if (cutoffYear !== lastGraphCutoffYear) {
      lastGraphCutoffYear = cutoffYear;
      const histogramContainer = document.getElementById('histogram-container');
      const papersYearContainer = document.getElementById('papers-year-container');
      if (histogramContainer || papersYearContainer) {
        // Filter lattesInfo to only include the ones in the selected period
        const filteredLattesInfo = lattesInfo.filter(pub => isNaN(pub.year) || pub.year >= cutoffYear);
        if (histogramContainer) histogramContainer.innerHTML = window.JCRReportUtils.generateHistogramHTML(filteredLattesInfo, highJcr, lowJcr);
        if (papersYearContainer) papersYearContainer.innerHTML = window.JCRReportUtils.generatePapersPerYearGraphHTML(filteredLattesInfo, highJcr, lowJcr);
      }
    }

    const tbody = document.getElementById('tbody-publicacoes');
    if (tbody) {
      const previousState = tbody.getAttribute('data-table-filtered') === 'true';
      if (!isTableFiltered && !previousState) {
        // Table is already showing unfiltered data; do not recalculate or replace DOM to preserve UI and reduce ops
        return;
      }
      tbody.setAttribute('data-table-filtered', isTableFiltered ? 'true' : 'false');

      const cyInput = document.getElementById('custom-year-input');
      const currentCustomYears = cyInput ? cyInput.value : customYears;
      let tableStats = stats;

      if (isTableFiltered) {
        const filteredForStats = lattesInfo.filter(pub => {
          let category = 'noJcr';
          let ifVal = 0;
          const impactFactorStr = pub.impactFactor !== undefined ? pub.impactFactor : pub.jif;
          if (impactFactorStr !== null && impactFactorStr !== undefined && impactFactorStr !== '' && impactFactorStr !== 0) {
            ifVal = parseFloat(impactFactorStr);
            if (ifVal > 0) {
              if (ifVal >= highJcr) category = 'high';
              else if (ifVal >= lowJcr) category = 'mid';
              else category = 'low';
            }
          }

          let passesRole = false;
          if (pub.hasEtAl) {
            passesRole = selectedRoles.gc;
          } else {
            let isFirst = pub.isFirstAuthor !== undefined ? pub.isFirstAuthor : (pub.authorRank === 1);
            let isLast = pub.isLastAuthor !== undefined ? pub.isLastAuthor : (pub.authorRank === pub.authorCount && pub.authorCount > 1 && !pub.hasEtAl);
            if (isFirst && selectedRoles.first) passesRole = true;
            if (isLast && selectedRoles.last) passesRole = true;
            const isOther = !isFirst && !isLast;
            if (isOther && selectedRoles.others) passesRole = true;
          }

          let jcrLevelKey = category === 'noJcr' ? 'none' : category;
          let passesJcr = selectedJcrLevels[jcrLevelKey];

          return passesRole && passesJcr;
        });

        tableStats = window.JCRReportUtils.calculateReportStats(
            filteredForStats, stats.patents, stats.events, stats.supervisions, stats.declaredCitations,
            currentYear, currentCustomYears, startYearRecent, startYearLast10, startYearCustom, highJcr, lowJcr
        );
      }

      tbody.innerHTML = `
        ${window.JCRReportUtils.generateRow(`Total (${minYear} - ${maxYear})`, tableStats.all)}
        ${window.JCRReportUtils.generateRow(`5 anos (${startYearRecent} - ${maxYear})`, tableStats.recent)}
        ${window.JCRReportUtils.generateRow(`10 anos (${startYearLast10} - ${maxYear})`, tableStats.last10)}
        ${window.JCRReportUtils.generateRow(`<input type="number" id="custom-year-input" value="${currentCustomYears}" min="0" style="width: 40px; padding: 2px; text-align: center;"> ${currentCustomYears == 1 || currentCustomYears == 0 ? 'ano' : 'anos'} (${startYearCustom} - ${maxYear})`, tableStats.custom)}
      `;
      const newCyInput = document.getElementById('custom-year-input');
      if (newCyInput) {
        newCyInput.addEventListener('change', () => {
          saveSettings();
          processLattesPage(nameLink);
        });
      }
    }
  }

  // Add listeners for JCR checkboxes and color pickers
  ['high', 'mid', 'low', 'none'].forEach(level => {
    const cb = document.getElementById(`toggle-jcr-${level}`);
    if (cb) cb.addEventListener('change', () => {
      refreshPubFilters();
      saveSettings();
    });

    const colorPicker = document.getElementById(`color-jcr-${level}`);
    if (colorPicker) colorPicker.addEventListener('change', () => {
      saveSettings().then(() => {
        processLattesPage(nameLink);
      });
    });
  });

  // Add listeners for Period radios
  document.querySelectorAll('input[name="toggle-period"]').forEach(radio => {
    radio.addEventListener('change', () => {
      refreshPubFilters();
      saveSettings();
    });
  });

  // Add listeners for Author Role checkboxes
  ['first', 'last', 'others', 'gc'].forEach(role => {
    const cb = document.getElementById(`toggle-author-${role}`);
    if (cb) cb.addEventListener('change', () => {
      refreshPubFilters();
      saveSettings();
    });
  });

  // RID Extraction and Private Tools Hook
  const performRidExtractionAndInitPrivateTools = (isUnlocked) => {
      const injectRidTable = (ridStats) => {
          const citationContainer = document.getElementById('tbody-citacoes')?.closest('.rodape-cv');
          if (citationContainer) {
              const existing = document.getElementById('rid-stats-table');
              if (existing) existing.remove();
              
              const ridHtml = window.JCRReportUtils.generateRidTableHTML(ridStats, nameLink.researcherIdLink, isUnlocked);
              citationContainer.insertAdjacentHTML('afterend', ridHtml);
          }
      };

      if (nameLink.researcherIdLink) {
          if (window.cachedRidStats) {
              injectRidTable(window.cachedRidStats);
              if (typeof window.JCRDBTools !== 'undefined') {
                  window.JCRDBTools.init('jcr-db-tools-mount', nameLink, stats, lattesInfo, window.cachedRidStats);
              }
          } else if (!window.isFetchingRidStats) {
              window.isFetchingRidStats = true;
              
              // Safety timeout: If background doesn't respond in 45s, reset the flag
              const ridTimeout = setTimeout(() => {
                  if (window.isFetchingRidStats) {
                      console.warn("[RID Extraction Content Script] Safety timeout triggered.");
                      window.isFetchingRidStats = false;
                      hideLoading();
                  }
              }, 45000);

              console.log(`[RID Extraction Content Script] Sending 'fetch_rid_stats' to background for ${nameLink.researcherIdLink}`);
              chrome.runtime.sendMessage(
                  { action: 'fetch_rid_stats', url: nameLink.researcherIdLink },
                  (response) => {
                      clearTimeout(ridTimeout);
                      console.log(`[RID Extraction Content Script] Received response from background:`, response);
                      window.isFetchingRidStats = false;
                      if (response && response.success) {
                          window.cachedRidStats = response.stats;
                      } else {
                          console.warn(`[RID Extraction Content Script] Fetch failed or no success flat:`, response);
                          window.cachedRidStats = { _failed: true };
                      }
                      
                      // Explicitly try to hide loading now that RID is done
                      hideLoading();
                      
                      // Trigger a fresh re-parse of the DOM so that the final init call
                      // uses the latest JCR and Citation metrics that loaded in the background!
                      processLattesPage(nameLink);
                  }
              );
          } else {
              // Currently fetching in the background. Init JCRDBTools so UI is rendered.
              // It will be re-initialized when the fetch completes.
              if (typeof window.JCRDBTools !== 'undefined') {
                  window.JCRDBTools.init('jcr-db-tools-mount', nameLink, stats, lattesInfo, null);
              }
          }
      } else {
          if (typeof window.JCRDBTools !== 'undefined') {
              window.JCRDBTools.init('jcr-db-tools-mount', nameLink, stats, lattesInfo, null);
          }
      }
  };

  if (typeof window.JCRDBTools !== 'undefined') {
      window.JCRDBTools.loadSettings().then(() => {
          performRidExtractionAndInitPrivateTools(window.JCRDBTools.isUnlocked);
      });
  } else {
      performRidExtractionAndInitPrivateTools(false);
  }

  // Final check to hide loading if everything is done
  setTimeout(() => {
      const pendingJcr = document.querySelectorAll('.ajaxJCR:not([original-title])');
      if (pendingJcr.length === 0 && !window.isFetchingRidStats) {
          hideLoading();
      }
  }, 2000); // Give it a bit more time to stabilize
}

function getSections() {
  const sections = [];
  // Find all title-wrapper divs
  const titles = document.querySelectorAll('div.title-wrapper');

  titles.forEach((wrapper, index) => {
    // Extract name/ID
    const anchor = wrapper.querySelector('a[name]');
    const header = wrapper.querySelector('h1, h2, h3');
    const isResumo = !!wrapper.querySelector('p.resumo');

    if ((anchor && header) || isResumo) {
      const id = anchor ? anchor.getAttribute('name') : (isResumo ? 'resumo' : `section-${index}`);
      const label = header ? header.textContent.trim() : (isResumo ? 'Resumo' : '');
      const isProduction = label.toLowerCase().includes('produção') || label.toLowerCase().includes('produções');

      const sectionObj = {
        id: id,
        label: label,
        element: wrapper,
        footerElement: (wrapper.nextElementSibling && wrapper.nextElementSibling.tagName === 'BR' && wrapper.nextElementSibling.classList.contains('clear')) ? wrapper.nextElementSibling : null,
        subsections: []
      };

      // If it is a production section, look for subcategories
      if (isProduction) {
        // Look for .inst_back elements inside the wrapper's parent or next siblings?
        // Usually div.title-wrapper is followed by content.
        // Or content is inside?
        // Let's assume content follows the title-wrapper or is inside it? 
        // Based on snippet: <div class="title-wrapper"><a...><h1>...</h1></a>... <div class="layout-cell-12">...</div></div>
        // So content IS inside title-wrapper.

        const subHeaders = wrapper.querySelectorAll('.inst_back');
        subHeaders.forEach((sub, subIndex) => {
          const subLabel = sub.textContent.trim();
          // The content usually follows the inst_back div
          const contentSibling = sub.nextElementSibling;

          if (subLabel) {
            sectionObj.subsections.push({
              id: `${sectionObj.id}-sub-${subIndex}`,
              label: subLabel,
              headerElement: sub,
              contentElement: contentSibling
            });
          }
        });
      }

      sections.push(sectionObj);
    }
  });

  return sections;
}

function generateSectionToggles(identificationSections, otherSections) {
  let html = `
    <div class="rodape-cv" style="margin-top: 10px; color: ${COLORS.footerText}; font-size: 1.1em;">
      <table style="width: 100%; border-collapse: collapse; text-align: center; font-family: inherit; font-size: 0.9em;">
        <thead>
          <tr style="background-color: ${COLORS.backgroundHeader}; border-bottom: 1px solid ${COLORS.border};">
            <th style="padding: 8px; text-align: left;">
              <span class="toggle-table-btn" data-target="opcoes" style="cursor: pointer; user-select: none; margin-right: 5px;">${jcrTablesState.opcoes ? '[+]' : '[-]'}</span> Opções e Filtros
            </th>
          </tr>
        </thead>
        <tbody id="tbody-opcoes" style="display: ${jcrTablesState.opcoes ? 'none' : ''};">
          <tr>
            <td style="padding: 0; text-align: left;">
              <div style="padding: 10px; background-color: ${COLORS.backgroundSubHeader}; font-size: 0.9em; color: ${COLORS.footerText};">
                <div style="margin-bottom: 8px; font-weight: bold;">Mostrar/Ocultar Seções:</div>
                <div style="display: flex; flex-wrap: wrap; gap: 15px; align-items: center;">
  `;

  // Identification Group Checkbox
  if (identificationSections.length > 0) {
    html += `
      <label style="cursor: pointer; display: inline-flex; align-items: center; white-space: nowrap;">
        <input type="checkbox" id="toggle-group-identification" checked style="margin-right: 5px;">
        Dados gerais
      </label>
    `;
  }

  // Other Sections Checkboxes
  const otherCheckboxes = otherSections.map(section => `
    <label style="cursor: pointer; display: inline-flex; align-items: center; white-space: nowrap;">
      <input type="checkbox" id="toggle-section-${section.id}" checked style="margin-right: 5px;">
      ${section.label}
    </label>
  `).join('');

  html += otherCheckboxes;
  html += `</div>`;

  // Production Filters Row
  html += `
      <div style="margin-top: 15px; border-top: 1px solid ${COLORS.border}; padding-top: 10px; display: flex; gap: 30px; flex-wrap: wrap;">
        
        <!-- Column 1: Period -->
        <div style="flex: 1; min-width: 200px;">
          <div style="margin-bottom: 8px; font-weight: bold;">Mostrar/Ocultar Produções (por Período):</div>
          <div style="display: flex; flex-direction: column; gap: 5px;">
            <label style="cursor: pointer; display: inline-flex; align-items: center; white-space: nowrap;">
              <input type="radio" name="toggle-period" value="all" checked style="margin-right: 5px;">
              Todos
            </label>
            <label style="cursor: pointer; display: inline-flex; align-items: center; white-space: nowrap;">
              <input type="radio" name="toggle-period" value="recent" style="margin-right: 5px;">
              5 anos
            </label>
            <label style="cursor: pointer; display: inline-flex; align-items: center; white-space: nowrap;">
              <input type="radio" name="toggle-period" value="last10" style="margin-right: 5px;">
              10 anos
            </label>
            <label style="cursor: pointer; display: inline-flex; align-items: center; white-space: nowrap;">
              <input type="radio" name="toggle-period" value="custom" style="margin-right: 5px;">
              Customizado
            </label>
          </div>
        </div>

        <!-- Column 2: JCR -->
        <div style="flex: 1; min-width: 200px;">
          <div style="margin-bottom: 8px; font-weight: bold;">Mostrar/Ocultar Produções (por JCR):</div>
          <div style="display: flex; flex-direction: column; gap: 5px;">
            <div style="display: flex; align-items: center; justify-content: space-between; max-width: 170px;">
              <label style="cursor: pointer; display: inline-flex; align-items: center; white-space: nowrap;">
                <input type="checkbox" id="toggle-jcr-high" checked style="margin-right: 5px;">
                <span style="color: ${COLORS.highJcr}; font-weight: bold;">JCR Alto</span>
              </label>
              <input type="color" id="color-jcr-high" value="${COLORS.highJcr}" style="width: 24px; height: 24px; padding: 0; border: none; cursor: pointer; background: transparent;" title="Escolher cor para JCR Alto">
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; max-width: 170px;">
              <label style="cursor: pointer; display: inline-flex; align-items: center; white-space: nowrap;">
                <input type="checkbox" id="toggle-jcr-mid" checked style="margin-right: 5px;">
                <span style="color: ${COLORS.midJcr}; font-weight: bold;">JCR Médio</span>
              </label>
              <input type="color" id="color-jcr-mid" value="${COLORS.midJcr}" style="width: 24px; height: 24px; padding: 0; border: none; cursor: pointer; background: transparent;" title="Escolher cor para JCR Médio">
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; max-width: 170px;">
              <label style="cursor: pointer; display: inline-flex; align-items: center; white-space: nowrap;">
                <input type="checkbox" id="toggle-jcr-low" checked style="margin-right: 5px;">
                <span style="color: ${COLORS.lowJcr}; font-weight: bold;">JCR Baixo</span>
              </label>
              <input type="color" id="color-jcr-low" value="${COLORS.lowJcr}" style="width: 24px; height: 24px; padding: 0; border: none; cursor: pointer; background: transparent;" title="Escolher cor para JCR Baixo">
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; max-width: 170px;">
              <label style="cursor: pointer; display: inline-flex; align-items: center; white-space: nowrap;">
                <input type="checkbox" id="toggle-jcr-none" checked style="margin-right: 5px;">
                <span style="color: ${COLORS.noJcr}; font-weight: bold;">Não classificado</span>
              </label>
              <input type="color" id="color-jcr-none" value="${COLORS.noJcr}" style="width: 24px; height: 24px; padding: 0; border: none; cursor: pointer; background: transparent;" title="Escolher cor para Não classificado">
            </div>
          </div>
        </div>

        <!-- Column 3: Author -->
        <div style="flex: 1; min-width: 200px;">
          <div style="margin-bottom: 8px; font-weight: bold;">Mostrar/Ocultar Produções (por Autor):</div>
          <div style="display: flex; flex-direction: column; gap: 5px;">
            <label style="cursor: pointer; display: inline-flex; align-items: center; white-space: nowrap;">
              <input type="checkbox" id="toggle-author-first" checked style="margin-right: 5px;">
              1o Autor
            </label>
            <label style="cursor: pointer; display: inline-flex; align-items: center; white-space: nowrap;">
              <input type="checkbox" id="toggle-author-last" checked style="margin-right: 5px;">
              Último Autor
            </label>
            <label style="cursor: pointer; display: inline-flex; align-items: center; white-space: nowrap;">
              <input type="checkbox" id="toggle-author-others" checked style="margin-right: 5px;">
              Demais autores
            </label>
            <label style="cursor: pointer; display: inline-flex; align-items: center; white-space: nowrap;">
              <input type="checkbox" id="toggle-author-gc" checked style="margin-right: 5px;">
              GC (et al.)
            </label>
          </div>
        </div>

      </div>
  `;

  html += `
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  return html;
}



function extractSupervisions() {
  const supervisions = {
    inCourse: {},
    concluded: {},
    raw: []
  };

  const processSection = (anchorName, targetObj, extractYear = false) => {
    const anchor = document.querySelector(`a[name = '${anchorName}']`);
    if (!anchor) return;

    let sibling = anchor.nextElementSibling;

    // Sometimes the anchor is inside a span or similar wrapper, so we might need to go up
    // But usually in Lattes it's a direct child of the main container or preceded by the anchor.
    // The previous logic used anchor.parentElement which might be 'layout-cell-12'.
    // Let's stick to the previous reliable traversal logic but just be careful.
    // The previous logic was:
    // let currentElement = anchor.parentElement;
    // let sibling = anchor.nextElementSibling;

    // Actually, looking at the previous code: 
    // const anchor = document.querySelector...
    // let currentElement = anchor.parentElement; 
    // let sibling = anchor.nextElementSibling;

    // If anchor is just <a name="..."></a>, it might be inline.
    // Let's re-verify the previous logic I am replacing to ensure I don't break traversal.
    // Previous:
    // let currentElement = anchor.parentElement;
    // let sibling = anchor.nextElementSibling;
    // ...
    // Loop sibling

    let currentCategory = '';

    // Traverse siblings
    while (sibling) {
      if (sibling.classList && sibling.classList.contains('cita-artigos')) {
        currentCategory = sibling.textContent.trim();
      } else if (sibling.classList && sibling.classList.contains('layout-cell-11')) {
        // This is an item
        if (currentCategory) {
          const text = sibling.innerText;
          const cleanText = text.replace(/\s+/g, ' ').trim();
          const isCoorientador = text.includes('Coorientador') || text.includes('Co-orientador');

          let finalKey = currentCategory;
          if (isCoorientador) {
            finalKey = `${currentCategory} (Coorientador)`;
          }

          if (!targetObj[finalKey]) {
            targetObj[finalKey] = extractYear ? [] : 0;
          }

          let extractedYear = NaN;
          if (extractYear) {
            const matches = text.match(/\b(?:19|20)\d{2}\b/g);
            if (matches && matches.length > 0) {
              extractedYear = parseInt(matches[matches.length - 1]);
              targetObj[finalKey].push(extractedYear);
            } else {
              targetObj[finalKey].push(NaN);
            }
          } else {
            targetObj[finalKey]++;
          }

          supervisions.raw.push({
            category: finalKey,
            status: extractYear ? 'Concluída' : 'Em andamento',
            year: extractedYear,
            reference: cleanText
          });
        }
      } else if (sibling.tagName === 'A' && sibling.hasAttribute('name')) {
        const name = sibling.getAttribute('name');
        // Stop if we hit another major section
        if (name && (name === 'Orientacoesconcluidas' || name === 'Producaobibliografica' || name === 'Producaotecnica' || name === 'Outraproducao' || name === 'Dadoscomplementares')) {
          break;
        }
      } else if (sibling.querySelector && sibling.querySelector("div.title-wrapper")) {
        // Also stop if we hit a title wrapper (often starts a new block)
        break;
      }

      sibling = sibling.nextElementSibling;
    }
  };

  processSection('Orientacaoemandamento', supervisions.inCourse, false);
  processSection('Orientacoesconcluidas', supervisions.concluded, true);

  return supervisions;
}

function extractPatents() {
  const patents = [];

  // 1. Find the specific anchor "PatentesRegistros"
  const startAnchor = document.querySelector('a[name="PatentesRegistros"]');
  if (!startAnchor) return patents;

  // 2. Determine start node for sibling traversal
  let startNode = startAnchor;
  let sibling = startNode.nextElementSibling;

  while (sibling) {
    // 3. Stop condition: New major section (if needed, but relying on container check is safer for now)
    // For now, we just look for the specific container.

    // 4. Count items
    // Explicitly check for the container user mentioned: <div class="layout-cell layout-cell-12 data-cell">
    if (sibling.classList && sibling.classList.contains('layout-cell-12') && sibling.classList.contains('data-cell')) {
      const items = sibling.querySelectorAll('.layout-cell-11');

      items.forEach(item => {
        const text = item.innerText;

        // Find all "Status: Date" occurences
        // Regex to match "Status: dd/mm/yyyy"
        // Using unicode range for Portuguese characters
        const regex = /([A-Za-z\u00C0-\u00FF\s]+):\s*(\d{2}\/\d{2}\/\d{4})/g;

        let match;
        let stages = [];

        while ((match = regex.exec(text)) !== null) {
          let statusName = match[1].trim();
          if (statusName.toLowerCase() === 'data de registro') {
            continue;
          }
          const dateStr = match[2];
          const parts = dateStr.split('/');
          // Date(year, monthIndex, day)
          const dateObj = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));

          stages.push({
            status: statusName,
            date: dateObj,
            year: parseInt(parts[2])
          });
        }

        if (stages.length > 0) {
          // Sort by date descending (newest first)
          stages.sort((a, b) => b.date - a.date);

          const newest = stages[0];

          let registro = '';
          const regMatch = text.match(/N[úu]mero do registro:\s*([^,]+)/i);
          if (regMatch) {
            registro = regMatch[1].trim();
          }

          patents.push({
            currentStatus: newest.status,
            year: newest.year,
            allStages: stages,
            registro: registro,
            reference: text.replace(/\s+/g, ' ').trim()
          });
        }
      });
    }

    sibling = sibling.nextElementSibling;
  }

  return patents;
}

function extractEvents() {
  const events = [];

  const startAnchor = document.querySelector('a[name="Eventos"]');
  if (!startAnchor) return events;

  let sibling = startAnchor.nextElementSibling;

  while (sibling) {
    if (sibling.classList && sibling.classList.contains('layout-cell-12') && sibling.classList.contains('data-cell')) {
      const items = sibling.querySelectorAll('.layout-cell-11');
      items.forEach(item => {
        const text = item.innerText;

        // Year
        const yearMatch = text.match(/\b(19|20)\d{2}\b\. \(/);
        let year = NaN;
        if (yearMatch) {
          year = parseInt(yearMatch[0]);
        }

        // Type
        const typeMatch = text.match(/Tipo de participação:\s*([^\n]+)/);
        let participationType = 'Desconhecido';
        if (typeMatch) {
          let pt = typeMatch[1].replace(/<[^>]*>/g, '').trim();
          pt = pt.split(/(?:forma de particip|homepage)/i)[0];
          participationType = pt.replace(/[.;\s]+$/, '').trim();
        }

        if (!isNaN(year) && participationType !== 'Desconhecido') {
          events.push({ year, type: participationType, reference: text.replace(/\s+/g, ' ').trim() });
        }
      });
    }

    if (sibling.tagName === 'A' && sibling.hasAttribute('name')) {
      const name = sibling.getAttribute('name');
      if (name === 'Producaobibliografica' || name === 'Producaotecnica' || name === 'Outraproducao' || name === 'Dadoscomplementares') {
        break;
      }
    } else if (sibling.querySelector && sibling.querySelector("div.title-wrapper")) {
      break;
    }

    sibling = sibling.nextElementSibling;
  }

  return events;
}



function setAttributes(elem, attrs) {
  for (const key of Object.keys(attrs)) {
    elem.setAttribute(key, attrs[key]);
  }
}

function getAuthorNames() {
  const candidates = [];

  // Method 1: Tables (Legacy)
  const tds = document.querySelectorAll('td.campos');
  for (const td of tds) {
    // Check for "Nome em citações bibliográficas" or "Nome em cita" to be safe
    if (td.innerText.includes('Nome em cita')) {
      const nextTd = td.nextElementSibling;
      if (nextTd && nextTd.classList.contains('texto')) {
        candidates.push(nextTd.innerText);
      }
    }
  }

  // Method 2: Div Layout (New)
  if (candidates.length === 0) {
    const labels = document.querySelectorAll('.layout-cell-pad-5');
    for (const labelDiv of labels) {
      if (labelDiv.innerText.includes('Nome em cita')) {
        const parent = labelDiv.parentElement;
        if (parent && parent.classList.contains('layout-cell-3')) {
          const nextSibling = parent.nextElementSibling;
          if (nextSibling && (nextSibling.classList.contains('layout-cell-9') || nextSibling.classList.contains('layout-cell-8'))) { // sometimes 8? sticking to 9 as per snippet, but being safe
            candidates.push(nextSibling.innerText);
          }
        }
      }
    }
  }

  if (candidates.length > 0) {
    const rawText = candidates[0];
    const names = rawText.split(';').map(n => n.trim()).filter(n => n.length > 0);
    return names;
  }

  console.log('No author names found.');
  return [];
}

function showLoading() {
  let loader = document.getElementById('jcr-lattes-loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'jcr-lattes-loader';
    loader.innerHTML = `<div class="spinner"></div> <span style="margin-left: 8px; font-weight: bold; color: ${COLORS.authorCount};">Atualizando dados...</span>`;
    // Add styles
    loader.style.cssText = `position: fixed; top: 10px; left: 10px; z-index: 9999; background: rgba(255, 255, 255, 0.9); padding: 5px 10px; border-radius: 5px; box-shadow: 0 0 5px rgba(0, 0, 0, 0.1); display: flex; align-items: center; border: 1px solid ${COLORS.border};`;

    const style = document.createElement('style');
    style.innerHTML = `
  .spinner {
  border: 4px solid ${COLORS.spinnerBorder};
  border-top: 4px solid ${COLORS.spinnerAccent};
  border-radius: 50%;
  width: 20px;
  height: 20px;
  animation: spin 1s linear infinite;
}
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
`;
    document.head.appendChild(style);
    document.body.appendChild(loader);
  }
  loader.style.display = 'flex';
}

function hideLoading(force = false) {
  const loader = document.getElementById('jcr-lattes-loader');
  if (!loader) return;

  // Check if anything is still pending before hiding
  const pendingJcr = document.querySelectorAll('.ajaxJCR:not([original-title])');
  const isJcrPending = pendingJcr.length > 0;
  const isRidPending = !!window.isFetchingRidStats;

  if (force || (!isJcrPending && !isRidPending)) {
    // Use a small timeout to avoid flashing
    setTimeout(() => {
      // Re-check just in case something started in the meantime
      const stillPendingJcr = document.querySelectorAll('.ajaxJCR:not([original-title])');
      if (force || (stillPendingJcr.length === 0 && !window.isFetchingRidStats)) {
        loader.style.display = 'none';
      }
    }, 800);
  }
}

function identifySections() {
  console.log('JCR Lattes: Identifying sections...');
  try {
    if (typeof SECTIONS === 'undefined' || !SECTIONS) {
      console.warn('[JCR Lattes] SECTIONS is not defined.');
      return;
    }

    for (const [key, config] of Object.entries(SECTIONS)) {
      if (!config || typeof config.selector !== 'string' || !config.selector) {
        continue;
      }

      try {
        const element = document.querySelector(config.selector);
        if (element) {
          console.log(`[JCR Lattes] Found section: ${key} `, element);
        }
      } catch (innerError) {
        console.error(`[JCR Lattes] Error selecting section "${key}" with selector "${config.selector}":`, innerError);
      }
    }
  } catch (outerError) {
    console.error('[JCR Lattes] Unexpected error in identifySections:', outerError);
  }
}

function extractDeclaredCitations() {
  const declared = {
    wosCitations: '',
    wosHIndex: '',
    scopusCitations: '',
    scopusHIndex: ''
  };
  
  document.querySelectorAll('.science_cont').forEach(cont => {
    const titleElem = cont.querySelector('.web_s');
    if (!titleElem) return;
    const title = titleElem.textContent.toUpperCase();
    
    let citations = '';
    const citaElem = cont.querySelector('.cita');
    if (citaElem) {
      const match = citaElem.textContent.match(/\d+/);
      if (match) citations = match[0];
    }
    
    let hIndex = '';
    const fatorElem = cont.querySelector('.fator');
    if (fatorElem) {
      const match = fatorElem.textContent.match(/\d+/);
      if (match) hIndex = match[0];
    } else {
      const detalhesElem = cont.querySelector('.detalhes');
      if (detalhesElem) {
        const match = detalhesElem.textContent.match(/H-INDEX:\s*(\d+)/i);
        if (match) hIndex = match[1];
      }
    }
    
    if (title.includes('WEB OF SCIENCE')) {
      declared.wosCitations = citations;
      declared.wosHIndex = hIndex;
    } else if (title.includes('SCOPUS')) {
      declared.scopusCitations = citations;
      declared.scopusHIndex = hIndex;
    }
  });
  
  return declared;
}
