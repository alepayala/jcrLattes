// Private metrics have been moved to private_tools.js
let COLORS = window.JCRReportUtils.COLORS;
let GRAPH_COLORS = window.JCRReportUtils.GRAPH_COLORS;

// ---------------------------------------------------------------------------
// Este script roda nos DOIS sites do Lattes, e quem decide e o endereco:
//   antigo  buscatextual.cnpq.br/.../visualizacv.do   -> lattes_parser.js
//   novo    busca-cv-lattes.cnpq.br/curriculo/<id>    -> lattes_parser_novo.js
// LEITOR e o leitor do formato; PAGINA reune o que muda no DOM de um para o outro
// (onde estao os artigos, onde entra a anotacao, onde entra o painel). O resto do
// arquivo nao sabe em qual dos dois esta.
// ---------------------------------------------------------------------------
// (lattes_parser_novo.js so e carregado no site novo; ver manifest.json)
const LATTES_NOVO = !!(window.JCRLattesParserNovo && window.JCRLattesParserNovo.ehSiteNovo(location));
const LEITOR = LATTES_NOVO ? window.JCRLattesParserNovo : window.JCRLattesParser;
const PAGINA = LATTES_NOVO ? {
  seletorArtigo: LEITOR.SELETOR_ARTIGO,
  seletorArtigoAnotado: LEITOR.SELETOR_ARTIGO,
  raizArtigos: () => document.getElementById('producoes-panel') || document,
  // a anotacao entra depois do <p> do artigo, dentro do <li>
  ancoraDaAnotacao: (pub) => pub.querySelector(':scope > p'),
  // O painel entra no topo da coluna do curriculo (.cv-main, 800 px), ao lado do cartao
  // do pesquisador: acompanha a largura da janela junto com o resto da pagina e nao
  // empurra o cartao para baixo. Sem a coluna, cai para cima do corpo do CV.
  inserirPainel: (painel) => {
    const coluna = document.querySelector('.cv-layout .cv-main');
    if (coluna) { coluna.insertBefore(painel, coluna.firstChild); return true; }
    const corpo = document.querySelector('.cv-layout');
    if (!corpo || !corpo.parentElement) return false;
    corpo.parentElement.insertBefore(painel, corpo);
    return true;
  },
  // Painel compacto: um resumo em cartoes sempre a vista e as tabelas e os graficos em
  // blocos que comecam recolhidos (o estado de cada bloco e lembrado, numa chave propria
  // deste formato de pagina — ver CHAVE_TABELAS).
  painelCompacto: true,
  estiloDoPainel: 'margin-bottom: 16px; padding: 10px 12px; background: #fff; border: 1px solid #e3e8ef; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.06); color-scheme: light;',
  // o site novo ja tem as suas secoes recolhiveis
  secoesRecolhiveis: false,
  // <select> "Ordenar artigos por" do site; os separadores de ano so fazem sentido
  // com a lista em ordem cronologica ('cron', o padrao)
  idSeletorDeOrdem: 'ordenacaoArtigos',
  ordemCronologica: () => { const s = document.getElementById('ordenacaoArtigos'); return !s || s.value === 'cron'; },
  salvarHtml: true
} : {
  seletorArtigo: "div[class='artigo-completo']",
  seletorArtigoAnotado: '.artigo-completo',
  // Os artigos moram em #artigos-completos; a secao "Educacao e Popularizacao de C & T"
  // repete, com a mesma classe .artigo-completo, artigos que ja estao ali — varrer a
  // pagina inteira contava esses repetidos (e o JCR deles) de novo. So se o container
  // nao existir a busca cai para o documento todo.
  raizArtigos: () => document.getElementById('artigos-completos') || document,
  ancoraDaAnotacao: (pub) => pub.querySelector('[cvuri]'),
  inserirPainel: (painel) => {
    // ausente na versao impressa do CV
    const principal = document.getElementsByClassName('main-content')[0];
    if (!principal) return false;
    principal.insertBefore(painel, principal.firstChild);
    return true;
  },
  painelCompacto: false,
  // color-scheme: so importa no Lattes novo, mas nao atrapalha aqui
  estiloDoPainel: null,
  secoesRecolhiveis: true,
  idSeletorDeOrdem: null,
  ordemCronologica: () => true,
  salvarHtml: true
};


let observer;
const observerConfig = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['original-title', 'cvuri']
};

const SETTINGS_KEY = 'jcr_lattes_settings';
// "Opções e Filtros" abre recolhido; os demais blocos, abertos. O clique grava a escolha.
let jcrTablesState = { publicacoes: false, citacoes: false, orientacoes: false, patentes: false, eventos: false, graficos: false };
// No Lattes novo o painel e compacto: os blocos comecam recolhidos e o estado fica numa
// chave propria, para nao brigar com o do formato antigo (onde comecam abertos).
const CHAVE_TABELAS = PAGINA.painelCompacto ? 'tablesNovo' : 'tables';
const CHAVE_TABELAS_DO_OUTRO = PAGINA.painelCompacto ? 'tables' : 'tablesNovo';
if (PAGINA.painelCompacto) Object.keys(jcrTablesState).forEach(k => { jcrTablesState[k] = true; });
// estado gravado do outro formato de pagina: saveSettings regrava o objeto inteiro e
// tem de devolve-lo como encontrou
let jcrTablesDoOutroFormato = null;
// Secoes do CV recolhidas pelo usuario (clique no titulo). Chave = id da ancora da secao,
// que e estavel entre curriculos, entao o estado vale para os proximos CVs abertos.
let jcrSectionsCollapsed = {};
// O painel inteiro recolhido (so o cabecalho a vista); vale para os dois formatos de pagina.
let jcrPainelRecolhido = false;
// "Lembrar os filtros de exibicao" (dialogo de opcoes); lido do que foi gravado.
let lembrarFiltrosAtual = true;

async function saveSettings() {
  const rankInputVal = parseInt(document.getElementById('target-author-rank-input')?.value);
  const settings = {
    highJcr: parseFloat(document.getElementById('high-jcr-input')?.value) || 7,
    lowJcr: parseFloat(document.getElementById('low-jcr-input')?.value) || 1.5,
    customYears: (() => { const v = parseInt(document.getElementById('custom-year-input')?.value, 10); return isNaN(v) || v < 0 ? 1 : v; })(),
    lembrarFiltros: lembrarFiltrosAtual,
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
      [CHAVE_TABELAS]: jcrTablesState,
      ...(jcrTablesDoOutroFormato ? { [CHAVE_TABELAS_DO_OUTRO]: jcrTablesDoOutroFormato } : {}),
      sectionsCollapsed: { ...jcrSectionsCollapsed },
      painelRecolhido: jcrPainelRecolhido,
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

// Busca das métricas no ResearcherID / Web of Science (aba oculta aberta pelo
// background, ação 'fetch_rid_stats'). Com false nada é pedido ao background e o painel
// segue só com os dados do currículo. Esteve desligada em 2026-11-24, durante a
// adaptação ao Lattes novo; religada em 2026-11-25, a pedido.
const BUSCAR_RID = true;

// Curriculo lido pela API (window.JCRLattesApi) enquanto a pagina nao tem a lista de
// artigos inteira; null quando nao foi preciso ou a API falhou. paginaCompletaDepois
// resolve quando a pagina terminou de carregar e a montagem deve ser refeita.
// (Declarados antes de main() rodar: no formato antigo main() chega a eles sem nenhum await.)
let curriculoPelaApi = null;
let paginaCompletaDepois = null;

(async () => await main())();

// O Lattes novo e uma aplicacao de pagina unica: o script entra em qualquer endereco
// do site e o curriculo pode aparecer depois, sem recarregar. Espera o endereco ser
// o de um curriculo e o cabecalho estar montado; depois abre as secoes que a extensao
// le e rola ate a lista de artigos ficar completa (LEITOR.prepararPagina).
async function lerCurriculoPelaApi() {
  const api = window.JCRLattesApi;
  if (!api || !api.ATIVA) return null;
  const id = LEITOR._idLattesDoEndereco(location.pathname);
  if (!id) return null;
  try {
    const cv = api.lerCurriculo(await api.buscarCurriculo(id));
    return cv.publications.length ? cv : null;
  } catch (e) {
    console.warn('JCR Lattes: a API do Lattes nao respondeu; segue so com a pagina.', e && e.message);
    return null;
  }
}

async function esperarCurriculoNovo() {
  const espera = (ms) => new Promise(r => setTimeout(r, ms));
  while (!(LEITOR.ehPaginaDoCurriculo(location.href) && document.querySelector('h1.nome') &&
           document.querySelector('button.accordion-header'))) {
    await espera(500);
  }
  showLoading();
  // A lista de artigos passa de 200 em lotes que o site so carrega com a aba visivel.
  // Se ficou incompleta com a aba oculta (aberta em segundo plano), espera ela aparecer
  // e tenta de novo, para nao ler nem gravar um curriculo pela metade.
  const abaVisivel = () => new Promise((resolve) => {
    if (!document.hidden) { resolve(); return; }
    const aoMudar = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', aoMudar);
      resolve();
    };
    document.addEventListener('visibilitychange', aoMudar);
  });
  const completar = async () => {
    let r = { completo: false, artigos: 0 };
    for (let tentativa = 0; !r.completo && tentativa < 3; tentativa++) {
      await abaVisivel();
      r = await LEITOR.prepararPagina(document, { secoes: LEITOR.SECOES_LIDAS });
    }
    if (!r.completo) console.warn('JCR Lattes: a lista de artigos pode estar incompleta (' + r.artigos + ' lidos).');
    return r;
  };
  const pronta = await LEITOR.prepararPagina(document, { secoes: LEITOR.SECOES_LIDAS });
  if (!pronta.completo) {
    // Reserva: os artigos que faltam na pagina vem da API do proprio site, para o
    // painel e o banco ja sairem com o curriculo inteiro. Quando a aba aparecer, a
    // pagina e completada e a montagem refeita so com ela (paginaCompletaDepois).
    curriculoPelaApi = await lerCurriculoPelaApi();
    if (curriculoPelaApi) {
      paginaCompletaDepois = completar().then(() => { curriculoPelaApi = null; });
    } else {
      await completar();
    }
  }

  // Trocar de curriculo (ou sair dele) nao recarrega a pagina, e o painel ficaria com
  // os dados do anterior. Recarregar e o jeito simples e seguro de recomecar limpo.
  // So conta a troca do curriculo em si: as pilulas de secao do topo (Identificacao,
  // Endereco Profissional...) tambem mexem no endereco, e recarregar por causa delas
  // reiniciava a leitura a cada clique.
  const idDoEndereco = () => LEITOR._idLattesDoEndereco(location.pathname);
  const idInicial = idDoEndereco();
  setInterval(() => { if (idDoEndereco() !== idInicial) location.reload(); }, 1000);
}

async function main() {
  if (LATTES_NOVO) await esperarCurriculoNovo();

  // attempt to get CV name and link from Lattes page
  const nameLink = LEITOR.lerIdentificacao(document);

  // check whether name and link were not found (if not this is not a CV Lattes!)
  if (!nameLink['name']) { hideLoading(true); return; }

  // maior titulacao concluida e o ano ({ nivel: 'D'|'M'|'E'|'G', ano }), para a
  // tabela de membros da equipe
  nameLink.titulacao = LEITOR.lerTitulacao(document);

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

  // Lattes novo: a montagem acima usou a API porque a pagina estava incompleta; quando
  // a pagina completar (aba visivel), refaz so com ela, anotando todos os artigos.
  if (paginaCompletaDepois) paginaCompletaDepois.then(() => processLattesPage(nameLink));

  // Lattes novo: "Ordenar artigos por" muda a ordem dos artigos sem recarregar a pagina
  // (o site move os mesmos elementos; as anotacoes vao junto, os separadores de ano
  // nao). Refaz a montagem: fora da ordem cronologica os separadores nao entram.
  if (LATTES_NOVO) {
    document.addEventListener('change', (ev) => {
      if (ev.target && ev.target.id === PAGINA.idSeletorDeOrdem) {
        setTimeout(() => processLattesPage(nameLink), 600);
      }
    });
  }

  // Debounced processor
  const processDebounced = debounce(() => {
    processLattesPage(nameLink);
  }, 1000);

  // Initialize observer
  observer = new MutationObserver((mutations) => {
    // Only trigger if mutation is relevant (child list changes or JCR/CVURI attributes)
    const isRelevant = mutations.some(m => {
      if (m.target && m.target.closest && m.target.closest('.jcr-lattes-year-separator')) return false;
      // nossas proprias anotacoes nao contam (so o site novo chega aqui com elas:
      // la o Angular pode redesenhar a lista enquanto a anotamos)
      if (m.target && m.target.closest && m.target.closest('.jcr-lattes-annotation')) return false;
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

  observer.observe(raizObservada(), observerConfig);
}

// O que o observador vigia: a lista de artigos; sem ela (ainda nao montada), o corpo.
function raizObservada() {
  const raiz = PAGINA.raizArtigos();
  return raiz && raiz !== document ? raiz : document.body;
}

// Helper to safely update DOM without triggering observer loop
async function updateSafe(callback) {
  if (observer) observer.disconnect();
  try {
    await callback();
  } finally {
    if (observer) observer.observe(raizObservada(), observerConfig);
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

// Mesma funcao que JCRReportUtils._esc; delega para nao manter duas copias.
function escHtml(str) {
  return window.JCRReportUtils._esc(str);
}

async function processLattesPage(nameLink) {
  showLoading();
  // Load saved settings if any
  const saved = await loadSettings();

  if (saved?.toggles?.[CHAVE_TABELAS]) {
    jcrTablesState = { ...jcrTablesState, ...saved.toggles[CHAVE_TABELAS] };
  }
  if (saved?.toggles?.[CHAVE_TABELAS_DO_OUTRO]) jcrTablesDoOutroFormato = saved.toggles[CHAVE_TABELAS_DO_OUTRO];
  if (typeof saved?.toggles?.painelRecolhido === 'boolean') jcrPainelRecolhido = saved.toggles.painelRecolhido;

  if (saved?.toggles?.sectionsCollapsed) {
    jcrSectionsCollapsed = { ...saved.toggles.sectionsCollapsed };
  }

  // Cores: as gravadas, ou a paleta padrao (opcoesEfetivas reconhece a paleta antiga
  // gravada sem escolha do usuario e a troca pela nova)
  const opcoesSalvas = window.JCRReportUtils.opcoesEfetivas(saved);
  lembrarFiltrosAtual = opcoesSalvas.lembrarFiltros;
  window.JCRReportUtils.aplicarCores(opcoesSalvas.cores);

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
  targetAuthorRank = window.JCRReportUtils.rankAlvoEfetivo(targetAuthorRank);

  // Wrap updates in updateSafe to prevent infinite loop
  await updateSafe(async () => {
    try {
      // Annotate Lattes page and return annotated Lattes info
      // Lattes novo: se a lista de artigos ainda tem itens por carregar (a montagem foi
      // chamada cedo, ou o site redesenhou a lista), completa antes de ler. Em aba oculta
      // nao ha como: ai vale a reserva pela API, logo abaixo.
      if (LATTES_NOVO && !document.hidden && LEITOR.listaIncompleta(document)) {
        await LEITOR.prepararPagina(document, { secoes: LEITOR.SECOES_LIDAS });
      }
      const authorNames = LEITOR.lerApelidos(document);
      let lattesInfo = annotateLattesPage(highJcr, lowJcr, authorNames);
      // Lattes novo com a lista da pagina ainda incompleta (aba em segundo plano): os
      // numeros saem dos artigos lidos pela API; as anotacoes, dos que estao na pagina.
      if (curriculoPelaApi && lattesInfo && curriculoPelaApi.publications.length > lattesInfo.length) {
        console.log(`JCR Lattes: ${lattesInfo.length} artigos na pagina, ${curriculoPelaApi.publications.length} pela API; usando a API para os numeros.`);
        lattesInfo = curriculoPelaApi.publications;
      }
      // A leitura destas secoes mora em lattes_parser.js, junto com a das publicacoes.
      const supervisions = LEITOR.lerOrientacoes(document);
      const patents = LEITOR.lerPatentes(document);
      const events = LEITOR.lerEventos(document);

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
        titulacao: nameLink.titulacao || null,
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

    // O CV completo vai para a base dedicada do piccTools (jcr_picc_cv:), e SÓ para ela.
    //
    // Esta função roda sozinha, toda vez que se abre no Lattes o CV de alguém que está
    // numa proposta — tipicamente para alimentar a proposta, não para colecionar o CV.
    // Por isso ela não marca inGeneralDb: quem decide que um CV entra na lista pessoal é
    // saveCurrentCV, que só roda quando o usuário manda salvar (ou ligou o salvamento
    // automático). Marcar aqui enchia o banco geral de membros de equipe.
    if (window.JCRDBTools.savePiccCV) {
      await window.JCRDBTools.savePiccCV(piccCvData);
    }

    // Update matching proposal entries with Lattes ID and Fellowship string
    let updatedEntries = [];
    db.forEach(entry => {
      if (entry.isProcesso || entry.processId) {
        let modified = false;

        // 1. Proponente match
        if (entry.proponente && entry.proponente.name) {
          if (window.JCRDBTools.cvMatches({ name: targetName, lattesId }, entry.proponente.name, entry.proponente.lattesId)) {
            // cvMatches so casa IDs iguais quando os dois tem: aqui basta preencher o que falta
            if (lattesId && !entry.proponente.lattesId) {
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
        // UM membro por proposta: o do mesmo ID ou, sem ID, o unico de nome compativel.
        // Com o teste membro a membro, dois membros sem ID de nomes parecidos ("Maria
        // Silva" e "Maria J. Silva") recebiam os dois o ID e a bolsa deste CV.
        if (Array.isArray(entry.teamMembers)) {
          const member = window.JCRDBTools._acharPesquisador(entry.teamMembers, targetName, lattesId, m => !!m.name);
          if (member) {
            if (lattesId && !member.lattesId) {
              member.lattesId = lattesId;
              modified = true;
            }
            if (cvBolsa && member.bolsa !== cvBolsa) {
              member.bolsa = cvBolsa;
              modified = true;
            }
          }
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

// Onde procurar os artigos: depende do formato da pagina (ver PAGINA).
function articlesRoot() {
  return PAGINA.raizArtigos();
}

// Annotate and extract journal info form Lattes page
function annotateLattesPage(highJcr, lowJcr, authorNames) {
  console.log('Searching for journal publications...');

  const pubElems = articlesRoot().querySelectorAll(PAGINA.seletorArtigo);

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

    // A LEITURA mora em lattes_parser.js; aqui fica só o que desenha a página.
    // Quando o Lattes mudar de formato, e a mudanca esta anunciada, o ajuste e la.
    const pubInfo = LEITOR
      ? LEITOR.lerPublicacao(pubElem, { apelidos: authorNames })
      : null;
    if (!pubInfo) {
      console.warn('[JCRLattes] Leitor de publicações indisponível (lattes_parser.js).');
      continue;
    }

    // Insert year separator if year changed and extra info is not hidden
    if (!isExtraInfoHidden && !isNaN(pubInfo.year)) {
      if (pubInfo.year !== lastYear && PAGINA.ordemCronologica()) {
        injectYearSeparator(pubElem, pubInfo.year);
        lastYear = pubInfo.year;
      }
    }

    // authorCountStr e apresentacao, nao dado: leva HTML dentro. Fica aqui, fora do
    // leitor, ate a proxima etapa decidir o que fazer com ele (hoje vai parar no banco).
    // lista cortada pelo site novo ("et.al"): o numero e so o que foi listado
    // Cada parte so aparece se o dado esta liberado (JCRReportUtils.*_ATIVO/_ATIVA):
    // numero de autores, posicao fora do 1o lugar e ultimo autor estao desligados
    // enquanto o Lattes novo nao permite confirma-los. "Primeiro" vale sempre.
    const U = window.JCRReportUtils;
    const partesAutoria = [];
    if (U.NUMERO_DE_AUTORES_ATIVO) {
      partesAutoria.push(`${pubInfo.authorsTruncated ? '≥ ' : ''}${pubInfo.authorCount} autor${pubInfo.authorCount !== 1 ? 'es' : ''}${pubInfo.hasEtAl && U.GRANDES_COLABORACOES_ATIVAS ? ' + et al.' : ''}`);
    } else if (pubInfo.hasEtAl && U.GRANDES_COLABORACOES_ATIVAS) {
      partesAutoria.push('grande colaboração');
    }
    if (pubInfo.isFirstAuthor) {
      partesAutoria.push(`<span style="color: ${COLORS.midJcr}; font-weight: bold;">Primeiro</span>`);
    } else if (pubInfo.isLastAuthor && U.ULTIMO_AUTOR_ATIVO) {
      partesAutoria.push(`<span style="color: ${COLORS.highJcr}; font-weight: bold;">Último</span>`);
    } else if (U.POSICAO_DE_AUTOR_ATIVA && pubInfo.authorRank !== -1) {
      partesAutoria.push(`ordem: ${pubInfo.authorRank}`);
    } else if (U.POSICAO_DE_AUTOR_ATIVA && pubInfo.authorsTruncated) {
      // lista com "et.al" no Lattes novo: fora do 1o lugar a posicao nao e confiavel
      partesAutoria.push('ordem: indeterminada');
    }
    pubInfo.authorCountStr = partesAutoria.join(', ');

    if (isNaN(pubInfo.year)) continue;

    pubElem.setAttribute('data-jcr-level', window.JCRLattesParser.faixaJcr(pubInfo.impactFactor, highJcr, lowJcr));
    pubElem.setAttribute('data-year', pubInfo.year);
    pubElem.setAttribute('data-is-first', pubInfo.isFirstAuthor);
    pubElem.setAttribute('data-is-last', pubInfo.isLastAuthor);
    pubElem.setAttribute('data-is-gc', pubInfo.hasEtAl);
    pubElem.setAttribute('data-author-rank', pubInfo.authorRank);

    const pubElemLastItem = PAGINA.ancoraDaAnotacao(pubElem);
    if (pubElemLastItem) {
      injectJournalAnnotation(
        pubElemLastItem,
        pubInfo.issn,
        { impactFactor: pubInfo.impactFactor, jcrYear: pubInfo.jcrYear },
        highJcr,
        lowJcr,
        pubInfo.authorCountStr
      );
    }
    pubInfoList.push(pubInfo);
  }

  return pubInfoList;
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
        <span class="jcr-collapse-icon" style="display: inline-block; width: 20px; font-size: 1.1em; font-weight: bold; color: ${COLORS.midJcr}; text-align: center;">${setaRecolher(isPreviouslyCollapsed)}</span>
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
        iconSpan.innerHTML = setaRecolher(newState);
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



// ---------------------------------------------------------------------------
// Desenho das tabelas recolhiveis do painel do CV.
//
// Isto e APRESENTACAO: quando a pagina do Lattes mudar de formato, e aqui que se
// mexe, e nao em quem calcula os numeros. As quatro tabelas menores — citacoes,
// orientacoes, patentes e eventos — tinham esta moldura escrita uma vez cada,
// variando so a chave, o numero de colunas e os cabecalhos. Publicacoes fica de
// fora: o cabecalho dela tem duas linhas, por causa das faixas de JCR.
//
// recolhida controla tres coisas ao mesmo tempo: o simbolo do botao, o colspan do
// titulo (que ocupa a largura toda quando as colunas somem) e a visibilidade do
// corpo.
// ---------------------------------------------------------------------------
// Seta de recolher/expandir, a mesma em todo o painel (blocos, o painel inteiro,
// separadores de ano, secoes do CV antigo): para baixo = aberto, para a direita =
// recolhido, no azul dos titulos do Lattes novo. Desenhada aqui porque o formato antigo
// nao tem a fonte de icones do site novo.
function setaRecolher(recolhido) {
  return `<svg class="jcr-seta" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1351b4" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="vertical-align: -1px; transform: rotate(${recolhido ? -90 : 0}deg);"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
}

function molduraTabelaCv({ chave, titulo, totalCols, colunas, corpo }) {
  const recolhida = !!jcrTablesState[chave];
  return `
            <div class="rodape-cv" style="margin-top: 10px; color: ${COLORS.footerText}; font-size: 1.1em;">
              <table style="width: 100%; border-collapse: collapse; text-align: center; font-family: inherit; font-size: 0.9em;">
                <thead>
                  <tr style="background-color: ${COLORS.backgroundHeader}; border-bottom: 1px solid ${COLORS.border};">
                    <th class="jcr-main-header-cell" data-total-cols="${totalCols}" colspan="${recolhida ? totalCols : 1}" style="padding: 8px; text-align: left;">
                      <span class="toggle-table-btn" data-target="${chave}" style="cursor: pointer; user-select: none; margin-right: 5px;">${setaRecolher(recolhida)}</span> ${titulo}
                    </th>
                    ${colunas}
                  </tr>
                </thead>
                <tbody id="tbody-${chave}" style="display: ${recolhida ? 'none' : ''};">
                  ${corpo}
                </tbody>
              </table>
            </div>
      `;
}

// Coluna do cabecalho de uma tabela recolhivel: some junto com o corpo.
function colunaTabelaCv(chave, rotulo, dica) {
  return `<th class="jcr-main-header-extra" style="display: ${jcrTablesState[chave] ? 'none' : ''}; padding: 8px; text-align: center;" title="${dica}">${rotulo}</th>`;
}

// ---------------------------------------------------------------------------
// Monta o HTML do painel que vai para o topo do CV. So GERA — nao procura
// elemento, nao escreve na pagina, nao liga listener. Quem injeta e
// injectReportTable, logo abaixo.
//
// A separacao existe porque a mudanca anunciada do Curriculo Lattes traz
// formatacao nova junto com a estrutura nova: assim, o que muda com o layout
// fica aqui, e quem calcula os numeros nao e tocado. A geracao estava
// intercalada com a criacao do container, que passou para o lado da injecao.
// ---------------------------------------------------------------------------
// Area de controles e graficos que vai abaixo das tabelas do painel. So GERA:
// recebe o que precisa e devolve HTML. Os quatro graficos vem prontos do
// report_utils; aqui eles so sao embalados no layout da pagina.
function montarAreaDeGraficos(togglesHTML, lattesInfo, stats, highJcr, lowJcr) {
  const histogramHTML = window.JCRReportUtils.generateHistogramHTML(lattesInfo, highJcr, lowJcr);
  const papersPerYearHTML = window.JCRReportUtils.generatePapersPerYearGraphHTML(lattesInfo, highJcr, lowJcr);
  const authorRankHistogramHTML = window.JCRReportUtils.generateAuthorRankHistogramHTML(lattesInfo, highJcr, lowJcr, true, true);
  const supervisionsPerYearHTML = window.JCRReportUtils.generateSupervisionsPerYearGraphHTML(stats.supervisions);

  return `
    <div style="width: 100%;">
        ${togglesHTML}
    </div>
    <div style="width: 100%; display: flex; flex-direction: column; gap: 10px;" id="graphs-wrapper">
      <div class="rodape-cv" style="margin-top: 0px; color: ${COLORS.footerText}; font-size: 1.1em;">
        <table style="width: 100%; border-collapse: collapse; text-align: center; font-family: inherit; font-size: 0.9em;">
          <thead>
            <tr style="background-color: ${COLORS.backgroundHeader}; border-bottom: 1px solid ${COLORS.border};">
              <th style="padding: 8px; text-align: left;">
                <span class="toggle-table-btn" data-target="graficos" style="cursor: pointer; user-select: none; margin-right: 5px;">${setaRecolher(jcrTablesState.graficos)}</span> Gráficos
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
    </div>`;
}

// Resumo do painel compacto (Lattes novo): doze cartoes com os numeros que mais se
// consultam, sempre a vista; o detalhe fica nas tabelas, que comecam recolhidas. Cada
// cartao traz o total da carreira e, embaixo, o dos ultimos 5 anos ou o dado vizinho.
function resumoDoCvHTML(stats, startYearRecent, maxYear, targetAuthorRank) {
  const U = window.JCRReportUtils;
  const tudo = stats.all, cinco = stats.recent;
  const concluidas = (tipo) => { const l = stats.supervisions && stats.supervisions.concluded && stats.supervisions.concluded[tipo]; return Array.isArray(l) ? l.length : 0; };
  const periodo = `5 anos (${startYearRecent}–${maxYear})`;
  // Citacoes e indice H: sempre os CALCULADOS das citacoes que o Lattes traz, direto das
  // bases, em cada artigo da lista. Os "declarados" dependem de o pesquisador preencher
  // os indicadores de Scopus e ResearcherID, o que muitos nao fazem; continuam na tabela
  // "Citacoes", na linha "Declarado".
  const hWos = tudo.citations.wos.hIndex, hScopus = tudo.citations.scopus.hIndex;
  const cWos = tudo.citations.wos.sum, cScopus = tudo.citations.scopus.sum;
  const rank = U.rankAlvoEfetivo(targetAuthorRank);
  const emAndamento = (stats.supervisions && stats.supervisions.inCourse) || {};
  const totalEmAndamento = Object.values(emAndamento).reduce((s, n) => s + (n || 0), 0);
  // um cartao de dado desligado (JCRReportUtils.*_ATIVO) fica com traco, em cinza
  // (embaixo vai a forma curta, que cabe no cartao; a completa fica na dica)
  const desligado = (rotulo) => [rotulo, '—', 'Desabilitado', U.TEXTO_DESABILITADO, true];
  // Doze cartoes, em tres linhas de quatro na largura cheia: impacto | citacoes e
  // autoria | autoria e formacao de pessoal.
  const cartoes = [
    ['Artigos', tudo.total.count, `${periodo}: ${cinco.total.count}`, 'Artigos completos publicados em periódicos'],
    ['Soma do JCR', U.formatNum(tudo.total.sum), `${periodo}: ${U.formatNum(cinco.total.sum)}`, 'Soma dos fatores de impacto dos artigos'],
    ['JCR médio', U.getAvg(tudo.total.sum, tudo.total.countWithJcr), `${periodo}: ${U.getAvg(cinco.total.sum, cinco.total.countWithJcr)}`, 'Soma do JCR dividida pelos artigos com JCR'],
    [`JCR alto (≥ ${stats.highJcr})`, tudo.high.count, `${periodo}: ${cinco.high.count}`, 'Artigos na faixa alta de fator de impacto'],
    ['Índice H (WoS)', hWos, `Scopus: ${hScopus}`, 'Índice H calculado a partir das citações de cada artigo da lista (Web of Science e Scopus)'],
    ['Citações (WoS)', cWos, `Scopus: ${cScopus}`, 'Soma das citações de cada artigo da lista (Web of Science e Scopus)'],
    [`${rank}º autor`, tudo.total.firstAuthorCount, `${periodo}: ${cinco.total.firstAuthorCount}`, `Artigos como ${rank}º autor`],
    U.ULTIMO_AUTOR_ATIVO
      ? ['Último autor', tudo.total.lastAuthorCount, `${periodo}: ${cinco.total.lastAuthorCount}`, 'Artigos como último autor']
      : desligado('Último autor'),
    U.MEDIA_DE_AUTORES_ATIVA
      ? ['Autores por artigo', U.getAvg(tudo.total.sumAuthorsNonGc, tudo.total.countNonGc), `${periodo}: ${U.getAvg(cinco.total.sumAuthorsNonGc, cinco.total.countNonGc)}`, 'Número médio de autores por artigo (sem grandes colaborações)']
      : desligado('Autores por artigo'),
    ['Doutorados', concluidas('Tese de doutorado'), `Mestrados: ${concluidas('Dissertação de mestrado')}`, 'Orientações concluídas de doutorado e de mestrado'],
    ['Orientações em andamento', totalEmAndamento, `Doutorado: ${emAndamento['Tese de doutorado'] || 0} · Mestrado: ${emAndamento['Dissertação de mestrado'] || 0}`, 'Orientações em andamento, de todos os tipos'],
    ['Patentes', (tudo.patents && tudo.patents.total) || 0, `Pós-doutorados: ${concluidas('Supervisão de pós-doutorado')}`, 'Patentes e supervisões de pós-doutorado concluídas']
  ];
  return `
    <div id="jcr-report-resumo" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 0 0 10px;">
      ${cartoes.map(([rotulo, valor, embaixo, dica, apagado]) => `
      <div title="${escHtml(dica)}" style="background: #fff; border: 1px solid #d5dde6; border-radius: 8px; padding: 8px 10px; min-width: 0;">
        <div style="font-size: 12px; color: #2f3b4a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escHtml(rotulo)}</div>
        <div style="font-size: 20px; font-weight: 700; color: ${apagado ? '#8a94a1' : '#1b3a6b'}; line-height: 1.25;">${escHtml(String(valor))}</div>
        <div style="font-size: 12px; color: ${apagado ? '#6b7684' : '#3d4a5c'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escHtml(embaixo)}</div>
      </div>`).join('')}
    </div>`;
}

function montarPainelDoCv(stats, startYearRecent, startYearLast10, startYearCustom, customYears, currentYear, highJcr, lowJcr, nameLink, minYear, maxYear, lattesInfo, targetAuthorRank) {
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
            <th class="jcr-main-header-cell" colspan="${jcrTablesState.publicacoes ? 15 : 1}" style="padding: 8px; text-align: left; vertical-align: middle;">
              <span class="toggle-table-btn" data-target="publicacoes" style="cursor: pointer; user-select: none; margin-right: 5px;">${setaRecolher(jcrTablesState.publicacoes)}</span> Publicações
            </th>
            <th class="jcr-main-header-extra" rowspan="2" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; padding: 8px; border-left: 1px solid #ccc; text-align: center; background-color: ${bgTotal};" title="Quantidade total de artigos">Qtd</th>
            <th class="jcr-main-header-extra" colspan="2" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; padding: 8px; border-left: 1px solid #eee; text-align: center; background-color: #ffffff;" title="Métricas de Fator de Impacto (JCR)">JCR</th>
            <th class="jcr-main-header-extra" colspan="3" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; padding: 8px; border-left: 1px solid #eee; text-align: center; background-color: ${bgTotal};" title="Estatísticas de Autoria">Autores</th>
            <th class="jcr-main-header-extra" rowspan="2" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; padding: 8px; border-left: 1px solid #ccc; vertical-align: middle; text-align: center;" title="${window.JCRReportUtils.GRANDES_COLABORACOES_ATIVAS ? 'Grandes Colaborações (et al. ou COLLABORATION)' : window.JCRReportUtils.TEXTO_DESABILITADO}">GC</th>
            <th class="jcr-main-header-extra" colspan="2" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; padding: 8px; border-left: 1px solid #ccc; text-align: center; background-color: ${bgHigh};" title="Artigos com Fator de Impacto Alto">
              JCR Alto (≥ ${highJcr})
            </th>
            <th class="jcr-main-header-extra" colspan="2" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; padding: 8px; border-left: 1px solid #ccc; text-align: center; background-color: ${bgMid};" title="Artigos com Fator de Impacto Médio">
              JCR Médio (≥ ${lowJcr})
            </th>
            <th class="jcr-main-header-extra" colspan="2" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; padding: 8px; border-left: 1px solid #ccc; text-align: center; background-color: ${bgLow};" title="Artigos com Fator de Impacto Baixo">JCR Baixo (< ${lowJcr})</th>
            <th class="jcr-main-header-extra" rowspan="2" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; padding: 8px; border-left: 1px solid #ccc; vertical-align: middle; text-align: center; background-color: ${bgNone};" title="Artigos sem Fator de Impacto classificado">Sem JCR</th>
          </tr>
          <tr class="jcr-main-header-subrow" style="display: ${jcrTablesState.publicacoes ? 'none' : ''}; background-color: ${COLORS.backgroundSubHeader}; border-bottom: 2px solid ${COLORS.border}; font-size: 0.85em;">
            <th style="padding: 4px; text-align: center;" title="Intervalo de anos analisado">Período</th>
            <!-- Total Sub-headers -->
            <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: #ffffff;" title="Soma total dos Fatores de Impacto">Σ</th>
            <th style="padding: 4px; text-align: center; background-color: #ffffff;" title="Média do Fator de Impacto (Soma / Artigos com JCR)">μ</th>
            
            <th id="th-author-rank-header" style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgTotal};" title="Quantidade de artigos como ${targetAuthorRank}º Autor">${targetAuthorRank}o</th>
            <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgTotal};" title="${window.JCRReportUtils.ULTIMO_AUTOR_ATIVO ? 'Quantidade de artigos como Último Autor' : window.JCRReportUtils.TEXTO_DESABILITADO}">Últ</th>
            <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgTotal};" title="${window.JCRReportUtils.MEDIA_DE_AUTORES_ATIVA ? 'Média de autores por artigo (exclui Grandes Colaborações)' : 'Temporariamente desabilitado'}">μ</th>
            <!-- High Sub-headers -->
            <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgHigh};" title="Quantidade de artigos nesta faixa">Qtd</th>
            <th style="padding: 4px; text-align: center; background-color: ${bgHigh};" title="Média do Fator de Impacto nesta faixa">μ</th>
            <!-- Mid Sub-headers -->
            <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgMid};" title="Quantidade de artigos nesta faixa">Qtd</th>
            <th style="padding: 4px; text-align: center; background-color: ${bgMid};" title="Média do Fator de Impacto nesta faixa">μ</th>
            <!-- Low Sub-headers -->
            <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgLow};" title="Quantidade de artigos nesta faixa">Qtd</th>
            <th style="padding: 4px; text-align: center; background-color: ${bgLow};" title="Média do Fator de Impacto nesta faixa">μ</th>
          </tr>
        </thead>
        <tbody id="tbody-publicacoes" style="display: ${jcrTablesState.publicacoes ? 'none' : ''};">
          ${window.JCRReportUtils.corpoTabelaPublicacoes(stats,
            { min: minYear, max: maxYear, last10: startYearLast10, recent: startYearRecent },
            `${customYears} ${customYears == 1 || customYears == 0 ? 'ano' : 'anos'} (${startYearCustom} - ${maxYear})`)}
        </tbody>
      </table>
    </div>`;


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

  const citationTableHTML = molduraTabelaCv({
      chave: 'citacoes', titulo: 'Citações', totalCols: 5,
      corpo: `${declaredHTML}
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
          </tr>`,
      colunas: [
        colunaTabelaCv('citacoes', `Citações Web of Science`, `Total de citações extraídas da Web of Science`),
        colunaTabelaCv('citacoes', `Índice H Web of Science`, `Índice H calculado a partir das citações da Web of Science`),
        colunaTabelaCv('citacoes', `Citações Scopus`, `Total de citações extraídas da Scopus`),
        colunaTabelaCv('citacoes', `Índice H Scopus`, `Índice H calculado a partir das citações da Scopus`),
      ].join('')
    });

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

      supervisionTableHTML = molduraTabelaCv({
      chave: 'orientacoes', titulo: 'Orientações', totalCols: 6,
      corpo: `${rows}`,
      colunas: [
        colunaTabelaCv('orientacoes', `Em Andamento`, `Total de orientações atualmente em curso`),
        colunaTabelaCv('orientacoes', `Concluídas`, `Total histórico de orientações concluídas`),
        colunaTabelaCv('orientacoes', `10 Anos`, `Orientações concluídas nos últimos 10 anos`),
        colunaTabelaCv('orientacoes', `5 Anos`, `Orientações concluídas nos últimos 5 anos`),
        colunaTabelaCv('orientacoes', `${customYears} ${customYears == 1 || customYears == 0 ? 'Ano' : 'Anos'}`, `Orientações concluídas nos últimos ${customYears} anos`),
      ].join('')
    });
    }
  }

  // Patent Table
  let patentTableHTML = '';
  if (stats.all.patents.total > 0) {
    const rowsHtml = window.JCRReportUtils.corpoTabelaContagens(stats, 'patents', 'statusCounts');

    patentTableHTML = molduraTabelaCv({
      chave: 'patentes', titulo: 'Patentes', totalCols: 5, corpo: rowsHtml,
      colunas: [
        colunaTabelaCv('patentes', `Total (${minYear} - ${maxYear})`, `Total de patentes (todos os anos)`),
        colunaTabelaCv('patentes', `10 Anos (${startYearLast10} - ${maxYear})`, `Patentes registradas nos últimos 10 anos`),
        colunaTabelaCv('patentes', `5 Anos (${startYearRecent} - ${maxYear})`, `Patentes registradas nos últimos 5 anos`),
        colunaTabelaCv('patentes', `${customYears} ${customYears == 1 || customYears == 0 ? 'Ano' : 'Anos'} (${startYearCustom} - ${maxYear})`, `Patentes registradas nos últimos ${customYears} anos`),
      ].join('')
    });
  }

  // Event Table
  let eventTableHTML = '';
  if (stats.all.events.total > 0) {
    const rowsHtml = window.JCRReportUtils.corpoTabelaContagens(stats, 'events', 'typeCounts');

    eventTableHTML = molduraTabelaCv({
      chave: 'eventos', titulo: 'Participação em Eventos', totalCols: 5, corpo: rowsHtml,
      colunas: [
        colunaTabelaCv('eventos', `Total (${minYear} - ${maxYear})`, `Total de participações em eventos (todos os anos)`),
        colunaTabelaCv('eventos', `10 Anos (${startYearLast10} - ${maxYear})`, `Participações em eventos nos últimos 10 anos`),
        colunaTabelaCv('eventos', `5 Anos (${startYearRecent} - ${maxYear})`, `Participações em eventos nos últimos 5 anos`),
        colunaTabelaCv('eventos', `${customYears} ${customYears == 1 || customYears == 0 ? 'Ano' : 'Anos'} (${startYearCustom} - ${maxYear})`, `Participações em eventos nos últimos ${customYears} anos`),
      ].join('')
    });
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
      /* botao de liga/desliga sem caixa de selecao (salvamento automatico) */
      .jcr-icon-btn.jcr-icon-ligado { background: #e8f5e9; border-color: #4CAF50; }
      .jcr-icon-btn.jcr-icon-desligado { filter: grayscale(1); opacity: 0.45; }
      /* a barra: tres grupos (banco de dados | este curriculo | exibicao) */
      .jcr-barra { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
      /* painel recolhido: fica so o cabecalho */
      #annotation-alert-div.jcr-painel-recolhido #jcr-report-resumo,
      #annotation-alert-div.jcr-painel-recolhido #jcr-report-content { display: none !important; }
      #annotation-alert-div.jcr-painel-recolhido #jcr-report-header { margin-bottom: 0 !important; }
      .jcr-barra .jcr-sep { width: 1px; height: 20px; background: #cfd6de; margin: 0 5px; }
      #jcr-db-tools-mount { display: inline-flex; align-items: center; gap: 4px; }
      ${PAGINA.painelCompacto ? `
      /* painel compacto (Lattes novo): cabe na coluna do curriculo, de 800 px */
      #annotation-alert-div #jcr-report-header { flex-wrap: wrap; gap: 6px; margin-bottom: 10px !important; padding: 8px 10px !important; }
      #annotation-alert-div #jcr-report-header h2 { font-size: 1.05em !important; }
      /* o nome ja esta no cartao ao lado; sem ele o cabecalho cabe numa linha */
      #annotation-alert-div #jcr-report-name { display: none; }
      #annotation-alert-div #jcr-db-tools-mount button, #annotation-alert-div #jcr-db-tools-mount label { white-space: nowrap; }
      #annotation-alert-div #jcr-report-content th, #annotation-alert-div #jcr-report-tables td { padding: 5px 4px !important; font-size: 12px; }
      /* janela estreita: a coluna encolhe; a tabela larga rola dentro do bloco e os botoes quebram de linha */
      #annotation-alert-div #jcr-report-tables .rodape-cv { margin-top: 6px !important; overflow-x: auto; }
      #annotation-alert-div #jcr-report-header > div { flex-wrap: wrap; row-gap: 6px; }
      #annotation-alert-div #jcr-report-tables .jcr-main-header-cell { cursor: pointer; }
      ` : ''}
    </style>
    <div id="jcr-report-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px; padding: 10px; background-color: ${COLORS.backgroundHeader}; border-bottom: 2px solid ${COLORS.border}; border-radius: 4px;">
      <h2 id="jcr-painel-toggle" title="Recolher ou expandir o painel do JCR Lattes" style="margin: 0; font-size: 1.25em; color: ${COLORS.footerText}; font-weight: bold; cursor: pointer; user-select: none;"><span id="jcr-painel-seta" style="display: inline-block; width: 18px;">${setaRecolher(jcrPainelRecolhido)}</span>JCR Lattes Report <span id="jcr-report-name" style="color: #326C99; font-weight: normal; margin-left: 5px;">- ${escHtml(nameLink.name)}</span></h2>
      <div class="jcr-barra">
        <!-- 1. banco de dados (preenchido por JCRDBTools.renderUI): abrir, salvar, salvamento automatico -->
        <span id="jcr-db-tools-mount"></span>
        <span class="jcr-sep"></span>
        <!-- 2. este curriculo -->
        <button id="btn-view-cv-report" class="jcr-icon-btn" title="Abrir o relatório individual deste currículo numa nova aba">📊</button>
        <button id="btn-save-cv-html" class="jcr-icon-btn" title="Baixar uma cópia deste currículo em arquivo HTML (pasta Downloads/lattesData)">💾</button>
        <span class="jcr-sep"></span>
        <!-- 3. o que aparece na pagina -->
        <label class="jcr-icon-toggle" title="Mostrar ou ocultar as tabelas e os gráficos deste painel">
          <input type="checkbox" id="toggle-disable-report">
          <span class="jcr-icon-face">📈</span>
        </label>
        <label class="jcr-icon-toggle" title="Mostrar ou ocultar as anotações nos artigos (fator de impacto, autoria, separadores de ano)">
          <input type="checkbox" id="toggle-disable-extra-info">
          <span class="jcr-icon-face">🏷️</span>
        </label>
        <button id="btn-jcr-opcoes" class="jcr-icon-btn" title="Opções: limiares de JCR, período customizado, cores e filtros">⚙️</button>
      </div>
    </div>
  `;

  // Preserva os botões do banco de dados já renderizados: o innerHTML abaixo
  // apaga o mount, e o re-render dos botões é assíncrono (loadSettings/RID).
  // Sem isso, os ícones somem/reaparecem a cada reprocessamento e a página "treme".

  return headerHTML + (PAGINA.painelCompacto ? resumoDoCvHTML(stats, startYearRecent, maxYear, targetAuthorRank) : '') + `
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
}

async function injectReportTable(stats, startYearRecent, startYearLast10, startYearCustom, customYears, currentYear, highJcr, lowJcr, nameLink, minYear, maxYear, lattesInfo, targetAuthorRank = 1) {
  const painelHTML = montarPainelDoCv(stats, startYearRecent, startYearLast10, startYearCustom,
    customYears, currentYear, highJcr, lowJcr, nameLink, minYear, maxYear, lattesInfo, targetAuthorRank);

  // create new alert div
  let alertDiv = document.querySelector('#annotation-alert-div');
  if (!alertDiv) {
    alertDiv = document.createElement('div');
    setAttributes(alertDiv, {
      class: 'max-width min-width', // Removed main-content class as it is now nested
      id: 'annotation-alert-div',
      // color-scheme: o Lattes novo declara esquema escuro quando o sistema está em modo
      // escuro, e os campos do painel (fundo branco) ficariam pretos com texto invisível.
      style: PAGINA.estiloDoPainel || `margin-bottom: 10px; border-bottom: 4px double ${COLORS.alertBorder}; padding-bottom: 10px; color-scheme: light;`
    });
    // onde o painel entra depende do formato da pagina (ver PAGINA)
    if (!PAGINA.inserirPainel(alertDiv)) {
      console.log('JCR Lattes: lugar do painel não encontrado. Relatório não será injetado.');
      return;
    }
  }

  const prevDbMount = document.getElementById('jcr-db-tools-mount');

  alertDiv.innerHTML = painelHTML;
  alertDiv.classList.toggle('jcr-painel-recolhido', jcrPainelRecolhido);
  const painelToggle = alertDiv.querySelector('#jcr-painel-toggle');
  if (painelToggle) {
    painelToggle.addEventListener('click', () => {
      jcrPainelRecolhido = !jcrPainelRecolhido;
      alertDiv.classList.toggle('jcr-painel-recolhido', jcrPainelRecolhido);
      const seta = alertDiv.querySelector('#jcr-painel-seta');
      if (seta) seta.innerHTML = setaRecolher(jcrPainelRecolhido);
      saveSettings();
    });
  }

  if (prevDbMount && prevDbMount.childNodes.length > 0) {
    const newMount = alertDiv.querySelector('#jcr-db-tools-mount');
    if (newMount) newMount.replaceWith(prevDbMount);
  }

  const reportContent = alertDiv.querySelector('#jcr-report-content');

  // --- Section Toggles ---
  const sections = PAGINA.secoesRecolhiveis ? getSections() : [];
  sections.forEach(s => {
    s.element.style.display = '';
    if (s.footerElement) s.footerElement.style.display = '';
  });

  // Titulos das secoes viram controles de recolher/expandir (substituem os checkboxes)
  setupCollapsibleSections(sections);
  setupGeneralInfoGroup(sections);

  const savedOpcoes = await loadSettings();
  const opcoes = window.JCRReportUtils.opcoesEfetivas(savedOpcoes);
  lembrarFiltrosAtual = opcoes.lembrarFiltros;
  // os valores desta montagem (que podem ter vindo dos campos, antes de gravar)
  Object.assign(opcoes, { highJcr, lowJcr, customYears, targetAuthorRank });
  opcoes.cores = { high: COLORS.highJcr, mid: COLORS.midJcr, low: COLORS.lowJcr, none: COLORS.noJcr };
  const togglesHTML = generateSectionToggles(opcoes);

  // Append toggles to the reportContent
  const toggleContainer = document.createElement('div');
  toggleContainer.style.display = 'flex';
  toggleContainer.style.flexDirection = 'column';
  toggleContainer.style.gap = '10px';

  toggleContainer.innerHTML = montarAreaDeGraficos(togglesHTML, lattesInfo, stats, highJcr, lowJcr);
  reportContent.appendChild(toggleContainer);

  // --- Cache DB Elements ---
  const cachedPubElems = Array.from(articlesRoot().querySelectorAll(PAGINA.seletorArtigoAnotado)).map(el => {
    const yearStr = el.getAttribute('data-year');
    const rankStr = el.getAttribute('data-author-rank');
    return {
      el: el,
      level: el.getAttribute('data-jcr-level'),
      year: yearStr ? parseInt(yearStr) : NaN,
      authorRank: rankStr ? parseInt(rankStr) : -1,
      isFirst: el.getAttribute('data-is-first') === 'true',
      // "ultimo autor" desligado: ninguem e ultimo para os filtros (vira "outras posicoes")
      isLast: window.JCRReportUtils.ULTIMO_AUTOR_ATIVO && el.getAttribute('data-is-last') === 'true',
      isGc: window.JCRReportUtils.GRANDES_COLABORACOES_ATIVAS && el.getAttribute('data-is-gc') === 'true'
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

    // 3. JCR Levels (os filtros so voltam se "lembrar filtros" estiver ligado; o
    // dialogo ja nasce com os valores efetivos, aqui so os campos da tabela)
    const filtrosEfetivos = window.JCRReportUtils.opcoesEfetivas(saved).filtros;
    ['high', 'mid', 'low', 'none'].forEach(level => {
      const savedVal = filtrosEfetivos.jcr[level];
      const cb = document.getElementById(`toggle-jcr-${level}`);
      if (cb && savedVal !== undefined) cb.checked = savedVal;
      const tCb = document.getElementById(`tbl-chk-${level}`);
      if (tCb && savedVal !== undefined) tCb.checked = savedVal;
    });

    // 4. Period
    {
      const radio = document.querySelector(`input[name="toggle-period"][value="${filtrosEfetivos.period}"]`);
      if (radio) radio.checked = true;
    }

    // 5. Author Roles
    ['first', 'last', 'others', 'gc'].forEach(role => {
      const savedVal = filtrosEfetivos.author[role];
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

  window.JCRReportUtils.ligarDialogoOpcoes(document, IDS_OPCOES_CV);
  const lembrarCb = document.getElementById(IDS_OPCOES_CV.lembrar);
  if (lembrarCb) lembrarCb.addEventListener('change', () => {
    lembrarFiltrosAtual = lembrarCb.checked;
    saveSettings();
  });

  // Apply visibility based on JCR/Period/Author (Initial Refresh).
  // Fora do bloco de settings salvos para funcionar também na primeira execução.

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
      // (ex.: limiares de JCR, campo de anos)
      if (e.target !== header && e.target.closest && e.target.closest('input, select, label, a, button')) return;

      e.stopPropagation();
      const tbody = document.getElementById('tbody-' + targetId);
      if (tbody) {
        if (tbody.style.display === 'none') {
          tbody.style.display = '';
          btn.innerHTML = setaRecolher(false);
          jcrTablesState[targetId] = false;
        } else {
          tbody.style.display = 'none';
          btn.innerHTML = setaRecolher(true);
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
              totalCols = 15;
            }
            headerCell.setAttribute('colspan', isCollapsed ? totalCols : 1);
          }
          if (subRow) subRow.style.display = isCollapsed ? 'none' : '';
          extraCells.forEach(cell => cell.style.display = isCollapsed ? 'none' : '');
        }
        if (targetId === 'citacoes') {
          const ridTabela = document.getElementById('rid-stats-table');
          if (ridTabela) ridTabela.style.display = jcrTablesState.citacoes ? 'none' : '';
        }

        saveSettings();
      }
    });
  });

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

  // Botão de salvar o CV em HTML: sob demanda, nunca automático
  const saveCvHtmlBtn = document.getElementById('btn-save-cv-html');
  if (saveCvHtmlBtn && !PAGINA.salvarHtml) saveCvHtmlBtn.style.display = 'none';
  if (saveCvHtmlBtn && PAGINA.salvarHtml) {
    saveCvHtmlBtn.addEventListener('click', () => saveCvHtmlFile(nameLink, saveCvHtmlBtn));
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
  // A tabela de publicacoes mostra sempre o curriculo inteiro: os filtros valem para a
  // lista de artigos e para os graficos. (Havia uma caixa "Filtrar" que recalculava a
  // tabela com os filtros; saiu em 2026-11-25 — o relatorio individual faz isso.)
  function refreshPubFilters() {
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
      const targetRank = window.JCRReportUtils.rankAlvoEfetivo(parseInt(document.getElementById('target-author-rank-input')?.value) || targetAuthorRank || 1);
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
              // a tabela do ResearcherID faz parte do bloco "Citações": aparece e some com ele
              const ridTabela = document.getElementById('rid-stats-table');
              if (ridTabela) ridTabela.style.display = jcrTablesState.citacoes ? 'none' : '';
          }
      };

      if (BUSCAR_RID && nameLink.researcherIdLink) {
          if (window.cachedRidStats) {
              const ridStatsOrNull = window.cachedRidStats._failed ? null : window.cachedRidStats;
              if (ridStatsOrNull) injectRidTable(ridStatsOrNull);
              if (typeof window.JCRDBTools !== 'undefined') {
                  window.JCRDBTools.init('jcr-db-tools-mount', nameLink, stats, lattesInfo, ridStatsOrNull);
              }
          } else if (!window.isFetchingRidStats) {
              window.isFetchingRidStats = true;

              // Os botoes do banco de dados entram ja, sem esperar o ResearcherID (a busca
              // la pode levar dezenas de segundos). init() sabe que o RID esta pendente: um
              // CV novo com salvamento automatico so e gravado quando ele chegar, e o init
              // de novo, com os dados do RID, acontece na remontagem ao fim da busca.
              if (typeof window.JCRDBTools !== 'undefined') {
                  window.JCRDBTools.init('jcr-db-tools-mount', nameLink, stats, lattesInfo, null);
              }
              
              // Se o ResearcherID deste pesquisador ja foi buscado hoje (data gravada no
              // banco), reaproveita: a busca abre uma aba oculta no Web of Science e nao
              // vale repeti-la a cada leitura do curriculo no mesmo dia.
              const idLattesDoCv = ((nameLink.link || '').match(/\b\d{16}\b/) || [''])[0];
              const jaBuscadoHoje = (typeof window.JCRDBTools !== 'undefined' && typeof window.JCRDBTools.ridGravadoHoje === 'function')
                  ? window.JCRDBTools.ridGravadoHoje(nameLink.name, idLattesDoCv) : Promise.resolve(null);
              jaBuscadoHoje.then((gravado) => {
              if (gravado) {
                  console.log('[RID Extraction Content Script] ResearcherID já atualizado hoje; usando os dados do banco.');
                  window.cachedRidStats = gravado;
                  window.isFetchingRidStats = false;
                  hideLoading();
                  processLattesPage(nameLink);
                  return;
              }

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
                          // a data da busca acompanha os dados e vai para o banco (ridUpdatedAt)
                          window.cachedRidStats = Object.assign({}, response.stats, { atualizadoEm: new Date().toISOString() });
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
              });
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
  // Lattes novo: so as secoes abertas tem conteudo na pagina, e a extensao abre apenas
  // as que le. Para a copia sair com o CV inteiro, abre todas, copia e fecha de volta
  // as que estavam fechadas. Com a lista de artigos incompleta (aba em segundo plano)
  // nao ha copia: sairia pela metade.
  let abertasParaACopia = [];
  if (LATTES_NOVO) {
    const fechadas = Array.from(document.querySelectorAll('button.accordion-header[aria-expanded="false"]'));
    const pronta = await LEITOR.prepararPagina(document, {});
    if (!pronta.completo) throw new Error('a página ainda não carregou o currículo inteiro; deixe a aba visível e tente de novo');
    abertasParaACopia = fechadas;
  }

  const clone = document.documentElement.cloneNode(true);
  abertasParaACopia.forEach(botao => {
    if (botao.isConnected && botao.getAttribute('aria-expanded') === 'true') botao.click();
  });

  if (LATTES_NOVO) {
    // O site novo poe <div> dentro de <p> (o balao do JCR e das citacoes). Isso existe
    // no DOM montado por script, mas nao sobrevive a um arquivo: ao reabrir, o
    // navegador fecha o <p> antes do <div> e o artigo perde ano, JCR e citacoes.
    // Na copia cada um vira <span>, que pode ficar dentro de <p>.
    Array.from(clone.querySelectorAll('p div')).reverse().forEach(div => {
      const span = document.createElement('span');
      Array.from(div.attributes).forEach(a => span.setAttribute(a.name, a.value));
      while (div.firstChild) span.appendChild(div.firstChild);
      div.replaceWith(span);
    });
    // artigos ocultos pelos filtros da extensao voltam a aparecer na copia
    clone.querySelectorAll(PAGINA.seletorArtigoAnotado).forEach(li => { if (li.style.display === 'none') li.style.display = ''; });
  }
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
  clone.querySelectorAll('.jcr-section-toggle, h1.jcr-section-title, .jcr-group-header').forEach(el => el.remove());
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
    if (icone) icone.innerHTML = setaRecolher(false);
  });

  // Os icones de link do Lattes (DOI, INPI, curriculo de coautor) sao sprites baixados
  // do servidor: na copia salva viram um retangulo vazio e o link so se revela ao passar
  // o mouse. Cada um deles ganha um icone de link desenhado no proprio arquivo — pela
  // posicao no CV ja se sabe para onde o link leva.
  const ICONE_LINK =
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" '
    + 'fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" '
    + 'stroke-linejoin="round" style="vertical-align: middle;">'
    + '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>'
    + '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'
    + '</svg>';

  clone.querySelectorAll('a[href]').forEach(a => {
    const href = (a.getAttribute('href') || '').trim();
    // Ancoras internas (#secao) e javascript: nao levam a lugar nenhum na copia
    if (!/^https?:/i.test(href)) return;
    // So os links sem nada visivel: os que tem texto ou imagem propria ja se anunciam
    if (a.textContent.trim() !== '' || a.querySelector('img, svg')) return;
    // A barra do topo do Lattes (fonte, contraste, ajuda) nao faz parte do curriculo
    const classes = (a.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    if (classes.some(c => c === 'bt-menu-header' || c.indexOf('icons-top') === 0)) return;

    // Sem as classes de sprite o link deixa de reservar o retangulo vazio
    const restantes = classes.filter(c => c.indexOf('icone-') !== 0 && c.indexOf('icons-') !== 0);
    if (restantes.length > 0) a.setAttribute('class', restantes.join(' '));
    else a.removeAttribute('class');

    if (!a.getAttribute('title')) a.setAttribute('title', href);
    a.style.cssText = 'display: inline-block; width: auto; height: auto; background: none; '
      + 'margin: 0 4px 0 0; color: #3a52cb; text-decoration: none; line-height: 1;';
    a.innerHTML = ICONE_LINK;
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

  // Trava de execucao em curso. processLattesPage roda a cada re-render do relatorio
  // (chegada dos JCR, do RID, mudanca de filtro) e cada passagem agenda o seu proprio
  // salvamento. Entre a entrada aqui e a marca __jcrCvProposalSaveDone ha DUAS leituras
  // completas de chrome.storage (findProposalsForResearcher -> getDB -> get(null)), que
  // num banco grande levam tempo de sobra para uma segunda chamada entrar e salvar de
  // novo: dois downloads do mesmo arquivo, e o Chrome abre "Salvar como" no segundo
  // porque nao consegue sobrescrever o que o primeiro ainda esta escrevendo.
  if (window.__jcrCvProposalSaveEmCurso) return;
  window.__jcrCvProposalSaveEmCurso = true;

  try {
    // Lattes novo com a pagina ainda incompleta (os numeros vieram da API): a copia
    // fica para a proxima passagem, depois que a pagina completar.
    if (curriculoPelaApi) return;

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

    // Sem proposta esperando por este CV nao ha o que salvar: sai antes de montar a
    // copia autossuficiente, que clona a pagina e embute CSS e imagens.
    const propostasAlvo = (typeof DB.findProposalsForResearcher === 'function')
        ? await DB.findProposalsForResearcher(lattesId, nome) : [];
    if (!propostasAlvo || propostasAlvo.length === 0) {
        window.__jcrCvProposalSaveDone = true;
        return;
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
  } finally {
    // libera em qualquer saida, inclusive nos returns do caminho de espera pelos JCR
    window.__jcrCvProposalSaveEmCurso = false;
  }
}

// Salva o CV num arquivo HTML autossuficiente, so quando o usuario clica no 💾. E a
// mesma copia que saveCvToProposalFolders grava nas pastas das propostas
// (buildStandaloneCvHtml: CV completo, sem os filtros da extensao, com CSS e imagens
// embutidos), mas vai para Downloads/lattesData/, valha o CV para proposta ou nao.
async function saveCvHtmlFile(nameLink, btn) {
  if (btn && btn.disabled) return;
  const DB = window.JCRDBTools;
  const lattesId = (DB && DB.currentCvData && DB.currentCvData.lattesId)
    || ((nameLink && nameLink.link) || '').match(/\b\d{16}\b/)?.[0] || '';
  const nome = (nameLink && nameLink.name) || '';
  const avisar = (msg, cor) => {
    if (DB && typeof DB.showToast === 'function') DB.showToast(msg, cor);
    else alert(msg);
  };

  // Com fatores de impacto ainda chegando, a copia sairia com artigos "Nao classificado"
  const pendentes = contarJcrPendentes();
  if (pendentes > 0 && !confirm(`Ainda faltam ${pendentes} fator(es) de impacto para carregar. `
      + 'A cópia sairá com esses artigos sem JCR.\n\nSalvar assim mesmo?')) {
    return;
  }

  const rotulo = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    const html = await buildStandaloneCvHtml();
    const nomeSeguro = (DB && typeof DB._nomeSeguro === 'function') ? DB._nomeSeguro(nome) : '';
    const partes = [nomeSeguro, lattesId ? `curriculo_lattes_${lattesId}` : 'curriculo_lattes'].filter(Boolean);
    const filename = `lattesData/${partes.join(' - ')}.html`;

    const res = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'download_data', data: html, filename }, (r) => {
          if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
          else resolve(r || { success: false, error: 'sem resposta do serviço da extensão' });
        });
      } catch (e) { resolve({ success: false, error: e.message }); }
    });

    if (res.success) {
      avisar(`CV salvo em Downloads/${filename}`, '#4CAF50');
    } else {
      avisar(`Não foi possível salvar o CV: ${res.error || 'erro desconhecido'}`, '#e53935');
    }
  } catch (e) {
    console.warn('JCRLattes: falha ao montar a cópia do CV', e);
    avisar(`Não foi possível montar a cópia do CV: ${e.message}`, '#e53935');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = rotulo || '💾'; }
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
      icone.innerHTML = setaRecolher(recolhido);
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

// Agrupa sob um unico titulo "Informacoes Gerais" as secoes que ficam entre o Resumo e a
// primeira secao de Producoes (Identificacao, Enderecos, Formacao, Atuacao, Idiomas...).
// Corresponde ao antigo checkbox "Dados gerais", que escondia todas de uma vez.
//
// O grupo esconde as SECOES INTEIRAS (o wrapper de cada uma); o recolher individual de
// cada titulo continua agindo sobre o conteudo dentro do wrapper. Como sao alvos
// diferentes, os dois estados convivem: ao reabrir o grupo, cada subsecao reaparece
// exatamente como o usuario a deixou.
const JCR_GRUPO_INFO_ID = '__grupo-info-gerais';

function setupGeneralInfoGroup(sections) {
  if (!Array.isArray(sections) || sections.length === 0) return;

  const idxProducao = sections.findIndex(s =>
    (s.label && /produ[çc]/i.test(s.label)) || (s.id && /producao/i.test(s.id)));
  if (idxProducao <= 0) return;

  const idxResumo = sections.findIndex(s => s.id === 'resumo');
  const inicio = idxResumo >= 0 ? idxResumo + 1 : 0;
  const grupo = sections.slice(inicio, idxProducao);
  if (grupo.length === 0) return;

  // Marca/desmarca com os mesmos atributos usados no recolher individual, para que o
  // salvamento do CV saiba reexpandir. O display e reaplicado mesmo quando o atributo ja
  // existe: a montagem do painel zera style.display de todas as secoes a cada render.
  const marcar = (el, recolhido) => {
    if (!el) return;
    if (recolhido) {
      if (!el.hasAttribute('data-jcr-collapsed')) {
        el.setAttribute('data-jcr-prev-display', el.style.display || '');
        el.setAttribute('data-jcr-collapsed', 'true');
      }
      el.style.display = 'none';
    } else if (el.hasAttribute('data-jcr-collapsed')) {
      el.style.display = el.getAttribute('data-jcr-prev-display') || '';
      el.removeAttribute('data-jcr-collapsed');
      el.removeAttribute('data-jcr-prev-display');
    }
  };

  let cabecalho = document.getElementById('jcr-group-info-gerais');
  let icone;

  if (!cabecalho) {
    const primeiro = grupo[0].element;
    if (!primeiro || !primeiro.parentNode) return;

    cabecalho = document.createElement('div');
    cabecalho.id = 'jcr-group-info-gerais';
    cabecalho.className = 'title-wrapper jcr-group-header';

    const titulo = document.createElement('h1');
    titulo.textContent = 'Informações Gerais';
    titulo.style.cursor = 'pointer';
    titulo.style.userSelect = 'none';
    titulo.title = 'Clique para recolher/expandir todas as informações gerais';

    icone = document.createElement('span');
    icone.className = 'jcr-section-toggle';
    icone.style.cssText = `display: inline-block; margin-right: 10px; font-size: 0.6em; font-weight: bold; font-family: monospace; vertical-align: middle; letter-spacing: -0.5px; color: ${COLORS.midJcr};`;
    titulo.insertBefore(icone, titulo.firstChild);

    cabecalho.appendChild(titulo);
    primeiro.parentNode.insertBefore(cabecalho, primeiro);

    titulo.addEventListener('click', (e) => {
      e.preventDefault();
      const recolhido = !(jcrSectionsCollapsed[JCR_GRUPO_INFO_ID] === true);
      jcrSectionsCollapsed[JCR_GRUPO_INFO_ID] = recolhido;
      aplicarGrupo(recolhido);
      saveSettings();
    });
  } else {
    icone = cabecalho.querySelector('.jcr-section-toggle');
  }

  function aplicarGrupo(recolhido) {
    grupo.forEach(sec => {
      marcar(sec.element, recolhido);
      marcar(sec.footerElement, recolhido);
    });
    if (icone) icone.innerHTML = setaRecolher(recolhido);
  }

  aplicarGrupo(jcrSectionsCollapsed[JCR_GRUPO_INFO_ID] === true);
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

// Ids dos controles de opcoes no CV. Sao os mesmos de antes, quando ficavam na faixa
// "Opcoes e Filtros" e na tabela de publicacoes: a logica que reage a eles (filtros,
// cores, recalculo) continua a mesma; so mudaram de lugar, para o dialogo da
// engrenagem, que e o mesmo dos relatorios (JCRReportUtils.dialogoOpcoesHTML).
const IDS_OPCOES_CV = {
  dialogo: 'jcr-opcoes-dialogo', abrir: 'btn-jcr-opcoes',
  high: 'high-jcr-input', low: 'low-jcr-input', custom: 'custom-year-input',
  rank: 'target-author-rank-input', rotuloRank: 'lbl-toggle-author-first',
  jcr: { high: 'toggle-jcr-high', mid: 'toggle-jcr-mid', low: 'toggle-jcr-low', none: 'toggle-jcr-none' },
  cor: { high: 'color-jcr-high', mid: 'color-jcr-mid', low: 'color-jcr-low', none: 'color-jcr-none' },
  autor: { first: 'toggle-author-first', last: 'toggle-author-last', others: 'toggle-author-others', gc: 'toggle-author-gc' },
  periodo: 'toggle-period', restaurar: 'jcr-opcoes-restaurar', lembrar: 'jcr-opcoes-lembrar'
};

// Dialogo de opcoes do CV, com os valores em uso nesta montagem do painel.
function generateSectionToggles(o) {
  return window.JCRReportUtils.dialogoOpcoesHTML({ ids: IDS_OPCOES_CV, o, comPeriodo: true });
}

function setAttributes(elem, attrs) {
  for (const key of Object.keys(attrs)) {
    elem.setAttribute(key, attrs[key]);
  }
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
  if (LATTES_NOVO) return LEITOR.lerCitacoesDeclaradas(document);
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
