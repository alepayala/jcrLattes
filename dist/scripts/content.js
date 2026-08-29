// Private metrics have been moved to private_tools.js
let COLORS = window.JCRReportUtils.COLORS;
let GRAPH_COLORS = window.JCRReportUtils.GRAPH_COLORS;


let observer;
const observerConfig = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['original-title', 'cvuri']
};

const SETTINGS_KEY = 'jcr_lattes_settings';
let jcrTablesState = { publicacoes: false, citacoes: false, orientacoes: false, patentes: false, eventos: false, opcoes: false, graficos: false };
// Secoes do CV recolhidas pelo usuario (clique no titulo). Chave = id da ancora da secao,
// que e estavel entre curriculos, entao o estado vale para os proximos CVs abertos.
let jcrSectionsCollapsed = {};

async function saveSettings() {
  const rankInputVal = parseInt(document.getElementById('target-author-rank-input')?.value);
  const settings = {
    highJcr: parseFloat(document.getElementById('high-jcr-input')?.value) || 7,
    lowJcr: parseFloat(document.getElementById('low-jcr-input')?.value) || 1.5,
    customYears: parseInt(document.getElementById('custom-year-input')?.value) || 1,
    targetAuthorRank: !isNaN(rankInputVal) ? rankInputVal : 1,
    colors: {
      high: document.getElementById('color-jcr-high')?.value || COLORS.highJcr,
      mid: document.getElementById('color-jcr-mid')?.value || COLORS.midJcr,
      low: document.getElementById('color-jcr-low')?.value || COLORS.lowJcr,
      none: document.getElementById('color-jcr-none')?.value || COLORS.noJcr
    },
    toggles: {
      disableReport: document.getElementById('toggle-disable-report')?.checked ?? false,
      disableExtraInfo: document.getElementById('toggle-disable-extra-info')?.checked ?? false,
      tables: jcrTablesState,
      sectionsCollapsed: { ...jcrSectionsCollapsed },
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

  // Debounced processor
  const processDebounced = debounce(() => {
    processLattesPage(nameLink);
  }, 1000);

  // Initialize observer
  observer = new MutationObserver((mutations) => {
    // Only trigger if mutation is relevant (child list changes or JCR/CVURI attributes)
    const isRelevant = mutations.some(m => {
      if (m.target && m.target.closest && m.target.closest('.jcr-lattes-year-separator')) return false;
      return m.type === 'childList' ||
      (m.type === 'attributes' && (
        m.target.classList.contains('ajaxJCR') ||
        m.target.hasAttribute('cvuri') ||
        m.target.classList.contains('artigo-completo')
      ));
    });

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

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

  // Extract Fellowship (Bolsa) Information from top header badge
  let fellowshipText = '';
  let fellowshipString = '';
  
  // Look exclusively at the second h2.nome or div.nome at the top header of the CV
  const allNames = document.querySelectorAll("h2[class='nome'], div[class='nome']");
  if (allNames.length > 1) {
    const secondElem = allNames[1];
    fellowshipText = secondElem.textContent.trim();
  }

  if (fellowshipText) {
    let acronim = "";
    if (fellowshipText.includes("Produtividade em Pesquisa")) {
      acronim = "PQ";
    } else if (fellowshipText.includes("Produtividade em Desenvolvimento Tecnológico") || fellowshipText.includes("Desen. Tec.")) {
      acronim = "DT";
    }

    if (acronim) {
      // Level matching: 1A, 1B, 1C, 1D, 2, A, B, C, SR
      let level = "";
      const nivelExplicitMatch = fellowshipText.match(/N[íi]vel\s*[:-]?\s*(1A|1B|1C|1D|1|2|3|A|B|C|SR)\b/i);
      if (nivelExplicitMatch) {
        level = nivelExplicitMatch[1].toUpperCase();
      } else {
        const levelMatch = fellowshipText.match(/\b(1A|1B|1C|1D|1|2|3|A|B|C|SR)\b/i);
        level = levelMatch ? levelMatch[1].toUpperCase() : "";
      }
      fellowshipString = level ? `${acronim} ${level}` : acronim;
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

  if (saved?.toggles?.sectionsCollapsed) {
    jcrSectionsCollapsed = { ...saved.toggles.sectionsCollapsed };
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

  // Ignora valores não numéricos (ex.: campo apagado pelo usuário)
  if (highInput && !isNaN(parseFloat(highInput.value))) highJcr = parseFloat(highInput.value);
  if (lowInput && !isNaN(parseFloat(lowInput.value))) lowJcr = parseFloat(lowInput.value);

  // Custom year span
  let customYears = saved?.customYears ?? 1;
  const customInput = document.getElementById('custom-year-input');
  if (customInput && !isNaN(parseInt(customInput.value))) customYears = parseInt(customInput.value);

  // Target author rank
  let targetAuthorRank = saved?.targetAuthorRank ?? 1;
  const rankInput = document.getElementById('target-author-rank-input');
  if (rankInput && !isNaN(parseInt(rankInput.value))) targetAuthorRank = parseInt(rankInput.value);

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
          currentYear, customYears, startYearRecent, startYearLast10, startYearCustom, highJcr, lowJcr, targetAuthorRank
        );
        const minYear = finalStats.minYear;
        const maxYear = finalStats.maxYear;

        await injectReportTable(finalStats, startYearRecent, startYearLast10, startYearCustom, customYears, currentYear, highJcr, lowJcr, nameLink, minYear, maxYear, lattesInfo, targetAuthorRank);
        await checkAndUpdateProponenteLattesId(nameLink, finalStats, supervisions, patents, lattesInfo);
      } else {
        await checkAndUpdateProponenteLattesId(nameLink, null, supervisions, patents, []);
      }
    } finally {
      hideLoading();
    }
  });
}

async function checkAndUpdateProponenteLattesId(nameLink, finalStats = null, supervisions = null, patents = null, lattesInfo = []) {
  if (!nameLink || !nameLink.name || !window.JCRDBTools) return;

  const targetName = nameLink.name.trim();
  const lattesId = (nameLink.link || '').match(/\b\d{16}\b/)?.[0] || '';
  const cvBolsa = (nameLink.fellowshipString || '').replace('-', ' ').trim();
  if (!targetName) return;

  try {
    const db = (await window.JCRDBTools.getDB(true)) || [];

    let piccCvData = null;
    if (window.JCRDBTools.currentCvData && window.JCRDBTools.currentCvData.name) {
      piccCvData = Object.assign({}, window.JCRDBTools.currentCvData);
    } else if (finalStats && lattesInfo && typeof window.JCRDBTools.extractData === 'function') {
      window.JCRDBTools.extractData(nameLink, finalStats, lattesInfo, null);
      if (window.JCRDBTools.currentCvData) {
        piccCvData = Object.assign({}, window.JCRDBTools.currentCvData);
      }
    }

    if (!piccCvData) {
      piccCvData = {
        name: targetName,
        lattesId: lattesId,
        cvLink: nameLink.link || (lattesId ? `http://lattes.cnpq.br/${lattesId}` : ''),
        fellowshipString: cvBolsa || (nameLink.fellowshipString || ''),
        totalPapers: finalStats ? (finalStats.totalPapers || 0) : 0,
        papersWithJcr: finalStats ? (finalStats.papersWithJcr || 0) : 0,
        highJcrCount: finalStats ? (finalStats.highJcrCount || 0) : 0,
        lowJcrCount: finalStats ? (finalStats.lowJcrCount || 0) : 0,
        firstAuthorCount: finalStats ? (finalStats.firstAuthorCount || 0) : 0,
        lastAuthorCount: finalStats ? (finalStats.lastAuthorCount || 0) : 0,
        gcCount: finalStats ? (finalStats.gcCount || 0) : 0,
        totalPhdOrientations: supervisions ? (supervisions.phdCount || 0) : 0,
        totalMscOrientations: supervisions ? (supervisions.mscCount || 0) : 0,
        totalPatents: patents ? (patents.totalCount || 0) : 0,
        wosHIndex: finalStats ? (finalStats.wosHIndex || 0) : 0,
        wosCitations: finalStats ? (finalStats.wosCitations || 0) : 0,
        dateAdded: new Date().toISOString(),
        publications: [],
        rawPatents: [],
        rawEvents: [],
        supervisions: {}
      };
    }

    if (cvBolsa) piccCvData.fellowshipString = cvBolsa;
    if (lattesId && !piccCvData.lattesId) piccCvData.lattesId = lattesId;
    if (nameLink.link) piccCvData.cvLink = nameLink.link;
    piccCvData.hasFullCv = true;

    // Check if matching proposal entry has a frozen cvCongelado URL
    let frozenUrl = '';
    db.forEach(entry => {
      if (entry.proponente && entry.proponente.name && window.JCRDBTools.cvMatches(piccCvData, entry.proponente.name, entry.proponente.lattesId)) {
        if (entry.proponente.cvCongelado) frozenUrl = entry.proponente.cvCongelado;
        else if (entry.proponente.cvLink && !entry.proponente.cvLink.includes('lattes.cnpq.br')) frozenUrl = entry.proponente.cvLink;
      }
      if (Array.isArray(entry.teamMembers)) {
        entry.teamMembers.forEach(tm => {
          if (tm && tm.name && window.JCRDBTools.cvMatches(piccCvData, tm.name, tm.lattesId)) {
            if (tm.cvCongelado) frozenUrl = tm.cvCongelado;
            else if (tm.cvLink && !tm.cvLink.includes('lattes.cnpq.br')) frozenUrl = tm.cvLink;
          }
        });
      }
    });
    if (frozenUrl) {
      piccCvData.cvCongelado = frozenUrl;
    }

    // ALWAYS save full CV object to dedicated piccTools CV DB (jcr_picc_cv:) and general DB (jcr_cv:)
    if (window.JCRDBTools.savePiccCV) {
      await window.JCRDBTools.savePiccCV(piccCvData);
    }
    if (window.JCRDBTools.saveCurrentCv) {
      await window.JCRDBTools.saveCurrentCv(true);
    }

    // Update matching proposal entries with Lattes ID and Fellowship string
    let updatedEntries = [];
    db.forEach(entry => {
      if (entry.isProcesso || entry.processId) {
        let modified = false;

        // 1. Proponente match
        if (entry.proponente && entry.proponente.name) {
          if (window.JCRDBTools.cvMatches({ name: targetName, lattesId }, entry.proponente.name, entry.proponente.lattesId)) {
            if (lattesId && (!entry.proponente.lattesId || entry.proponente.lattesId !== lattesId)) {
              entry.proponente.lattesId = lattesId;
              if (!entry.lattesId) entry.lattesId = lattesId;
              modified = true;
            }
            if (cvBolsa && entry.proponente.bolsa !== cvBolsa) {
              entry.proponente.bolsa = cvBolsa;
              modified = true;
            }
          }
        }

        // 2. Team Members match
        if (Array.isArray(entry.teamMembers)) {
          entry.teamMembers.forEach(member => {
            if (member && member.name) {
              if (window.JCRDBTools.cvMatches({ name: targetName, lattesId }, member.name, member.lattesId)) {
                if (lattesId && (!member.lattesId || member.lattesId !== lattesId)) {
                  member.lattesId = lattesId;
                  modified = true;
                }
                if (cvBolsa && member.bolsa !== cvBolsa) {
                  member.bolsa = cvBolsa;
                  modified = true;
                }
              }
            }
          });
        }

        if (modified) updatedEntries.push(entry);
      }
    });

    if (updatedEntries.length > 0) {
      await window.JCRDBTools.saveCVs(updatedEntries);
      console.log(`[JCRLattes] Processos do piccTools atualizados no Banco de Dados para: ${targetName}`);
    }

    console.log(`[JCRLattes] CV completo de ${targetName} salvo com sucesso na base de CVs do piccTools!`, piccCvData);
  } catch (e) {
    console.warn('[JCRLattes] Erro ao atualizar CV do piccTools na DB:', e);
  }
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

  // Save existing year separators states before removing
  window.jcrCollapsedYears = window.jcrCollapsedYears || {};
  document.querySelectorAll('.jcr-lattes-year-separator').forEach(el => {
    const y = el.getAttribute('data-year');
    if (y) window.jcrCollapsedYears[y] = el.getAttribute('data-collapsed') === 'true';
    el.remove();
  });
  let lastYear = null;

  const disableExtraInfoCb = document.getElementById('toggle-disable-extra-info');
  const isExtraInfoHidden = disableExtraInfoCb && disableExtraInfoCb.checked;

  const pubInfoList = [];

  for (const pubElem of pubElems) {
    // Reset visibility to match default checked state of toggles
    pubElem.style.display = '';

    const pubInfo = {
      year: NaN,
      issn: '',
      journalName: '',
      paperTitle: '',
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

    // Insert year separator if year changed and extra info is not hidden
    if (!isExtraInfoHidden && !isNaN(pubInfo.year)) {
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

    // Pre-extract paper title and journal name from cvuri for reliable author-boundary detection
    const pubElemLastItem = pubElem.querySelector('[cvuri]');
    let titleFromCvuri = '';
    if (pubElemLastItem) {
      const cvuriStr = decodeHtmlEntities(pubElemLastItem.getAttribute('cvuri'));
      const tituloMatch = cvuriStr.match(/[?&]titulo=([^&]+)/);
      if (tituloMatch) titleFromCvuri = tituloMatch[1].trim();
      const periMatch = cvuriStr.match(/[?&]nomePeriodico=([^&]+)/);
      if (periMatch) pubInfo.journalName = periMatch[1].trim();
    }
    pubInfo.paperTitle = titleFromCvuri;

    // Calculate author count: truncate at paper title to exclude title/journal text from the split
    const rawText = pubElem.innerText.replace(/\s+/g, ' ').trim();
    let authorText = rawText;
    if (titleFromCvuri) {
      const titleIdx = rawText.indexOf(titleFromCvuri);
      if (titleIdx !== -1) {
        authorText = rawText.substring(0, titleIdx).replace(/\s*\.\s*$/, '').trim();
      }
    }

    const parts = authorText.split(';');
    const pubAuthors = [];
    let authorCount = 0;

    for (const part of parts) {
      let p = part.replace(/^\d+\s*\.\s*/, '').trim();
      if (!p) continue;
      if (p.startsWith('et.al') || p.toUpperCase().includes('COLLABORATION')) continue;
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
      const jcrTitle = jcrElem.getAttribute('original-title') || '';
      if (jcrTitle) {
        // Fallback journal name from original-title when cvuri nomePeriodico is absent.
        // Format: "Journal Name (ISSN)<br />Fator de impacto..." or "Journal Name - Fator de Impacto..."
        if (!pubInfo.journalName) {
          const journalPart = jcrTitle.split(/<br/i)[0]
            .split(/ - Fator de [Ii]mpacto/)[0]
            .replace(/\s*\([0-9X\-]{4,}\)\s*$/, '')
            .trim();
          if (journalPart) pubInfo.journalName = journalPart;
        }

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
    pubElem.setAttribute('data-author-rank', pubInfo.authorRank);

    if (pubElemLastItem) {
      const pubInfoString = decodeHtmlEntities(pubElemLastItem.getAttribute('cvuri'));
      const pubInfoItems = pubInfoString.split(/\?(?!&)|&(?=\w+)/);

      for (const pubInfoItem of pubInfoItems) {
        if (pubInfoItem.includes('issn=')) {
          const issnStr = pubInfoItem.split('issn=')[1];
          if (issnStr && issnStr.length >= 8)
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

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
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
  const isPreviouslyCollapsed = window.jcrCollapsedYears && window.jcrCollapsedYears[year] === true;
  const separator = document.createElement('div');
  setAttributes(separator, {
    class: 'jcr-lattes-year-separator',
    'data-year': year,
    'data-collapsed': isPreviouslyCollapsed ? 'true' : 'false',
    style: 'margin-top: 25px; margin-bottom: 15px; clear: both; cursor: pointer;'
  });

  separator.innerHTML = `
    <div class="jcr-year-sep-inner" style="
      padding: 8px 15px;
      background: linear-gradient(to right, #f8f9fa, #ffffff);
      border-left: 5px solid ${COLORS.midJcr};
      border-bottom: 1px solid #eee;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-radius: 4px;
      transition: background 0.2s;
    ">
      <span style="font-size: 1.4em; font-weight: bold; color: #333; font-family: inherit;">${year}</span>
      <div style="display: flex; align-items: center;">
        <span style="font-size: 0.85em; color: #777; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; margin-right: 8px;">Publicações de ${year}</span>
        <span class="jcr-collapse-icon" style="display: inline-block; width: 20px; font-size: 1.1em; font-weight: bold; color: ${COLORS.midJcr}; text-align: center;">${isPreviouslyCollapsed ? '[+]' : '[-]'}</span>
      </div>
    </div>
  `;

  const innerDiv = separator.querySelector('.jcr-year-sep-inner');
  if (innerDiv) {
    innerDiv.addEventListener('mouseover', () => { innerDiv.style.background = 'linear-gradient(to right, #eef1f4, #ffffff)'; });
    innerDiv.addEventListener('mouseout',  () => { innerDiv.style.background = 'linear-gradient(to right, #f8f9fa, #ffffff)'; });
  }

  separator.addEventListener('click', function() {
    const isCollapsed = separator.getAttribute('data-collapsed') === 'true';
    const newState = !isCollapsed;
    separator.setAttribute('data-collapsed', newState);
    
    const iconSpan = separator.querySelector('.jcr-collapse-icon');
    if (iconSpan) {
        iconSpan.innerText = newState ? '[+]' : '[-]';
    }

    let nextNode = separator.nextElementSibling;
    while(nextNode && !nextNode.classList.contains('jcr-lattes-year-separator') && nextNode.tagName !== 'H1' && nextNode.tagName !== 'H2' && !nextNode.classList.contains('layout-cell-pad-5')) {
        // Toggle visibility
        if (newState) {
            // collapsing
            if (nextNode.style.display !== 'none') {
                nextNode.setAttribute('data-original-display', nextNode.style.display);
            }
            nextNode.style.display = 'none';
        } else {
            // expanding
            nextNode.style.display = nextNode.getAttribute('data-original-display') || '';
        }
        nextNode = nextNode.nextElementSibling;
    }
  });

  pubElem.parentNode.insertBefore(separator, pubElem);
}



async function injectReportTable(stats, startYearRecent, startYearLast10, startYearCustom, customYears, currentYear, highJcr, lowJcr, nameLink, minYear, maxYear, lattesInfo, targetAuthorRank = 1) {
  // get main content div (absent na versão impressa do CV)
  const mainContentDiv = document.getElementsByClassName('main-content')[0];
  if (!mainContentDiv) {
    console.log('JCR Lattes: div .main-content não encontrada. Relatório não será injetado.');
    return;
  }

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
            
            <th id="th-author-rank-header" style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgTotal};" title="Quantidade de artigos como ${targetAuthorRank}º Autor">${targetAuthorRank}o</th>
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
          ${window.JCRReportUtils.generateRow(`10 anos (${startYearLast10} - ${maxYear})`, stats.last10)}
          ${window.JCRReportUtils.generateRow(`5 anos (${startYearRecent} - ${maxYear})`, stats.recent)}
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
             <td style="padding: 8px; text-align: left;">10 anos (${startYearLast10} - ${maxYear})</td>
             <td style="padding: 8px; text-align: center;">${stats.last10.citations.wos.sum}</td>
             <td style="padding: 8px; text-align: center;">${stats.last10.citations.wos.hIndex}</td>
             <td style="padding: 8px; text-align: center;">${stats.last10.citations.scopus.sum}</td>
             <td style="padding: 8px; text-align: center;">${stats.last10.citations.scopus.hIndex}</td>
          </tr>
          <tr style="border-bottom: 1px solid #ddd;">
             <td style="padding: 8px; text-align: left;">5 anos (${startYearRecent} - ${maxYear})</td>
             <td style="padding: 8px; text-align: center;">${stats.recent.citations.wos.sum}</td>
             <td style="padding: 8px; text-align: center;">${stats.recent.citations.wos.hIndex}</td>
             <td style="padding: 8px; text-align: center;">${stats.recent.citations.scopus.sum}</td>
             <td style="padding: 8px; text-align: center;">${stats.recent.citations.scopus.hIndex}</td>
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
                    <td style="padding: 8px; text-align: left;">${escHtml(type)}</td>
                    <td style="padding: 8px; text-align: center;">${inCourseCount}</td>
                    <td style="padding: 8px; text-align: center;"><strong>${concludedCount}</strong></td>
                    <td style="padding: 8px; text-align: center;">${count10}</td>
                    <td style="padding: 8px; text-align: center;">${count5}</td>
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
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.orientacoes ? 'none' : ''}; padding: 8px; text-align: center;" title="Orientações concluídas nos últimos 10 anos">10 Anos</th>
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.orientacoes ? 'none' : ''}; padding: 8px; text-align: center;" title="Orientações concluídas nos últimos 5 anos">5 Anos</th>
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
          <td style="padding: 8px; text-align: left;">${escHtml(status)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.all, status)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.last10, status)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.recent, status)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.custom, status)}</td>
        </tr>
      `;
    });

    // Total Row
    rowsHtml += `
      <tr style="border-bottom: 1px solid #ddd; background-color: ${COLORS.backgroundSubHeader}; font-weight: bold;">
        <td style="padding: 8px; text-align: left;">Total</td>
        <td style="padding: 8px; text-align: center;">${stats.all.patents.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.last10.patents.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.recent.patents.total}</td>
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
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.patentes ? 'none' : ''}; padding: 8px; text-align: center;" title="Patentes registradas nos últimos 10 anos">10 Anos (${startYearLast10} - ${maxYear})</th>
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.patentes ? 'none' : ''}; padding: 8px; text-align: center;" title="Patentes registradas nos últimos 5 anos">5 Anos (${startYearRecent} - ${maxYear})</th>
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
          <td style="padding: 8px; text-align: left;">${escHtml(type)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.all, type)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.last10, type)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.recent, type)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.custom, type)}</td>
        </tr>
      `;
    });

    rowsHtml += `
      <tr style="border-bottom: 1px solid #ddd; background-color: ${COLORS.backgroundSubHeader}; font-weight: bold;">
        <td style="padding: 8px; text-align: left;">Total</td>
        <td style="padding: 8px; text-align: center;">${stats.all.events.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.last10.events.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.recent.events.total}</td>
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
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.eventos ? 'none' : ''}; padding: 8px; text-align: center;" title="Participações em eventos nos últimos 10 anos">10 Anos (${startYearLast10} - ${maxYear})</th>
                    <th class="jcr-main-header-extra" style="display: ${jcrTablesState.eventos ? 'none' : ''}; padding: 8px; text-align: center;" title="Participações em eventos nos últimos 5 anos">5 Anos (${startYearRecent} - ${maxYear})</th>
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
    <style>
      .jcr-icon-toggle, .jcr-icon-btn {
        cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
        width: 30px; height: 30px; border: 1px solid #ccc; border-radius: 6px;
        background: #fff; font-size: 16px; padding: 0; transition: background 0.2s;
      }
      .jcr-icon-toggle:hover, .jcr-icon-btn:hover { background: #eef1f4; }
      .jcr-icon-toggle input { display: none; }
      /* Marcado = recurso oculto: ícone esmaecido (estado "off") */
      .jcr-icon-toggle input:checked ~ .jcr-icon-face { filter: grayscale(1); opacity: 0.35; }
    </style>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; padding: 10px; background-color: ${COLORS.backgroundHeader}; border-bottom: 2px solid ${COLORS.border}; border-radius: 4px;">
      <h2 style="margin: 0; font-size: 1.25em; color: ${COLORS.footerText}; font-weight: bold;">JCR Lattes Report <span id="jcr-report-name" style="color: #326C99; font-weight: 900; margin-left: 5px;">- ${escHtml(nameLink.name)}</span></h2>
      <div style="display: flex; gap: 8px; align-items: center;">
        <span id="jcr-db-tools-mount" style="display: inline-flex; gap: 8px; margin-right: 10px;"></span>
        <label class="jcr-icon-toggle" title="Mostrar/Ocultar Tabelas e Gráficos do relatório">
          <input type="checkbox" id="toggle-disable-report">
          <span class="jcr-icon-face">📈</span>
        </label>
        <label class="jcr-icon-toggle" title="Mostrar/Ocultar Anotações Adicionais (fator de impacto, autoria, separadores de ano)">
          <input type="checkbox" id="toggle-disable-extra-info">
          <span class="jcr-icon-face">🏷️</span>
        </label>
        <button id="btn-view-cv-report" class="jcr-icon-btn" title="Abrir relatório individual deste CV">📊</button>
      </div>
    </div>
  `;

  // Preserva os botões do banco de dados já renderizados: o innerHTML abaixo
  // apaga o mount, e o re-render dos botões é assíncrono (loadSettings/RID).
  // Sem isso, os ícones somem/reaparecem a cada reprocessamento e a página "treme".
  const prevDbMount = document.getElementById('jcr-db-tools-mount');

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

  if (prevDbMount && prevDbMount.childNodes.length > 0) {
    const newMount = alertDiv.querySelector('#jcr-db-tools-mount');
    if (newMount) newMount.replaceWith(prevDbMount);
  }

  const reportContent = alertDiv.querySelector('#jcr-report-content');

  // --- Section Toggles ---
  const sections = getSections();
  sections.forEach(s => {
    s.element.style.display = '';
    if (s.footerElement) s.footerElement.style.display = '';
  });

  // Titulos das secoes viram controles de recolher/expandir (substituem os checkboxes)
  setupCollapsibleSections(sections);

  const togglesHTML = generateSectionToggles(targetAuthorRank);

  // Append toggles to the reportContent
  const toggleContainer = document.createElement('div');
  toggleContainer.style.display = 'flex';
  toggleContainer.style.flexDirection = 'column';
  toggleContainer.style.gap = '10px';

  const histogramHTML = window.JCRReportUtils.generateHistogramHTML(lattesInfo, highJcr, lowJcr);
  const papersPerYearHTML = window.JCRReportUtils.generatePapersPerYearGraphHTML(lattesInfo, highJcr, lowJcr);
  const authorRankHistogramHTML = window.JCRReportUtils.generateAuthorRankHistogramHTML(lattesInfo, highJcr, lowJcr, true, true);
  const supervisionsPerYearHTML = window.JCRReportUtils.generateSupervisionsPerYearGraphHTML(stats.supervisions);

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
                <div style="padding: 10px; background-color: ${COLORS.backgroundSubHeader}; font-size: 0.9em; color: ${COLORS.footerText}; display: flex; flex-direction: column; gap: 10px;">
                  <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 300px;" id="histogram-container">
                        ${histogramHTML}
                    </div>
                    <div style="flex: 1; min-width: 300px;" id="papers-year-container">
                        ${papersPerYearHTML}
                    </div>
                  </div>
                  <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <div style="flex: 1; min-width: 300px;" id="author-rank-histogram-container">
                        ${authorRankHistogramHTML}
                    </div>
                    <div style="flex: 1; min-width: 300px;" id="supervisions-year-container">
                        ${supervisionsPerYearHTML}
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
    const rankStr = el.getAttribute('data-author-rank');
    return {
      el: el,
      level: el.getAttribute('data-jcr-level'),
      year: yearStr ? parseInt(yearStr) : NaN,
      authorRank: rankStr ? parseInt(rankStr) : -1,
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



    // (As secoes do CV agora sao recolhidas pelo proprio titulo — ver setupCollapsibleSections)

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

  }

  // Apply visibility based on JCR/Period/Author (Initial Refresh).
  // Fora do bloco de settings salvos para funcionar também na primeira execução.
  const filtrarCbInit = document.getElementById('tbl-chk-filtrar');
  if (filtrarCbInit) {
    filtrarCbInit.addEventListener('change', () => {
      refreshPubFilters(true);
    });
  }

  refreshPubFilters();

  // Table Toggle Listeners
  // O clique em qualquer ponto do cabecalho colapsa/expande a tabela, nao apenas no [-].
  document.querySelectorAll('.toggle-table-btn').forEach(btn => {
    const targetId = btn.getAttribute('data-target');
    // celula do cabecalho (fallback para o proprio icone, se a estrutura mudar)
    const header = btn.closest('th') || btn.parentElement || btn;
    header.style.cursor = 'pointer';
    header.style.userSelect = 'none';

    header.addEventListener('click', (e) => {
      // nao interfere com os controles que ficam dentro do cabecalho
      // (ex.: limiares de JCR, caixa "Filtrar", campo de anos)
      if (e.target !== header && e.target.closest && e.target.closest('input, select, label, a, button')) return;

      e.stopPropagation();
      const tbody = document.getElementById('tbody-' + targetId);
      if (tbody) {
        if (tbody.style.display === 'none') {
          tbody.style.display = '';
          btn.innerText = '[-]';
          jcrTablesState[targetId] = false;
        } else {
          tbody.style.display = 'none';
          btn.innerText = '[+]';
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

      // As secoes do CV nao dependem mais deste toggle: elas sao recolhidas/expandidas
      // pelo proprio titulo, e esse estado e do usuario.

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

  // Botão do relatório individual do CV atual
  const viewCvReportBtn = document.getElementById('btn-view-cv-report');
  if (viewCvReportBtn) {
    viewCvReportBtn.addEventListener('click', () => {
      if (window.JCRDBTools && typeof window.JCRDBTools.viewCurrentReport === 'function') {
        window.JCRDBTools.viewCurrentReport();
      }
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
  ['high-jcr-input', 'low-jcr-input', 'custom-year-input', 'target-author-rank-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      saveSettings();
      processLattesPage(nameLink);
    });
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
      const targetRank = parseInt(document.getElementById('target-author-rank-input')?.value) || targetAuthorRank || 1;
      if (pub.isGc) {
        // GC papers are controlled independently by the GC checkbox
        matchesRole = selectedRoles.gc;
      } else {
        // Non-GC papers are controlled by the First/Rank, Last, and Others checkboxes
        let isTargetRank = false;
        if (targetRank === 1) {
          isTargetRank = pub.isFirst;
        } else {
          isTargetRank = pub.authorRank === targetRank;
        }
        if (isTargetRank && selectedRoles.first) matchesRole = true;
        if (pub.isLast && selectedRoles.last) matchesRole = true;

        const isOther = !isTargetRank && !pub.isLast;
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
      if (isReportHidden) {
        sep.style.display = '';
      } else {
        sep.style.display = visibleYears.has(year) ? '' : 'none';
      }

      // Re-apply collapse state if collapsed
      if (sep.getAttribute('data-collapsed') === 'true') {
        let nextNode = sep.nextElementSibling;
        while(nextNode && !nextNode.classList.contains('jcr-lattes-year-separator') && nextNode.tagName !== 'H1' && nextNode.tagName !== 'H2' && !nextNode.classList.contains('layout-cell-pad-5')) {
          if (nextNode.style.display !== 'none') {
            nextNode.setAttribute('data-original-display', nextNode.style.display);
            nextNode.style.display = 'none';
          }
          nextNode = nextNode.nextElementSibling;
        }
      }
    });


    // Update graphs based on period filter and role options
    const filteredLattesInfo = lattesInfo.filter(pub => isNaN(pub.year) || pub.year >= cutoffYear);
    if (cutoffYear !== lastGraphCutoffYear) {
      lastGraphCutoffYear = cutoffYear;
      const histogramContainer = document.getElementById('histogram-container');
      const papersYearContainer = document.getElementById('papers-year-container');
      const supervisionsYearContainer = document.getElementById('supervisions-year-container');

      if (histogramContainer) histogramContainer.innerHTML = window.JCRReportUtils.generateHistogramHTML(filteredLattesInfo, highJcr, lowJcr);
      if (papersYearContainer) papersYearContainer.innerHTML = window.JCRReportUtils.generatePapersPerYearGraphHTML(filteredLattesInfo, highJcr, lowJcr);
      if (supervisionsYearContainer && stats && stats.supervisions) {
        const rawFiltered = (stats.supervisions.raw || []).filter(item => isNaN(item.year) || item.year >= cutoffYear);
        supervisionsYearContainer.innerHTML = window.JCRReportUtils.generateSupervisionsPerYearGraphHTML(rawFiltered);
      }
    }

    const authorRankHistogramContainer = document.getElementById('author-rank-histogram-container');
    if (authorRankHistogramContainer) {
      const showLast = selectedRoles ? selectedRoles.last !== false : true;
      const showGc = selectedRoles ? selectedRoles.gc !== false : true;
      authorRankHistogramContainer.innerHTML = window.JCRReportUtils.generateAuthorRankHistogramHTML(filteredLattesInfo, highJcr, lowJcr, showLast, showGc);
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
        const targetRank = parseInt(document.getElementById('target-author-rank-input')?.value) || targetAuthorRank || 1;
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
            let isTargetRank = false;
            if (targetRank === 1) {
              isTargetRank = pub.isFirstAuthor !== undefined ? pub.isFirstAuthor : (pub.authorRank === 1);
            } else {
              isTargetRank = pub.authorRank === targetRank;
            }
            let isLast = pub.isLastAuthor !== undefined ? pub.isLastAuthor : (pub.authorRank === pub.authorCount && pub.authorCount > 1 && !pub.hasEtAl);
            if (isTargetRank && selectedRoles.first) passesRole = true;
            if (isLast && selectedRoles.last) passesRole = true;
            const isOther = !isTargetRank && !isLast;
            if (isOther && selectedRoles.others) passesRole = true;
          }

          let jcrLevelKey = category === 'noJcr' ? 'none' : category;
          let passesJcr = selectedJcrLevels[jcrLevelKey];

          return passesRole && passesJcr;
        });

        tableStats = window.JCRReportUtils.calculateReportStats(
            filteredForStats, stats.patents, stats.events, stats.supervisions, stats.declaredCitations,
            currentYear, currentCustomYears, startYearRecent, startYearLast10, startYearCustom, highJcr, lowJcr, targetRank
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
              const ridStatsOrNull = window.cachedRidStats._failed ? null : window.cachedRidStats;
              if (ridStatsOrNull) injectRidTable(ridStatsOrNull);
              if (typeof window.JCRDBTools !== 'undefined') {
                  window.JCRDBTools.init('jcr-db-tools-mount', nameLink, stats, lattesInfo, ridStatsOrNull);
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
                      if (chrome.runtime.lastError) {
                          console.warn(`[RID Extraction Content Script] Background communication warning:`, chrome.runtime.lastError.message);
                      }
                      console.log(`[RID Extraction Content Script] Received response from background:`, response);
                      window.isFetchingRidStats = false;
                      if (response && response.success) {
                          window.cachedRidStats = response.stats;
                      } else {
                          console.warn(`[RID Extraction Content Script] Fetch failed or no success flag:`, response);
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
      // Com a pagina estabilizada, guarda uma copia do CV nas pastas das propostas
      // em que este pesquisador participa (se houver alguma).
      saveCvToProposalFolders(nameLink);
  }, 2000); // Give it a bit more time to stabilize
}

// Monta uma copia autossuficiente do CV: remove a interface injetada pela extensao,
// embute imagens como data: URIs, inlineia as folhas de estilo e neutraliza scripts.
async function buildStandaloneCvHtml() {
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll(
    '#annotation-alert-div, #jcr-lattes-loader, #jcr-db-tools-mount, #jcr-lattes-extra-info-style, #jcr-private-toast'
  ).forEach(el => el.remove());

  // A copia salva deve conter o CV COMPLETO: desfaz na copia (nunca na pagina) tudo o
  // que os filtros da extensao ocultaram — secoes, publicacoes filtradas por JCR/periodo/
  // autoria e blocos recolhidos pelos separadores de ano.
  clone.querySelectorAll(
    'div.title-wrapper, br.clear, .artigo-completo, .jcr-lattes-year-separator, [data-original-display]'
  ).forEach(el => {
    if (el.style && el.style.display === 'none') {
      el.style.display = el.getAttribute('data-original-display') || '';
    }
    el.removeAttribute('data-original-display');
  });

  // Secoes recolhidas pelo clique no titulo voltam a aparecer na copia, devolvendo o
  // display que tinham antes (preserva o que o proprio Lattes mantem oculto).
  clone.querySelectorAll('[data-jcr-collapsed]').forEach(el => {
    el.style.display = el.getAttribute('data-jcr-prev-display') || '';
    el.removeAttribute('data-jcr-collapsed');
    el.removeAttribute('data-jcr-prev-display');
  });

  // Remove os controles de recolher injetados pela extensao (marcador e titulo do Resumo)
  clone.querySelectorAll('.jcr-section-toggle, h1.jcr-section-title').forEach(el => el.remove());
  clone.querySelectorAll('[data-jcr-collapsible]').forEach(wrapper => {
    wrapper.removeAttribute('data-jcr-collapsible');
    const titulo = wrapper.querySelector('h1, h2, h3');
    if (titulo) {
      titulo.style.cursor = '';
      titulo.style.userSelect = '';
      titulo.removeAttribute('title');
    }
  });

  // Separadores de ano recolhidos passam a aparecer expandidos na copia
  clone.querySelectorAll('.jcr-lattes-year-separator[data-collapsed="true"]').forEach(sep => {
    sep.setAttribute('data-collapsed', 'false');
    const icone = sep.querySelector('.jcr-collapse-icon');
    if (icone) icone.textContent = '[-]';
  });

  let html = '<!DOCTYPE html>' + String.fromCharCode(10) + clone.outerHTML;

  // Os assets sao buscados pelo service worker (evita bloqueios de origem cruzada)
  const viaBackground = (action) => (url) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action, url }, (res) => {
        if (chrome.runtime.lastError || !res || !res.success) { resolve(null); return; }
        resolve(action === 'fetch_arraybuffer' ? { base64: res.base64, mime: res.mime } : res.text);
      });
    } catch (e) { resolve(null); }
  });

  const utils = window.JCRReportUtils;
  if (utils && typeof utils.embedAssets === 'function') {
    html = await utils.embedAssets(html, location.href, viaBackground('fetch_arraybuffer'), viaBackground('fetch_url'));
  }
  if (utils && typeof utils.makeSelfContainedHtml === 'function') {
    // fallbackStyles: false preserva a aparencia original do curriculo
    html = utils.makeSelfContainedHtml(html, location.href, { fallbackStyles: false });
  }
  return html;
}

// Quantas anotacoes de JCR ainda nao chegaram. O Lattes preenche o atributo
// original-title de cada .ajaxJCR por AJAX, uma requisicao por periodico: enquanto
// isso nao termina, os artigos aparecem como "Nao classificado".
function contarJcrPendentes() {
  return document.querySelectorAll('.ajaxJCR:not([original-title])').length;
}

function cvDadosProntos() {
  return contarJcrPendentes() === 0 && !window.isFetchingRidStats;
}

async function saveCvToProposalFolders(nameLink, tentativa = 0) {
  if (window.__jcrCvProposalSaveDone) return;
  const DB = window.JCRDBTools;
  if (!DB || typeof DB.findProposalsForResearcher !== 'function') return;

  const lattesId = (DB.currentCvData && DB.currentCvData.lattesId) || '';
  const nome = (nameLink && nameLink.name) || '';
  if (!lattesId && !nome) return;

  try {
    const alvos = await DB.findProposalsForResearcher(lattesId, nome);
    if (!alvos || alvos.length === 0) return;   // nao pertence a nenhuma proposta: nada a fazer

    // Espera os fatores de impacto chegarem antes de salvar. Sem isso a copia era
    // gravada aos 2s com boa parte dos artigos ainda como "Nao classificado".
    const MAX_TENTATIVAS = 40;   // ~60s de espera
    if (!cvDadosProntos() && tentativa < MAX_TENTATIVAS) {
      if (window.__jcrCvProposalSaveTimer) return;   // ja existe uma espera em curso
      if (tentativa === 0) {
        console.log(`[JCRLattes] Aguardando ${contarJcrPendentes()} fator(es) de impacto antes de salvar o CV...`);
      }
      window.__jcrCvProposalSaveTimer = setTimeout(() => {
        window.__jcrCvProposalSaveTimer = null;
        saveCvToProposalFolders(nameLink, tentativa + 1);
      }, 1500);
      return;
    }

    const pendentes = contarJcrPendentes();
    if (pendentes > 0) {
      console.warn(`[JCRLattes] Tempo esgotado: ${pendentes} fator(es) de impacto nao chegaram. Salvando assim mesmo.`);
    }

    window.__jcrCvProposalSaveDone = true;
    const html = await buildStandaloneCvHtml();
    const res = await DB.saveCvToMatchingProposals(lattesId, nome, html);

    if (res.propostas.length > 0) {
      const aviso = pendentes > 0 ? ` (${pendentes} sem JCR: dados incompletos)` : '';
      DB.showToast(`CV salvo na pasta de ${res.propostas.length} proposta(s): ${res.propostas.join(', ')}${aviso}`,
                   pendentes > 0 ? '#e67e22' : '#4CAF50');
      console.log('[JCRLattes] CV salvo nas propostas:', res.propostas);
    }
  } catch (e) {
    window.__jcrCvProposalSaveDone = false;   // permite nova tentativa
    console.warn('JCRLattes: falha ao salvar o CV nas pastas das propostas', e);
  }
}

// Torna o titulo de cada secao do CV clicavel para recolher/expandir o seu conteudo.
// Substitui os antigos checkboxes "Mostrar/Ocultar Secoes". O estado e guardado por id de
// secao (a ancora do Lattes, estavel entre curriculos) e reaplicado ao abrir outros CVs.
function setupCollapsibleSections(sections) {
  sections.forEach(section => {
    const wrapper = section.element;
    if (!wrapper || wrapper.getAttribute('data-jcr-collapsible') === 'true') return;

    // O cabecalho pode ser <a name><h1></a> ou apenas <h1>. Na secao "Resumo" o <h1> vem
    // vazio e oculto (ui-hidden), entao injetamos um titulo proprio para haver onde clicar.
    let headerHost = wrapper.querySelector('a[name]') || wrapper.querySelector('h1, h2, h3');
    let clickable = headerHost && headerHost.querySelector('h1, h2, h3') || headerHost;

    const semTitulo = !clickable || !clickable.textContent.trim() ||
                      (clickable.className || '').includes('ui-hidden');
    if (semTitulo) {
      const titulo = document.createElement('h1');
      titulo.className = 'jcr-section-title';
      titulo.textContent = section.label || 'Resumo';
      wrapper.insertBefore(titulo, wrapper.firstChild);
      headerHost = titulo;
      clickable = titulo;
    }
    if (!clickable) return;

    // Conteudo recolhivel: tudo dentro do wrapper, menos o cabecalho e o separador
    const conteudo = Array.from(wrapper.children).filter(ch =>
      ch !== headerHost && !headerHost.contains(ch) && !ch.matches('hr.separator'));
    if (conteudo.length === 0) return;

    const icone = document.createElement('span');
    icone.className = 'jcr-section-toggle';
    icone.style.cssText = `display: inline-block; margin-right: 10px; font-size: 0.6em; font-weight: bold; font-family: monospace; vertical-align: middle; letter-spacing: -0.5px; color: ${COLORS.midJcr};`;
    clickable.insertBefore(icone, clickable.firstChild);

    clickable.style.cursor = 'pointer';
    clickable.style.userSelect = 'none';
    clickable.title = 'Clique para recolher/expandir esta secao';

    const aplicar = (recolhido) => {
      // Guarda o display anterior ao recolher e o devolve ao expandir. Sem isso, expandir
      // faria display='' em todos os filhos e revelaria o que o PROPRIO Lattes mantem
      // oculto. O atributo data-jcr-collapsed ainda marca o que foi escondido por nos,
      // para o salvamento do CV saber o que reexpandir.
      const marcar = (el) => {
        if (recolhido) {
          if (!el.hasAttribute('data-jcr-collapsed')) {
            el.setAttribute('data-jcr-prev-display', el.style.display || '');
            el.setAttribute('data-jcr-collapsed', 'true');
            el.style.display = 'none';
          }
        } else if (el.hasAttribute('data-jcr-collapsed')) {
          el.style.display = el.getAttribute('data-jcr-prev-display') || '';
          el.removeAttribute('data-jcr-collapsed');
          el.removeAttribute('data-jcr-prev-display');
        }
      };
      conteudo.forEach(marcar);
      if (section.footerElement) marcar(section.footerElement);
      icone.textContent = recolhido ? '[+]' : '[-]';
    };

    aplicar(jcrSectionsCollapsed[section.id] === true);

    clickable.addEventListener('click', (e) => {
      // links internos do cabecalho continuam funcionando
      if (e.target !== clickable && e.target.closest && e.target.closest('a[href], input, button')) return;
      e.preventDefault();
      const recolhido = !(jcrSectionsCollapsed[section.id] === true);
      jcrSectionsCollapsed[section.id] = recolhido;
      aplicar(recolhido);
      saveSettings();
    });

    wrapper.setAttribute('data-jcr-collapsible', 'true');
  });
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

function generateSectionToggles(targetAuthorRank = 1) {
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
  `;

  // Production Filters Row
  html += `
      <div style="display: flex; gap: 30px; flex-wrap: wrap;">
        
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
              <span id="lbl-toggle-author-first">${targetAuthorRank}º Autor</span>
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
            <div style="margin-top: 6px; display: flex; align-items: center; gap: 5px; font-size: 0.95em;">
              <label for="target-author-rank-input" style="font-weight: bold;">Rank do Autor:</label>
              <input type="number" id="target-author-rank-input" value="${targetAuthorRank}" min="1" max="99" style="width: 45px; padding: 2px; text-align: center;">
            </div>
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
    const anchor = Array.from(document.querySelectorAll('a[name]')).find(
      a => a.getAttribute('name').toLowerCase() === anchorName.toLowerCase()
    );
    if (!anchor) return;

    let sibling = anchor.nextElementSibling;
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

          let area = "";
          let institution = "";

          let searchStr = cleanText;
          const yearMatches = cleanText.match(/\b(?:19|20)\d{2}\b/g);
          if (yearMatches && yearMatches.length > 0) {
              const lastYear = yearMatches[yearMatches.length - 1];
              const lastYearIndex = cleanText.lastIndexOf(lastYear);
              searchStr = cleanText.substring(lastYearIndex + 4);
          }

          const areaInstMatch = searchStr.match(/\(([^)]+)\)\s*-\s*([^,.]+)/);
          if (areaInstMatch) {
              area = areaInstMatch[1].trim();
              institution = areaInstMatch[2].trim();
          } else {
              const natureMatch = cleanText.match(/(?:natureza|natureza\.)\s*-\s*([^,.]+)/);
              if (natureMatch) {
                  institution = natureMatch[1].trim();
              } else {
                  let lastYearMatchStr = null;
                  const regex = /\b(?:19|20)\d{2}\.\s+([^,.]+)/g;
                  let match;
                  while ((match = regex.exec(cleanText)) !== null) {
                      lastYearMatchStr = match[1];
                  }
                  if (lastYearMatchStr) {
                      institution = lastYearMatchStr.trim();
                  }
              }
          }


          supervisions.raw.push({
            category: finalKey,
            status: extractYear ? 'Concluída' : 'Em andamento',
            year: extractedYear,
            area: area,
            institution: institution,
            reference: cleanText
          });
        }
      } else if (sibling.tagName === 'A' && sibling.hasAttribute('name')) {
        const name = sibling.getAttribute('name').toLowerCase();
        if (name && (name === 'orientacoesconcluidas' || name === 'producaobibliografica' || name === 'producaotecnica' || name === 'outraproducao' || name === 'dadoscomplementares')) {
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
        const yearMatch = text.match(/\b(19|20)\d{2}\b\.\s*\(/);
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

var loadingTimeout = null;

function showLoading() {
  if (loadingTimeout) return;
  loadingTimeout = setTimeout(() => {
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
  }, 1000); // 1000ms delay to avoid flashing
}

function hideLoading(force = false) {
  if (loadingTimeout) {
    clearTimeout(loadingTimeout);
    loadingTimeout = null;
  }

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
        const loader = document.getElementById('jcr-lattes-loader');
        if (loader) {
            loader.style.display = 'none';
        }
        
        if (typeof observer !== 'undefined' && observer) {
          observer.disconnect();
          console.log('[JCR Lattes] Asynchronous data loaded. MutationObserver disconnected.');
        }
      }
    }, 800);
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
