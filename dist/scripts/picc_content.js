// picc_content.js
// Content script for Plataforma Carlos Chagas (piccTools)

(function () {
    // Setup PDF.js worker
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('scripts/pdf.worker.min.js');
    }

    // Acesso ao banco de dados.
    // O manifest injeta db_tools.js ANTES deste script, portanto window.JCRDBTools sempre existe.
    // Os fallbacks diretos para chrome.storage foram removidos: gravavam em chaves erradas
    // (descartando registros de CV silenciosamente) e ignoravam o parâmetro isProcessoOnly.
    function dbUnavailable(op) {
        console.error(`[piccTools] JCRDBTools indisponível: operação "${op}" abortada.`);
        const statusLabel = document.getElementById('picc-tools-status');
        if (statusLabel) {
            statusLabel.innerText = 'Erro interno: módulo de banco de dados não carregado. Recarregue a página.';
            statusLabel.style.color = '#ffcccc';
        }
    }

    async function safeGetDB(isProcessoOnly = true) {
        if (window.JCRDBTools && typeof window.JCRDBTools.getDB === 'function') {
            return await window.JCRDBTools.getDB(isProcessoOnly);
        }
        dbUnavailable('getDB');
        return [];
    }

    async function safeSaveDB(recordToSave) {
        if (window.JCRDBTools && typeof window.JCRDBTools.saveCVs === 'function') {
            const records = Array.isArray(recordToSave) ? recordToSave : [recordToSave];
            await window.JCRDBTools.saveCVs(records);
            return;
        }
        dbUnavailable('saveCVs');
    }

    // Sincronização de pesquisadores (proponente e equipe) com o banco de CVs do piccTools.
    //
    // Antes, cada pesquisador disparava getPiccCVs(), que faz chrome.storage.local.get(null)
    // e lê TODO o storage — inclusive base64 de anexos e HTMLs de pareceres. Uma proposta com
    // 15 membros custava 15 varreduras completas do storage. Agora o índice é carregado UMA vez
    // por lote e todas as gravações saem em um único set().
    let cvSyncById = null;     // Map<lattesId, {key, rec}>
    let cvSyncByName = null;   // Map<nome minúsculo, {key, rec}>
    let cvSyncDirty = null;    // Map<key, rec>
    let cvSyncRemovals = null; // Set<key> (chaves antigas de registros que ganharam lattesId)

    function piccKeyOf(rec) {
        return window.JCRDBTools._piccCvStorageKey(rec);
    }

    async function beginCvSyncBatch() {
        cvSyncById = new Map();
        cvSyncByName = new Map();
        cvSyncDirty = new Map();
        cvSyncRemovals = new Set();
        if (!(window.JCRDBTools && typeof window.JCRDBTools.getPiccCVs === 'function')) return;
        try {
            const existing = await window.JCRDBTools.getPiccCVs();
            existing.forEach(rec => {
                if (!rec || rec.isProcesso) return;
                const entry = { key: piccKeyOf(rec), rec };
                if (rec.lattesId) cvSyncById.set(String(rec.lattesId).trim(), entry);
                if (rec.name) cvSyncByName.set(rec.name.trim().toLowerCase(), entry);
            });
        } catch (e) {
            console.warn('[piccTools] Falha ao carregar índice de CVs do piccTools:', e);
        }
    }

    function queueResearcherSync(name, lattesId = '', bolsa = '', formacao = '') {
        if (!name || name.trim() === '' || name.toLowerCase().includes('pesquisador estrangeiro')) return;
        if (!cvSyncDirty) return; // chamado fora de um lote
        try {
            const cleanName = name.trim();
            const cleanLattesId = (lattesId || '').trim();
            const cleanBolsa = (bolsa && bolsa !== '-') ? bolsa.trim() : '';
            const cleanFormacao = (formacao || '').trim();
            const nameKey = cleanName.toLowerCase();

            const found = (cleanLattesId && cvSyncById.get(cleanLattesId)) || cvSyncByName.get(nameKey) || null;

            if (found) {
                const rec = found.rec;
                let modified = false;
                if (cleanLattesId && !rec.lattesId) { rec.lattesId = cleanLattesId; modified = true; }
                if (cleanBolsa && (!rec.fellowshipString || rec.fellowshipString === '-')) {
                    rec.fellowshipString = cleanBolsa;
                    rec.bolsa = cleanBolsa;
                    modified = true;
                }
                if (cleanFormacao && (!rec.formacao || rec.formacao === '-')) { rec.formacao = cleanFormacao; modified = true; }

                // Se o registro ganhou lattesId, sua chave muda de :nm:<nome> para :id:<id>.
                // Removemos a chave antiga para não deixar um duplicado órfão no storage.
                const newKey = piccKeyOf(rec);
                if (newKey !== found.key) {
                    cvSyncRemovals.add(found.key);
                    cvSyncDirty.delete(found.key);
                    found.key = newKey;
                    modified = true;
                }
                if (modified) cvSyncDirty.set(found.key, rec);
                if (rec.lattesId) cvSyncById.set(String(rec.lattesId).trim(), found);
                cvSyncByName.set(nameKey, found);
            } else {
                const rec = {
                    name: cleanName,
                    lattesId: cleanLattesId,
                    fellowshipString: cleanBolsa || '-',
                    bolsa: cleanBolsa || '-',
                    formacao: cleanFormacao || '-',
                    isProcesso: false,
                    hasFullCv: false,
                    totalPapers: 0,
                    papersWithJcr: 0,
                    gcCount: 0,
                    firstAuthorCount: 0,
                    lastAuthorCount: 0,
                    wosHIndex: 0,
                    wosCitations: 0,
                    dateAdded: new Date().toISOString()
                };
                const entry = { key: piccKeyOf(rec), rec };
                cvSyncDirty.set(entry.key, rec);
                if (cleanLattesId) cvSyncById.set(cleanLattesId, entry);
                cvSyncByName.set(nameKey, entry);
            }
        } catch (e) {
            console.warn('[piccTools] Erro ao enfileirar pesquisador para sincronização:', name, e);
        }
    }

    async function flushCvSyncBatch() {
        if (!cvSyncDirty) return;
        const dirty = Array.from(cvSyncDirty.values());
        const removals = Array.from(cvSyncRemovals);
        cvSyncDirty = null; cvSyncById = null; cvSyncByName = null; cvSyncRemovals = null;
        try {
            if (removals.length > 0 && chrome.storage?.local) {
                await new Promise(r => chrome.storage.local.remove(removals, r));
            }
            if (dirty.length > 0 && window.JCRDBTools && typeof window.JCRDBTools.savePiccCVs === 'function') {
                await window.JCRDBTools.savePiccCVs(dirty);
            }
        } catch (e) {
            console.warn('[piccTools] Erro ao gravar lote de CVs do piccTools:', e);
        }
    }

    // Move conteúdos pesados (HTML de pareceres, base64 de anexos e do PDF, HTML do CV
    // congelado) do registro da proposta para a chave dedicada jcr_proc_blob:<processId>.
    // Sem isso, todo getDB() — que lê o storage inteiro — teria de desserializar megabytes
    // de base64 embutidos em cada proposta. O visualizador recarrega sob demanda.
    async function detachHeavyBlobs(record) {
        if (!record || !record.processId) return;
        const blobs = {};

        if (Array.isArray(record.reviews)) {
            record.reviews.forEach((rev, i) => {
                if (rev && typeof rev === 'object' && rev.html) {
                    blobs['review_' + i] = rev.html;
                    delete rev.html;
                }
            });
        }
        if (Array.isArray(record.attachments)) {
            record.attachments.forEach((att, i) => {
                if (att && att.data) {
                    blobs['att_' + i] = att.data;
                    delete att.data;
                }
            });
        }
        if (record.cvHtml) { blobs.cvHtml = record.cvHtml; delete record.cvHtml; }
        if (record.pdfData) { blobs.pdfData = record.pdfData; delete record.pdfData; }

        if (Object.keys(blobs).length > 0 && window.JCRDBTools && typeof window.JCRDBTools.saveProcBlobs === 'function') {
            try {
                await window.JCRDBTools.saveProcBlobs(record.processId, blobs);
            } catch (e) {
                console.warn('[piccTools] Falha ao salvar conteúdos da proposta:', record.processId, e);
            }
        }
    }

    // Helper to extract a valid HTTP/HTTPS URL from an anchor element
    function getValidUrlFromAnchor(a) {
        if (!a) return '';
        const rawHref = a.getAttribute('href') || a.href || '';
        if (rawHref.startsWith('http://') || rawHref.startsWith('https://')) {
            return rawHref;
        }
        if (rawHref && !rawHref.startsWith('javascript:') && !rawHref.startsWith('#')) {
            try {
                return new URL(rawHref, window.location.href).href;
            } catch (e) {}
        }
        const onclickStr = a.getAttribute('onclick') || '';
        const criptoMatch = onclickStr.match(/abrirJanelaCriptografada\s*\(\s*['"]?(\d+)['"]?\s*,\s*['"]?(\d+)['"]?\s*\)/);
        if (criptoMatch) {
            try {
                return new URL(`/efomento/caixadeentrada/visualizarProposta.do?metodo=visualizarProposta&codProposta=${criptoMatch[1]}&numeroProtocolo=${criptoMatch[2]}`, window.location.href).href;
            } catch (e) {}
        }
        const urlMatch = onclickStr.match(/(https?:\/\/[^\s'"]+|\/[^\s'"]+)/);
        if (urlMatch) {
            try {
                return new URL(urlMatch[1], window.location.href).href;
            } catch (e) {}
        }
        const dataUrl = a.dataset?.url || a.dataset?.href || a.getAttribute('data-url') || a.getAttribute('data-href');
        if (dataUrl) {
            try {
                return new URL(dataUrl, window.location.href).href;
            } catch (e) {}
        }
        return '';
    }

    // Helper to extract 16-digit Lattes ID and HTML content from cvLink
    async function extractLattesIdAndHtmlFromCvLink(cvLink) {
        if (!cvLink || typeof cvLink !== 'string') return { lattesId: '', htmlText: '' };

        let htmlText = '';
        let lattesId = '';

        // 1. Check if cvLink itself contains the 16-digit Lattes ID directly
        const directMatch = cvLink.match(/lattes\.cnpq\.br\/(\d{16})/) ||
                            cvLink.match(/id=(\d{16})/) ||
                            cvLink.match(/f_cod=(\d{16})/);
        if (directMatch) {
            lattesId = directMatch[1];
        }

        // 2. Fetch the CV page content to locate "Endereço para acessar este CV:http://lattes.cnpq.br/4441691798330519"
        try {
            console.log(`[piccTools] Carregando cvLink para extrair Lattes ID e HTML: ${cvLink}...`);
            
            // Try fetching via background script (bypasses cross-origin CORS between efomento.cnpq.br and plsql1.cnpq.br)
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                try {
                    const bgRes = await new Promise((resolve) => {
                        chrome.runtime.sendMessage({ action: 'fetch_url', url: cvLink }, (res) => {
                            if (chrome.runtime.lastError || !res || !res.success) {
                                resolve(null);
                            } else {
                                resolve(res.text);
                            }
                        });
                    });
                    if (bgRes) htmlText = bgRes;
                } catch (e) {}
            }

            // Fallback to direct fetch if background script fetch was not available
            if (!htmlText) {
                const response = await fetch(cvLink);
                if (response.ok) htmlText = await response.text();
            }

            if (htmlText) {
                // Priority extraction: Extract Lattes ID from "Endereço para acessar este CV:http://lattes.cnpq.br/7710288371318569"
                const addressMatch = htmlText.match(/Endere(?:&ccedil;|&#231;|&#xe7;|\u00e7|ç|.)o\s+para\s+acessar\s+este\s+CV\s*:\s*(?:<[^>]+>\s*)*https?:\/\/lattes\.cnpq\.br\/(\d{16})/i) ||
                                     htmlText.match(/Endere[\s\S]*?para\s+acessar\s+este\s+CV[\s\S]*?lattes\.cnpq\.br\/(\d{16})/i);

                if (addressMatch) {
                    lattesId = addressMatch[1];
                    console.log(`[piccTools] Lattes ID extraído com sucesso da linha "Endereço para acessar este CV": ${lattesId}`);
                } else {
                    const generalMatch = htmlText.match(/https?:\/\/lattes\.cnpq\.br\/(\d{16})/i) ||
                                         htmlText.match(/lattes\.cnpq\.br\/(\d{16})/i);
                    if (generalMatch) {
                        lattesId = generalMatch[1];
                        console.log(`[piccTools] Lattes ID extraído do HTML do CV: ${lattesId}`);
                    }
                }
            }
        } catch (e) {
            console.warn("[piccTools] Erro ao carregar cvLink para buscar Lattes ID:", cvLink, e);
        }

        // O CV congelado não expõe o nível de bolsa do proponente; a antiga
        // extractBolsaFromCvHtml() retornava '' sempre e foi removida.
        return { lattesId, htmlText };
    }

    function normalizeName(str) {
        if (!str) return '';
        return String(str)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isValidBolsa(b) {
        if (!b || typeof b !== 'string') return false;
        const clean = b.trim();
        if (clean === '' || clean === '-') return false;
        // Strict literal level match ONLY: PQ or DT followed by 1A, 1B, 1C, 1D, 2, SR
        return /^(PQ|DT)\s*[-–\s]?\s*(1A|1B|1C|1D|2|SR)$/i.test(clean);
    }

    // Implementação única em JCRReportUtils (report_utils.js), carregado antes deste
    // script tanto no efomento quanto na página do Lattes. Antes havia duas cópias.
    function makeSelfContainedHtml(htmlText, baseUrl) {
        if (window.JCRReportUtils && typeof window.JCRReportUtils.makeSelfContainedHtml === 'function') {
            return window.JCRReportUtils.makeSelfContainedHtml(htmlText, baseUrl);
        }
        console.warn('[piccTools] JCRReportUtils.makeSelfContainedHtml indisponível.');
        return htmlText || '';
    }

    if (typeof window !== 'undefined') {
        window.makeSelfContainedHtml = makeSelfContainedHtml;
        window.parseProcessFromPDF = parseProcessFromPDF;
        window.extractLattesIdAndHtmlFromCvLink = extractLattesIdAndHtmlFromCvLink;
        window.extractTableData = extractTableData;
    }

    // Envia um pedido de download ao service worker e reporta falhas.
    // Antes as mensagens eram enviadas sem callback: um download recusado pelo Chrome
    // (ex.: data: URL grande demais para o CV congelado) falhava silenciosamente enquanto
    // a barra de status seguia anunciando "Sucesso".
    function requestDownload(message, description) {
        try {
            chrome.runtime.sendMessage(message, (res) => {
                const err = chrome.runtime.lastError ? chrome.runtime.lastError.message
                          : (res && res.success === false ? (res.error || 'erro desconhecido') : null);
                if (!err) return;
                console.warn(`[piccTools] Falha ao salvar ${description}:`, err);
                const statusLabel = document.getElementById('picc-tools-status');
                if (statusLabel) {
                    statusLabel.innerText = `Aviso: não foi possível salvar ${description} (${err}).`;
                    statusLabel.style.color = '#ffcc80';
                }
            });
        } catch (e) {
            console.warn(`[piccTools] Erro ao solicitar download de ${description}:`, e);
        }
    }

    // Helper to format project folder path: Downloads/piccData/<ProcessId> - <NomeProponente>/
    function getProjectFolderPath(item) {
        if (!item) return 'piccData/processo';
        const processId = item.processId || item.customId || 'processo';
        const propName = (item.proponente && item.proponente.name) ? item.proponente.name : (item.name || '');

        const safeProcessId = String(processId).replace(/[\/\\?%*:|"<>]/g, '-').trim();
        const safePropName = String(propName).replace(/[\/\\?%*:|"<>]/g, '').trim();

        const folderName = safePropName ? `${safeProcessId} - ${safePropName}` : safeProcessId;
        return `piccData/${folderName}`;
    }

    // Save proposal PDF, CV HTML, annexes, and review HTMLs to Downloads/piccData/<ProcessId> - <NomeProponente>/
    async function saveProcessFiles(item, cvHtmlText = '', reviews = [], forceRedownload = false) {
        if (!item || (!item.processId && !item.numeroProtocolo)) return;

        // Skip downloading if files were already downloaded previously for this proposal UNLESS forceRedownload is true
        if (!forceRedownload) {
            const db = await safeGetDB(true);
            const existing = db.find(entry => entry.processId === item.processId || (entry.isProcesso && entry.customId && entry.customId.includes(item.processId)));
            if (existing && (existing.filesDownloaded || existing.alreadyDownloaded)) {
                console.log(`[piccTools] Arquivos da proposta ${item.processId} já foram baixados anteriormente. Pula re-download.`);
                return;
            }
        }

        const folder = getProjectFolderPath(item);
        const safeProcessId = String(item.processId || item.numeroProtocolo || 'processo').replace(/[\/\\?%*:|"<>]/g, '-').trim();

        // 1. Download PDF Proposal
        if (item.pdfLink && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            const pdfFilename = `${folder}/proposta_${safeProcessId}.pdf`;
            requestDownload({
                action: 'download_file',
                url: item.pdfLink,
                filename: pdfFilename
            }, `o PDF da proposta ${safeProcessId}`);
        }

        // 2. Download Supplementary Material / Anexos independently for each attachment file
        const attList = (Array.isArray(item.attachments) && item.attachments.length > 0) 
            ? item.attachments 
            : (item.supplementaryLink ? [{ type: 'Anexo', url: item.supplementaryLink }] : []);

        if (attList.length > 0 && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            for (let idx = 0; idx < attList.length; idx++) {
                const att = attList[idx];
                if (!att || !att.url) continue;
                let ext = 'pdf';
                const lowerUrl = att.url.toLowerCase();
                if (lowerUrl.includes('.zip')) ext = 'zip';
                else if (lowerUrl.includes('.doc')) ext = 'doc';

                const safeType = String(att.type || 'anexo').toLowerCase().replace(/[^\w]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'anexo';
                const countSuffix = attList.length > 1 ? `_${idx + 1}` : '';
                const anexoFilename = `${folder}/anexo_${safeType}${countSuffix}_${safeProcessId}.${ext}`;

                console.log(`[piccTools] Solicitando download do anexo #${idx + 1} (${att.type}): ${att.url} -> ${anexoFilename}`);
                requestDownload({
                    action: 'download_file',
                    url: att.url,
                    filename: anexoFilename
                }, `o anexo "${att.type || 'Anexo'}"`);

                // Fetch attachment ArrayBuffer to store binary in DB for offline blob viewing
                if (!att.data) {
                    try {
                        const bgRes = await new Promise((resolve) => {
                            chrome.runtime.sendMessage({ action: 'fetch_arraybuffer', url: att.url }, (res) => resolve(res));
                        });
                        if (bgRes && bgRes.success && bgRes.base64) {
                            att.data = bgRes.base64;
                        }
                    } catch (attErr) {
                        console.warn(`[piccTools] Erro ao obter ArrayBuffer do anexo #${idx + 1}:`, attErr);
                    }
                }
            }
        }

        // 3. Save Lattes CV HTML with full CSS, fonts, icons, and image links
        if (cvHtmlText) {
            const safeLattesId = (item.proponente && item.proponente.lattesId) ? item.proponente.lattesId : 'proponente';
            const cvFilename = `${folder}/curriculo_${safeLattesId}.html`;
            const selfContainedCvHtml = makeSelfContainedHtml(cvHtmlText, (item.proponente && item.proponente.cvLink) || 'http://plsql1.cnpq.br/curriculostg/');
            
            item.cvHtml = selfContainedCvHtml;

            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                requestDownload({
                    action: 'download_data',
                    data: selfContainedCvHtml,
                    filename: cvFilename
                }, 'o CV Lattes congelado');
            }
        }

        // 4. Save Parecer Ad Hoc HTMLs with full CSS, fonts, icons, and image links
        if (Array.isArray(reviews) && reviews.length > 0) {
            reviews.forEach((rev, idx) => {
                if (rev && rev.html && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                    const reviewFilename = `${folder}/parecer_${idx + 1}.html`;
                    const selfContainedReviewHtml = makeSelfContainedHtml(rev.html, rev.link || 'http://efomento.cnpq.br/efomento/');
                    requestDownload({
                        action: 'download_data',
                        data: selfContainedReviewHtml,
                        filename: reviewFilename
                    }, `o parecer ad-hoc #${idx + 1}`);
                } else if (rev && rev.link && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                    const reviewFilename = `${folder}/parecer_${idx + 1}.html`;
                    requestDownload({
                        action: 'download_file',
                        url: rev.link,
                        filename: reviewFilename
                    }, `o parecer ad-hoc #${idx + 1}`);
                }
            });
        }

        item.filesDownloaded = true;
        item.alreadyDownloaded = true;
    }

    if (typeof window !== 'undefined') {
        window.saveProcessFiles = saveProcessFiles;
    }

    // Helper to fetch and parse process details directly from PDF arrayBuffer
    async function parseProcessFromPDF(arrayBuffer, pdfUrl) {
        if (typeof pdfjsLib === 'undefined') throw new Error("pdfjsLib não disponível");

        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, isEvalSupported: false });
        const pdf = await loadingTask.promise;
        
        let allPageItems = [];
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const content = await page.getTextContent();
            content.items.forEach(item => {
                if (item.str.trim()) {
                    allPageItems.push({
                        page: pageNum,
                        x: item.transform[4],
                        y: item.transform[5],
                        str: item.str.trim()
                    });
                }
            });
        }

        // Sort items by Page (asc), Y (desc), X (asc)
        allPageItems.sort((a, b) => {
            if (a.page !== b.page) return a.page - b.page;
            const yDiff = b.y - a.y;
            if (Math.abs(yDiff) > 4) return yDiff;
            return a.x - b.x;
        });

        let allLines = [];
        let currentLine = [];
        let currentY = null;
        let currentPage = null;

        allPageItems.forEach(item => {
            if (currentPage !== item.page || currentY === null || Math.abs(currentY - item.y) > 4) {
                if (currentLine.length > 0) allLines.push(currentLine);
                currentLine = [item];
                currentY = item.y;
                currentPage = item.page;
            } else {
                        currentLine.push(item);
            }
        });
        if (currentLine.length > 0) allLines.push(currentLine);

        const fullText = allLines.map(l => l.map(i => i.str).join(' ')).join('\n');

        // Helper to extract UF from institution string
        function extractUf(instStr) {
            if (!instStr) return '';
            const m = instStr.match(/-([A-Z]{2})-/i) || instStr.match(/,?\s*\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i);
            return m ? m[1].toUpperCase() : '';
        }

        function isValidLattesUrl(url) {
            if (!url) return false;
            return /^https?:\/\/lattes\.cnpq\.br\/\d{16}$/i.test(url.trim());
        }

        function cleanFormacao(str) {
            if (!str) return '';
            let s = str
                .replace(/https?:\/\/[^\s]+/gi, '')
                .replace(/lattes\.cnpq\.br\/\d*/gi, '')
                .replace(/\b\d{16}\b/g, '')
                .replace(/\b(URL|DO|CURRÍCULO|FORMAÇÃO|TITULAÇÃO|NOME|BOLSA|INSTITUIÇÃO|DEPARTAMENTO|ÁREAS|ATUAÇÃO|PESQUISADOR|EQUIPE|TEMPO|DEDIC|PROJ|HORAS|SEMANA)\b/gi, '')
                .replace(/\s+/g, ' ')
                .trim();

            const validDegreeRegex = /\b(Doutorado|Doutor|Mestrado|Mestre|Especializa[çc][ãa]o|Especialista|Gradua[çc][ãa]o|Graduado|Bacharel|Licenciatura|Ensino\s+M[ée]dio|T[ée]cnico|P[óo]s-Doutorado)\b/i;
            const match = s.match(validDegreeRegex);
            if (match) {
                const rawMatch = match[0];
                const lower = rawMatch.toLowerCase();
                if (lower.startsWith('doutor')) return 'Doutorado';
                if (lower.startsWith('mestr')) return 'Mestrado';
                if (lower.startsWith('especializ') || lower.startsWith('especialist')) return 'Especialização';
                if (lower.startsWith('gradua') || lower.startsWith('bacharel') || lower.startsWith('licencia')) return 'Graduação';
                if (lower.startsWith('pós-doutor') || lower.startsWith('pos-doutor')) return 'Pós-Doutorado';
                if (lower.startsWith('ensino')) return 'Ensino Médio';
                if (lower.startsWith('téc') || lower.startsWith('tec')) return 'Técnico';
                return rawMatch;
            }
            return '';
        }

        // 1. Extract Edital (from URL path like /doc/Universal_2026/ or PDF text SIGLA:)
        let edital = '';
        if (pdfUrl) {
            const urlEditalMatch = pdfUrl.match(/\/doc\/([^\/]+)\//i);
            if (urlEditalMatch) edital = urlEditalMatch[1];
        }
        if (!edital) {
            const siglaMatch = fullText.match(/SIGLA:\s*([^\n\r]+)/i);
            if (siglaMatch) edital = siglaMatch[1].trim();
        }

        // 1b. Extract Faixa from CHAMADA section (matches "Faixa A -", "Faixa C:", etc.)
        let faixa = '-';
        const faixaMatch = fullText.match(/\bFaixa\s+([A-Za-z0-9])/i);
        if (faixaMatch) {
            faixa = faixaMatch[1].toUpperCase();
        }

        // 2. Extract Processo number
        const procMatch = fullText.match(/Processo:\s*([\d\/\-]+)/i);
        let processId = procMatch ? procMatch[1].trim() : '';

        // 3. Extract Numero Protocolo (16 digits)
        const protMatch = fullText.match(/PROPOSTA\s+(\d{16})/i) || fullText.match(/\b00\d{14}\b/);
        let numeroProtocolo = protMatch ? (protMatch[1] || protMatch[0]) : '';
        if (!processId) processId = numeroProtocolo;

        // 4. Extract Proponente Name
        const propNameMatch = fullText.match(/PROPONENTE[\s\S]*?NOME:\s*([^\n\r]+)/i) || fullText.match(/NOME:\s*([^\n\r]+)/i);
        const propName = propNameMatch ? propNameMatch[1].trim() : '';

        // 5. Extract Proponente Instituicao across multiple lines (strictly on Page 1)
        let propInstLines = [];
        let page1PropFormacao = '';
        const page1Lines = allLines.filter(lineItems => lineItems.length > 0 && lineItems[0].page === 1);

        let isInstSection = false;
        page1Lines.forEach(lineItems => {
            const col1Str = lineItems.filter(i => i.x < 140).map(i => i.str).join(' ').trim().toUpperCase();
            const col2Str = lineItems.filter(i => i.x >= 140).map(i => i.str).join(' ').trim();

            if (col1Str.includes('FORMAÇÃO') || col1Str.includes('TITULAÇÃO')) {
                if (col2Str) page1PropFormacao = cleanFormacao(col2Str);
            }

            const isInstLabel = col1Str === 'INSTITUIÇÃO' || col1Str === 'VÍNCULO:' || col1Str === 'INSTITUIÇÃO VÍNCULO:' || col1Str === 'VÍNCULO';

            if (isInstLabel) {
                isInstSection = true;
                if (col2Str) propInstLines.push(col2Str);
            } else if (isInstSection) {
                if (col1Str.includes('CHAMADA') || col1Str.includes('NOME') || col1Str.includes('COMITÊ') ||
                    col1Str.includes('PROJETO') || col1Str.includes('SIGLA') || col1Str.includes('EQUIPE') ||
                    col1Str.includes('PALAVRAS') || col1Str.includes('RESUMO') || col1Str.includes('CPF')) {
                    isInstSection = false;
                } else if (col2Str) {
                    propInstLines.push(col2Str);
                } else {
                    isInstSection = false;
                }
            }
        });

        const propInst = propInstLines.join(' ').replace(/\s+/g, ' ').trim();

        // 5b. Instituição Executora/Sede — bloco "INSTITUIÇÕES ENVOLVIDAS":
        //     INSTITUIÇÕES ENVOLVIDAS
        //     Executora/Sede
        //     Universidade Federal do Rio Grande do Norte - UFRN, RN, Brasil
        //     Colaboradora
        //     ...
        let instituicaoExecutora = '';
        {
            const textLines = fullText.split('\n').map(l => l.trim());
            const idx = textLines.findIndex(l => /^Executora\s*\/\s*Sede\b/i.test(l));
            // A ordenação por coordenada intercala rodapés de paginação e restos de tabela
            // entre o rótulo e o valor, então identificamos a linha pelo formato do nome
            // ("Nome da Instituição - SIGLA, UF, País") em vez de pela posição.
            const looksLikeInstitution = (l) =>
                !!l && l.length > 5 && l.length < 200 &&
                /\s[-–]\s/.test(l) &&
                /,\s*[A-Za-zÀ-ÿ.]+\.?$/.test(l) &&
                !/(DETALHAMENTO|JUSTIFICATIVA|VALOR|ITEM|QTD|TOTAL|DURA[ÇC][ÃA]O|BENEF[ÍI]CIO|R\$)/i.test(l);

            if (idx >= 0) {
                const sameLine = textLines[idx].replace(/^Executora\s*\/\s*Sede\s*:?\s*/i, '').trim();
                if (looksLikeInstitution(sameLine)) {
                    instituicaoExecutora = sameLine;
                } else {
                    for (let j = idx + 1; j < Math.min(textLines.length, idx + 25); j++) {
                        const l = textLines[j];
                        if (!l) continue;
                        if (/^(Colaboradora|RECURSOS|CUSTEIO|CAPITAL|BOLSAS|[ÁA]REAS\s+DO)/i.test(l)) break;
                        if (looksLikeInstitution(l)) { instituicaoExecutora = l; break; }
                    }
                }
            }
        }

        // 6. Extract Team Members using strict column coordinates & subheader bounds
        const equipeIdx = allPageItems.findIndex(item => item.str === 'EQUIPE' || item.str === 'Pesquisador' || item.str.includes('MEMBROS DA EQUIPE'));
        let teamMembers = [];
        let memberBlockEndIndices = [];

        allPageItems.forEach((item, idx) => {
            if (idx > equipeIdx) {
                if (item.str === 'URL') {
                    const next1 = allPageItems[idx + 1]?.str || '';
                    const next2 = allPageItems[idx + 2]?.str || '';
                    if (next1 === 'DO' || next2 === 'CURRÍCULO' || next1 === 'CURRÍCULO') {
                        const lastIdx = memberBlockEndIndices[memberBlockEndIndices.length - 1];
                        if (lastIdx === undefined || idx - lastIdx > 5) {
                            memberBlockEndIndices.push(idx);
                        }
                    }
                } else if (item.str.includes('lattes.cnpq.br/') || item.str.includes('visualizacv.do')) {
                    const lastIdx = memberBlockEndIndices[memberBlockEndIndices.length - 1];
                    if (lastIdx === undefined || idx - lastIdx > 5) {
                        memberBlockEndIndices.push(idx);
                    }
                }
            }
        });

        let currentCategory = 'Pesquisador';

        memberBlockEndIndices.forEach((endIdx, i) => {
            const prevBound = i > 0 ? memberBlockEndIndices[i-1] + 1 : (equipeIdx >= 0 ? equipeIdx + 1 : 0);

            let cvLink = '';
            let lattesId = '';

            // Find Lattes URL if available in this block
            const endItemStr = allPageItems[endIdx]?.str || '';
            const endNextStr = allPageItems[endIdx + 3]?.str || allPageItems[endIdx + 1]?.str || '';
            const combinedUrlStr = endItemStr + ' ' + endNextStr;
            const linkMatch = combinedUrlStr.match(/https?:\/\/[^\s"'<>\)]+/i) || endItemStr.match(/https?:\/\/[^\s"'<>\)]+/i);
            if (linkMatch) {
                const urlCandidate = linkMatch[0].trim();
                const lattesIdMatch = urlCandidate.match(/lattes\.cnpq\.br\/(\d{16})/i);
                if (lattesIdMatch) {
                    lattesId = lattesIdMatch[1];
                    cvLink = `http://lattes.cnpq.br/${lattesId}`;
                }
            }

            if (!isValidLattesUrl(cvLink)) {
                cvLink = '';
                lattesId = '';
            }

            // Find subheader TEMPO DEDIC / RESPONSABILIDADE for this member
            let subHeaderIdx = -1;
            for (let j = prevBound; j < endIdx; j++) {
                const item = allPageItems[j];
                if (item.str.startsWith('TEMPO') || item.str.startsWith('RESPONSABILIDADE')) {
                    subHeaderIdx = j;
                    break;
                }
            }

            const sectionABound = subHeaderIdx >= 0 ? subHeaderIdx : endIdx;

            // Check if there is a Category header before sectionABound
            for (let j = prevBound; j < sectionABound; j++) {
                const item = allPageItems[j];
                if (item.x < 100) {
                    const catMatch = item.str.match(/^(Pesquisador|Aluno|Colaborador|Pesquisador\s+Estrangeiro|P[óo]s-Doutorando|T[ée]cnico|Especialista)$/i);
                    if (catMatch) {
                        currentCategory = item.str.trim();
                    } else {
                        const nextStr = allPageItems[j + 1]?.str || '';
                        const combined = (item.str + ' ' + nextStr).trim();
                        if (/^(Pesquisador\s+Estrangeiro|Pesquisador\s+Colaborador|Aluno\s+de\s+Inicia[çc][ãa]o\s+Cient[íi]fica)$/i.test(combined)) {
                            currentCategory = combined;
                        }
                    }
                }
            }

            let nameParts = [];
            let formacaoParts = [];
            let bolsaParts = [];
            let instParts = [];

            for (let j = prevBound; j < sectionABound; j++) {
                const item = allPageItems[j];
                const upperStr = item.str.toUpperCase();
                if (upperStr.startsWith('NOME') || upperStr.startsWith('FORMAÇÃO') || upperStr.startsWith('TITULAÇÃO') ||
                    upperStr.startsWith('BOLSA') || upperStr.startsWith('INSTITUIÇÃO') || upperStr.startsWith('DEPARTAMENTO') ||
                    upperStr.startsWith('ÁREAS') || upperStr.startsWith('ATUAÇÃO') || upperStr.startsWith('EQUIPE') ||
                    upperStr.startsWith('PESQUISADOR') || upperStr.startsWith('ALUNO') || upperStr.startsWith('COLABORADOR') ||
                    upperStr.startsWith('PÁGINA') || upperStr.startsWith('URL') || upperStr === 'DO' || upperStr === 'CURRÍCULO' || item.str === 'DE') {
                    continue;
                }

                // Column 1 (NOME): 45 <= X < 160
                if (item.x >= 45 && item.x < 160) nameParts.push(item.str);
                // Column 2 (FORMAÇÃO/TITULAÇÃO): 160 <= X < 225
                if (item.x >= 160 && item.x < 225) formacaoParts.push(item.str);
                // Column 3 (BOLSA): 225 <= X < 258
                if (item.x >= 225 && item.x < 258) bolsaParts.push(item.str);
                // Column 4 (INSTITUIÇÃO/DEPARTAMENTO): 258 <= X < 400
                if (item.x >= 258 && item.x < 400) instParts.push(item.str);
            }

            const name = nameParts.join(' ').replace(/\s+/g, ' ').trim();
            const rawFormacao = formacaoParts.join(' ').replace(/\s+/g, ' ').trim();
            const formacao = cleanFormacao(rawFormacao);
            const rawBolsa = bolsaParts.join(' ').replace(/\s+/g, ' ').trim();
            const bolsa = isValidBolsa(rawBolsa) ? rawBolsa : '-';
            let instituicao = instParts.join(' ').replace(/\s+/g, ' ').trim();
            instituicao = instituicao.replace(/-\s*$/, '').trim();

            // Ignore garbage blocks or section headers like "Quadro Geral", "Resumo", etc.
            const isInvalidName = !name || 
                /^(Quadro|Quadro\s+Geral|Resumo|Categoria|Propomos|Projeto|Palavras|Objetivos|Metodologia|Cronograma|Orçamento|Referência|Declaração|Comitê|CNPq)/i.test(name) ||
                name.toUpperCase().includes('QUADRO GERAL') ||
                name.toUpperCase().includes('CATEGORIA RESUMO') ||
                name.length > 80;

            if (!isInvalidName && (name || cvLink)) {
                teamMembers.push({
                    name: name,
                    formacao: formacao,
                    cvLink: cvLink,
                    lattesId: lattesId,
                    bolsa: bolsa,
                    categoria: currentCategory,
                    instituicao: instituicao,
                    isVisible: true
                });
            }
        });

        let propCvLink = '';
        let propLattesId = '';
        let propBolsa = '-'; // Do NOT extract proponente bolsa from PDF
        let propFormacao = page1PropFormacao || '';

        // Match proponent against team members table strictly by normalized name match
        const normPropName = normalizeName(propName);
        if (normPropName) {
            const matchingTeamMember = teamMembers.find(m => {
                if (!m.name) return false;
                const normMName = normalizeName(m.name);
                return normMName && (normMName === normPropName || normMName.includes(normPropName) || normPropName.includes(normMName));
            });

            if (matchingTeamMember) {
                if (matchingTeamMember.cvLink) propCvLink = matchingTeamMember.cvLink;
                if (matchingTeamMember.lattesId) propLattesId = matchingTeamMember.lattesId;
                if (matchingTeamMember.formacao) propFormacao = matchingTeamMember.formacao;
            }
        }

        const proponenteObj = {
            name: propName,
            cvLink: propCvLink,
            lattesId: propLattesId,
            bolsa: '-', // Always '-' from PDF
            formacao: propFormacao,
            instituicao: propInst,
            isVisible: true
        };

        // 6. Extract all attachments (DOCUMENTOS ANEXOS) with their file types and URLs from PDF text
        let attachments = [];
        const docAnexoSection = fullText.match(/DOCUMENTOS\s+ANEXOS[\s\S]*?(?=DECLARAÇÃO|$)/i);
        if (docAnexoSection) {
            const textBlock = docAnexoSection[0];
            const itemRegex = /([A-Za-zÀ-ÖØ-öø-ÿ\s]+)\s+-\s+(https?:\/\/anexosform\.cnpq\.br\/doc\/[^\s\n\r"';\)]+)/gi;
            let m;
            while ((m = itemRegex.exec(textBlock)) !== null) {
                let typeName = m[1].replace(/DOCUMENTOS\s+ANEXOS|ARQUIVO|TAMANHO|URL/gi, '').replace(/\s+/g, ' ').trim();
                let url = m[2].trim();
                if (/\.pd$/i.test(url)) url = url.replace(/\.pd$/i, '.pdf');
                attachments.push({
                    type: typeName || 'Anexo',
                    url: url
                });
            }
        }

        // Fallback for single anexosform URL if docAnexoSection regex missed it
        if (attachments.length === 0) {
            const fallbackMatch = fullText.match(/(https?:\/\/anexosform\.cnpq\.br\/doc\/[^\s\n\r"';\)]+)/i);
            if (fallbackMatch) {
                let url = fallbackMatch[1].trim();
                if (/\.pd$/i.test(url)) url = url.replace(/\.pd$/i, '.pdf');
                attachments.push({ type: 'Anexo', url: url });
            }
        }

        // Sort attachments: Non-CV attachments ("Anexo", "Projeto de Pesquisa") first, CV attachments ("Currículo") after
        attachments.sort((a, b) => {
            const aType = (a.type || '').toLowerCase();
            const bType = (b.type || '').toLowerCase();
            const aIsCv = aType.includes('currículo') || aType.includes('curriculo');
            const bIsCv = bType.includes('currículo') || bType.includes('curriculo');
            if (aIsCv && !bIsCv) return 1;
            if (!aIsCv && bIsCv) return -1;
            return 0;
        });

        const supplementaryLink = attachments.length > 0 ? attachments[0].url : '';

        // Validação de sanidade: a extração da equipe depende de coordenadas X fixas do
        // layout do PDF do CNPq. Se o layout mudar, os nomes saem vazios e os membros são
        // descartados silenciosamente. Aqui a falha passa a ser visível para o usuário.
        const warnings = [];
        if (/\bEQUIPE\b/i.test(fullText) && teamMembers.length === 0) {
            warnings.push('seção EQUIPE presente mas nenhum membro extraído');
        }
        if (!propName) {
            warnings.push('nome do proponente não encontrado');
        }
        const parseWarning = warnings.length > 0
            ? `${processId || numeroProtocolo || 'PDF'}: ${warnings.join('; ')}`
            : '';
        if (parseWarning) {
            console.warn(`[piccTools] Layout do PDF não reconhecido — ${parseWarning}`, pdfUrl || '');
        }

        return {
            processId: processId,
            numeroProtocolo: numeroProtocolo,
            edital: edital,
            faixa: faixa,
            instituicaoExecutora: instituicaoExecutora,
            proponente: proponenteObj,
            pdfLink: pdfUrl || '',
            supplementaryLink: supplementaryLink,
            attachments: attachments,
            teamMembers: teamMembers,
            reviewLinks: [],
            reviews: [],
            parseWarning: parseWarning
        };
    }

    function base64ToArrayBuffer(base64) {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    function arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    // Helper to fetch and parse PDF
    async function extractTeamFromPDF(pdfUrl) {
        try {
            if (!pdfUrl || typeof pdfUrl !== 'string' || (!pdfUrl.startsWith('http://') && !pdfUrl.startsWith('https://'))) {
                console.warn("[piccTools] URL do PDF inválida ou não disponível:", pdfUrl);
                return { teamMembers: [], edital: '' };
            }
            console.log(`[piccTools] Carregando PDF da proposta: ${pdfUrl}...`);

            let arrayBuffer = null;
            let rawBase64 = null;

            // 1. Fetch via Background Service Worker (bypasses CORS restrictions)
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                const bgRes = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ action: 'fetch_arraybuffer', url: pdfUrl }, (res) => {
                        if (chrome.runtime.lastError) {
                            console.warn("[piccTools] Erro de comunicação com Service Worker:", chrome.runtime.lastError.message);
                            resolve(null);
                        } else if (!res || !res.success || !res.base64) {
                            console.warn("[piccTools] Service Worker não retornou o PDF:", res ? res.error : 'Sem resposta');
                            resolve(null);
                        } else {
                            rawBase64 = res.base64;
                            resolve(base64ToArrayBuffer(res.base64));
                        }
                    });
                });
                if (bgRes) arrayBuffer = bgRes;
            }

            // 2. Fallback to direct fetch (only if background worker is unavailable)
            if (!arrayBuffer) {
                console.log(`[piccTools] Tentando fetch direto no navegador para: ${pdfUrl}...`);
                const response = await fetch(pdfUrl);
                if (!response.ok) {
                    console.warn(`[piccTools] Erro HTTP ao baixar PDF (${response.status}): ${pdfUrl}`);
                    return { teamMembers: [], edital: '' };
                }
                arrayBuffer = await response.arrayBuffer();
            }

            console.log(`[piccTools] PDF carregado com sucesso (${arrayBuffer.byteLength} bytes): ${pdfUrl}`);
            const parsed = await parseProcessFromPDF(arrayBuffer, pdfUrl);
            if (rawBase64) {
                parsed.pdfData = rawBase64;
            } else if (arrayBuffer) {
                try {
                    parsed.pdfData = arrayBufferToBase64(arrayBuffer);
                } catch (e) {}
            }
            return {
                teamMembers: parsed.teamMembers || [],
                edital: parsed.edital || '',
                processData: parsed
            };
        } catch (e) {
            console.error("[piccTools] Erro ao processar PDF:", pdfUrl, e);
            return { teamMembers: [], edital: '' };
        }
    }

    async function extractReviewsFromAdHoc(reviewLinks) {
        if (!Array.isArray(reviewLinks) || reviewLinks.length === 0) return [];
        
        let reviews = [];
        for (const link of reviewLinks) {
            try {
                let htmlText = '';
                // 1. Try fetching via background service worker (decodes ISO-8859-1 correctly)
                if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                    const bgRes = await new Promise((resolve) => {
                        chrome.runtime.sendMessage({ action: 'fetch_url', url: link }, (res) => {
                            if (chrome.runtime.lastError || !res || !res.success) {
                                resolve(null);
                            } else {
                                resolve(res.text);
                            }
                        });
                    });
                    if (bgRes) htmlText = bgRes;
                }

                // 2. Fallback to direct fetch with explicit ISO-8859-1 decoding
                if (!htmlText) {
                    const response = await fetch(link);
                    if (response.ok) {
                        const buffer = await response.arrayBuffer();
                        const decoder = new TextDecoder('iso-8859-1');
                        htmlText = decoder.decode(buffer);
                    }
                }

                if (htmlText) {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(htmlText, 'text/html');
                    const parecerEl = doc.querySelector('.parecer-conteudo, #conteudoParecer, .texto-parecer, #divParecer, .form-group, fieldset');
                    const text = parecerEl ? parecerEl.innerText.trim() : doc.body.innerText.trim();
                    const selfContainedReviewHtml = makeSelfContainedHtml(htmlText, link || 'https://chagas.cnpq.br/chagas/');
                    reviews.push({
                        link: link,
                        text: text.substring(0, 4000),
                        html: selfContainedReviewHtml
                    });
                }
            } catch (e) {
                console.warn("[piccTools] Erro ao buscar parecer:", link, e);
            }
        }
        return reviews;
    }

        // Process direct PDF URL directly
    async function processDirectPDF(pdfUrl, forceRedownload = false) {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            const res = await new Promise(r => chrome.storage.local.get(['jcr_picctools_disabled'], r));
            const isDisabled = (res && res.jcr_picctools_disabled !== undefined) ? !!res.jcr_picctools_disabled : true;
            if (isDisabled) {
                console.log("[piccTools] Processamento de PDF direto cancelado: piccTools está desabilitado pelo usuário.");
                return;
            }
        }

        pdfUrl = pdfUrl || window.location.href;
        const statusLabel = document.getElementById('picc-tools-status');
        if (statusLabel) {
            statusLabel.innerText = "Lendo e processando PDF do Processo... Aguarde.";
            statusLabel.style.color = '#fff59d';
        }

        try {
            console.log(`[piccTools] Processando PDF diretamente da URL: ${pdfUrl}...`);

            let arrayBuffer = null;
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                const bgRes = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ action: 'fetch_arraybuffer', url: pdfUrl }, (res) => {
                        if (chrome.runtime.lastError || !res || !res.success || !res.base64) {
                            resolve(null);
                        } else {
                            resolve(base64ToArrayBuffer(res.base64));
                        }
                    });
                });
                if (bgRes) arrayBuffer = bgRes;
            }

            if (!arrayBuffer) {
                const response = await fetch(pdfUrl);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                arrayBuffer = await response.arrayBuffer();
            }

            const processData = await parseProcessFromPDF(arrayBuffer, pdfUrl);
            if (!processData || (!processData.processId && !processData.numeroProtocolo)) {
                throw new Error("Não foi possível extrair dados válidos do PDF.");
            }

            console.log("[piccTools] Dados extraídos do PDF:", processData);

            if (processData.parseWarning && statusLabel) {
                statusLabel.innerText = `Atenção — layout do PDF não reconhecido (${processData.parseWarning}). Os dados podem estar incompletos.`;
                statusLabel.style.color = '#ffcc80';
            }

            let cvResult = { lattesId: '', htmlText: '' };
            if (processData.proponente && processData.proponente.cvLink) {
                cvResult = await extractLattesIdAndHtmlFromCvLink(processData.proponente.cvLink);
                if (cvResult.lattesId) processData.proponente.lattesId = cvResult.lattesId;
            }

            await saveProcessFiles(processData, cvResult.htmlText, [], forceRedownload);

            // Sincroniza proponente e equipe no banco de CVs do piccTools (uma leitura + uma escrita)
            await beginCvSyncBatch();
            if (processData.proponente && processData.proponente.name) {
                queueResearcherSync(
                    processData.proponente.name,
                    processData.proponente.lattesId || cvResult.lattesId,
                    processData.proponente.bolsa,
                    processData.proponente.formacao
                );
            }
            if (Array.isArray(processData.teamMembers)) {
                for (const tm of processData.teamMembers) {
                    queueResearcherSync(tm.name, tm.lattesId, tm.bolsa, tm.formacao);
                }
            }
            await flushCvSyncBatch();

            const cvCongeladoUrl = (processData.proponente && processData.proponente.cvLink && !processData.proponente.cvLink.includes('lattes.cnpq.br')) ? processData.proponente.cvLink : '';
            if (cvCongeladoUrl && processData.proponente) {
                processData.proponente.cvCongelado = cvCongeladoUrl;
                processData.cvCongelado = cvCongeladoUrl;
            }

            const db = await safeGetDB(true);
            const existingIndex = db.findIndex(entry => entry.processId === processData.processId || (entry.isProcesso && entry.customId && entry.customId.includes(processData.processId)));

            let updatedRecord;
            if (existingIndex >= 0) {
                let existing = db[existingIndex];
                existing.isProcesso = true;
                existing.processId = processData.processId;
                existing.numeroProtocolo = processData.numeroProtocolo;
                existing.edital = processData.edital || existing.edital || '';
                existing.faixa = processData.faixa || existing.faixa || '-';
                existing.instituicaoExecutora = processData.instituicaoExecutora || existing.instituicaoExecutora || '';
                existing.pdfLink = pdfUrl;
                if (cvCongeladoUrl) existing.cvCongelado = cvCongeladoUrl;
                if (processData.supplementaryLink) existing.supplementaryLink = processData.supplementaryLink;
                if (Array.isArray(processData.attachments) && processData.attachments.length > 0) existing.attachments = processData.attachments;
                if (processData.proponente && processData.proponente.name) existing.proponente = processData.proponente;
                if (processData.teamMembers && processData.teamMembers.length > 0) existing.teamMembers = processData.teamMembers;
                existing.prioridade = existing.prioridade || '-';
                existing.filesDownloaded = true;
                existing.alreadyDownloaded = true;
                db[existingIndex] = existing;
                updatedRecord = existing;
            } else {
                const newEntry = {
                    processId: processData.processId,
                    numeroProtocolo: processData.numeroProtocolo,
                    edital: processData.edital || '',
                    faixa: processData.faixa || '-',
                    instituicaoExecutora: processData.instituicaoExecutora || '',
                    isProcesso: true,
                    prioridade: '-',
                    filesDownloaded: true,
                    alreadyDownloaded: true,
                    customId: processData.processId,
                    name: processData.proponente.name || processData.processId,
                    lattesId: processData.proponente.lattesId || '',
                    cvCongelado: cvCongeladoUrl,
                    supplementaryLink: processData.supplementaryLink || '',
                    attachments: processData.attachments || [],
                    proponente: processData.proponente,
                    teamMembers: processData.teamMembers || [],
                    reviews: [],
                    pdfLink: pdfUrl,
                    totalPapers: 0,
                    papersWithJcr: 0,
                    gcCount: 0,
                    firstAuthorCount: 0,
                    lastAuthorCount: 0,
                    wosHIndex: 0,
                    wosCitations: 0,
                    dateAdded: new Date().toISOString()
                };
                db.push(newEntry);
                updatedRecord = newEntry;
            }

            if (processData.cvHtml) updatedRecord.cvHtml = processData.cvHtml;
            await detachHeavyBlobs(updatedRecord);
            // Grava apenas esta proposta (antes reescrevia o array inteiro de propostas)
            await safeSaveDB(updatedRecord);

            if (statusLabel) {
                statusLabel.innerText = `Sucesso! Processo ${updatedRecord.processId} ${updatedRecord.edital ? `(Edital: ${updatedRecord.edital})` : ''} salvo na base de dados (${updatedRecord.teamMembers.length} membros na equipe).`;
                statusLabel.style.color = '#a5d6a7';
            }
        } catch (e) {
            console.error("[piccTools] Erro ao processar PDF direto:", e);
            if (statusLabel) {
                statusLabel.innerText = `Erro ao processar PDF: ${e.message}`;
                statusLabel.style.color = '#ffcccc';
            }
        }
    }

    const CA_AUTH_KEY = 'jcr_ca_member_auth';
    const CA_AUTH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week (7 days)

    // Save CA member authorization key when accessing Planilha de Julgamento
    async function saveCaMemberAuth() {
        return new Promise((resolve) => {
            if (typeof chrome === 'undefined' || !chrome.storage?.local) { resolve(); return; }
            const authData = {
                isCaMember: true,
                authTimestamp: Date.now(),
                validUntil: Date.now() + CA_AUTH_TTL_MS
            };
            chrome.storage.local.set({ [CA_AUTH_KEY]: authData }, () => {
                console.log("[piccTools] Autorização validada.");
                resolve();
            });
        });
    }

    // Verify if CA member authorization key is valid and not expired
    async function isCaMemberAuthValid() {
        return new Promise((resolve) => {
            if (typeof chrome === 'undefined' || !chrome.storage?.local) { resolve(false); return; }
            chrome.storage.local.get([CA_AUTH_KEY], (result) => {
                if (chrome.runtime?.lastError || !result || !result[CA_AUTH_KEY]) {
                    resolve(false);
                    return;
                }
                const auth = result[CA_AUTH_KEY];
                if (auth && auth.isCaMember === true && auth.validUntil && Date.now() < auth.validUntil) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
        });
    }

    // Inject the piccTools UI at the top of the page.
    // Wrapper com guarda de reentrância: injectUI é async e o teste do DOM abaixo roda
    // antes de vários awaits, então DOMContentLoaded + o setTimeout(1500) podiam passar
    // os dois e montar duas toolbars.
    let piccInjecting = false;
    async function injectUI() {
        if (piccInjecting) return;
        piccInjecting = true;
        try {
            await injectUIInner();
        } finally {
            piccInjecting = false;
        }
    }

    async function injectUIInner() {
        if (document.getElementById('picc-tools-toolbar')) return;

        const currentUrl = (typeof window !== 'undefined' && window.location && window.location.href) ? window.location.href : '';
        const isPdfPage = currentUrl.includes('anexosform.cnpq.br/doc/') || currentUrl.endsWith('.pdf');
        
        const lowerTitle = (document.title || '').toLowerCase();
        const lowerUrl = currentUrl.toLowerCase();

        // Accessing Planilha de Julgamento page strictly validates CA member authorization
        const isJulgamento = lowerTitle.includes('julgamento') || 
                             lowerUrl.includes('julgamento') || 
                             lowerUrl.includes('planilha') || 
                             (typeof document !== 'undefined' && (
                                 !!document.getElementById('tabelaPropostas') ||
                                 !!(document.querySelector && document.querySelector('form[name*="julgamento"], table[id*="proposta"], table[id*="Julgamento"]'))
                             ));

        if (!isJulgamento && !isPdfPage) {
            return;
        }

        // Avoid injecting in side-menu frames (leftFrame), top logo frames (topFrame), or frameset wrappers
        if (window.name === 'leftFrame' || window.name === 'topFrame' || window.name === 'menu' || document.querySelector('frameset')) {
            return;
        }

        // Check if piccTools is disabled (Defaults to true/disabled unless explicitly set to false by user)
        let isPiccDisabled = true;
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            const res = await new Promise(r => chrome.storage.local.get(['jcr_picctools_disabled'], r));
            if (res && res.jcr_picctools_disabled !== undefined) {
                isPiccDisabled = !!res.jcr_picctools_disabled;
            }
        }

        // If piccTools is disabled and this is a direct PDF page, DO NOT show the toolbar at all!
        if (isPdfPage && isPiccDisabled) {
            console.log("[piccTools] Barra Oculta em PDF direto pois piccTools está desabilitado.");
            return;
        }

        if (isJulgamento) {
            // User accessed Planilha de Julgamento -> Confirm CA member and extend authorization for 1 week
            await saveCaMemberAuth();
        } else if (isPdfPage) {
            // Direct PDF access -> Verify if CA member authorization key is valid and unexpired
            const isValidCaMember = await isCaMemberAuthValid();
            if (!isValidCaMember) {
                return;
            }
        }

        const toolbar = document.createElement('div');
        toolbar.id = 'picc-tools-toolbar';

        const createJcrToggleIcon = (isDisabled, onToggle) => {
            const iconBtn = document.createElement('button');
            iconBtn.id = 'picc-toggle-icon-btn';
            const iconUrl = (typeof chrome !== 'undefined' && chrome.runtime?.getURL) 
                ? chrome.runtime.getURL('images/icon-32.png') 
                : '';

            iconBtn.style.cssText = `
                background: ${isDisabled ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.2)'};
                border: 1px solid ${isDisabled ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.6)'};
                border-radius: 50%;
                width: 32px;
                height: 32px;
                padding: 4px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                opacity: ${isDisabled ? '0.4' : '1'};
                transition: opacity 0.2s, transform 0.2s, background-color 0.2s;
                margin-left: auto;
                outline: none;
                box-shadow: ${isDisabled ? 'none' : '0 1px 4px rgba(0,0,0,0.3)'};
            `;

            iconBtn.title = isDisabled
                ? 'piccTools Desabilitado - Clique no ícone para habilitar as ferramentas do piccTools na Planilha de Julgamento'
                : 'piccTools Habilitado - Clique no ícone para desabilitar as ferramentas do piccTools na Planilha de Julgamento';

            if (iconUrl) {
                const img = document.createElement('img');
                img.src = iconUrl;
                img.style.cssText = 'width: 100%; height: 100%; object-fit: contain; pointer-events: none;';
                if (isDisabled) {
                    img.style.filter = 'grayscale(100%) brightness(0.7)';
                }
                iconBtn.appendChild(img);
            } else {
                iconBtn.innerText = '⚡';
                iconBtn.style.fontSize = '16px';
            }

            iconBtn.onmouseover = () => {
                iconBtn.style.opacity = isDisabled ? '0.85' : '1';
                iconBtn.style.transform = 'scale(1.1)';
            };
            iconBtn.onmouseout = () => {
                iconBtn.style.opacity = isDisabled ? '0.4' : '1';
                iconBtn.style.transform = 'scale(1.0)';
            };

            iconBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggle(!isDisabled);
            });

            return iconBtn;
        };

        const renderToolbar = (isDisabled) => {
            toolbar.innerHTML = '';

            if (isJulgamento && isDisabled) {
                // Subtle icon pinned to top-right corner when disabled (zero impact on page layout)
                toolbar.style.cssText = `
                    position: fixed;
                    top: 8px;
                    right: 20px;
                    width: auto;
                    background: transparent;
                    border: none;
                    box-shadow: none;
                    z-index: 999999;
                    display: flex;
                    align-items: center;
                `;
                if (document.body) document.body.style.paddingTop = '0px';

                const iconToggle = createJcrToggleIcon(true, (newDisabledState) => {
                    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                        chrome.storage.local.set({ jcr_picctools_disabled: newDisabledState }, () => {
                            renderToolbar(newDisabledState);
                        });
                    } else {
                        renderToolbar(newDisabledState);
                    }
                });

                toolbar.appendChild(iconToggle);
                return;
            }

            // Normal Full Toolbar
            toolbar.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                background-color: ${isPdfPage ? '#2E7D32' : (isJulgamento ? '#1565C0' : '#7f8c8d')};
                color: white;
                padding: 10px 20px;
                z-index: 999999;
                display: flex;
                align-items: center;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            `;
            if (document.body) document.body.style.paddingTop = '50px';

            const title = document.createElement('div');
            title.innerHTML = `<strong>piccTools</strong> - ${isPdfPage ? 'Processo em PDF' : 'Plataforma Carlos Chagas'}`;
            title.style.marginRight = '20px';
            title.style.fontSize = '16px';
            toolbar.appendChild(title);

            const statusLabel = document.createElement('span');
            statusLabel.id = 'picc-tools-status';
            statusLabel.style.marginLeft = '20px';
            statusLabel.style.fontSize = '14px';
            statusLabel.style.color = '#E3F2FD';

            if (isJulgamento) {
                const filterInput = document.createElement('input');
                filterInput.type = 'text';
                filterInput.id = 'picc-process-filter-input';
                filterInput.placeholder = 'Processos (separados por espaço)...';
                filterInput.title = 'Digite os números dos processos que deseja extrair (separados por espaço). Se deixado em branco, extrai todos os processos visíveis.';
                filterInput.style.cssText = `
                    padding: 5px 10px;
                    border: 1px solid #90CAF9;
                    border-radius: 4px;
                    font-size: 13px;
                    width: 250px;
                    outline: none;
                    color: #333;
                    background: white;
                    margin-right: 8px;
                `;

                const extractBtn = document.createElement('button');
                extractBtn.id = 'picc-extract-btn';
                extractBtn.innerText = 'Extrair Dados da Tabela';
                extractBtn.title = 'Extrai todos os processos visíveis na tabela ou apenas os listados no campo de texto ao lado (desde que estejam visíveis na tabela).';
                extractBtn.style.cssText = `
                    background-color: #2E7D32;
                    color: white;
                    border: none;
                    padding: 6px 12px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                    transition: background 0.2s;
                    white-space: nowrap;
                `;
                extractBtn.onmouseover = () => extractBtn.style.backgroundColor = '#1B5E20';
                extractBtn.onmouseout = () => extractBtn.style.backgroundColor = '#2E7D32';
                extractBtn.addEventListener('click', extractTableData);

                toolbar.appendChild(filterInput);
                toolbar.appendChild(extractBtn);
            } else if (isPdfPage) {
                const processPdfBtn = document.createElement('button');
                processPdfBtn.innerText = 'Reprocessar este PDF';
                processPdfBtn.style.cssText = `
                    background-color: #1565C0;
                    color: white;
                    border: none;
                    padding: 6px 12px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                    transition: background 0.2s;
                `;
                processPdfBtn.onmouseover = () => processPdfBtn.style.backgroundColor = '#0D47A1';
                processPdfBtn.onmouseout = () => processPdfBtn.style.backgroundColor = '#1565C0';
                processPdfBtn.addEventListener('click', () => processDirectPDF(window.location.href, true));
                toolbar.appendChild(processPdfBtn);
            }

            const viewDbBtn = document.createElement('button');
            viewDbBtn.innerText = 'Ver Propostas';
            viewDbBtn.style.cssText = `
                background-color: #f39c12;
                color: white;
                border: none;
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
                transition: background 0.2s;
                margin-left: 10px;
            `;
            viewDbBtn.onmouseover = () => viewDbBtn.style.backgroundColor = '#d68910';
            viewDbBtn.onmouseout = () => viewDbBtn.style.backgroundColor = '#f39c12';
            viewDbBtn.addEventListener('click', () => {
                if (window.JCRDBTools) {
                    window.JCRDBTools.viewDB(null, { processOnly: true });
                } else {
                    alert("dbTools não carregado.");
                }
            });

            toolbar.appendChild(viewDbBtn);
            toolbar.appendChild(statusLabel);

            // Add jcrLattes icon button at far right
            const iconToggle = createJcrToggleIcon(false, (newDisabledState) => {
                if (typeof chrome !== 'undefined' && chrome.storage?.local) {
                    chrome.storage.local.set({ jcr_picctools_disabled: newDisabledState }, () => {
                        renderToolbar(newDisabledState);
                    });
                } else {
                    renderToolbar(newDisabledState);
                }
            });
            toolbar.appendChild(iconToggle);
        };

        renderToolbar(isPiccDisabled);

        if (document.body) {
            document.body.appendChild(toolbar);
        } else if (document.documentElement) {
            document.documentElement.appendChild(toolbar);
        }

        if (isPdfPage && !window.piccToolsDirectPdfProcessed) {
            window.piccToolsDirectPdfProcessed = true;
            processDirectPDF(window.location.href);
        }
    }

    async function extractTableData() {
        const statusLabel = document.getElementById('picc-tools-status');
        // Escrita de status tolerante à ausência do elemento (o restante da função
        // usava statusLabel.innerText direto e quebrava se a toolbar não estivesse montada).
        const setStatus = (msg, color) => {
            if (!statusLabel) return;
            statusLabel.innerText = msg;
            if (color) statusLabel.style.color = color;
        };

        const table = document.getElementById('tabelaPropostas') || document.querySelector('table.dataTable') || document.querySelector('table');

        if (!table) {
            setStatus("Erro: Tabela 'tabelaPropostas' não encontrada na página.", '#ffcccc');
            return;
        }

        const tbody = table.querySelector('tbody#tbodyPropostas') || table.querySelector('tbody');
        if (!tbody) {
            setStatus("Erro: Corpo da tabela não encontrado.", '#ffcccc');
            return;
        }

        // Map column headers dynamically by header text
        const colIndexes = {
            processo: -1,
            proponente: -1,
            uf: -1,
            instituicao: -1,
            chamada: -1,
            parecerAdHoc: -1,
            acoes: -1
        };

        const headerCells = table.querySelectorAll('thead th, thead td');
        headerCells.forEach((th, idx) => {
            const text = (th.innerText || th.textContent || '').trim().toLowerCase();
            if (text.includes('processo') || text.includes('nº do processo') || text.includes('n° do processo')) {
                colIndexes.processo = idx;
            } else if (text.includes('proponente') && !text.includes('uf')) {
                colIndexes.proponente = idx;
            } else if (text.includes('uf')) {
                colIndexes.uf = idx;
            } else if (text.includes('institui')) {
                colIndexes.instituicao = idx;
            } else if (text.includes('chamada') || text.includes('edital')) {
                colIndexes.chamada = idx;
            } else if (text.includes('parecer ad') || text.includes('parecer adhoc') || text.includes('parecer ad-hoc')) {
                colIndexes.parecerAdHoc = idx;
            } else if (text.includes('açõ') || text.includes('acoes')) {
                colIndexes.acoes = idx;
            }
        });

        // Fallbacks if header mapping wasn't found
        if (colIndexes.processo === -1) colIndexes.processo = 1;
        if (colIndexes.proponente === -1) colIndexes.proponente = 2;
        if (colIndexes.uf === -1) colIndexes.uf = 3;
        if (colIndexes.instituicao === -1) colIndexes.instituicao = 4;

        // Parse requested process list from filter input if provided (space-separated)
        const filterInput = document.getElementById('picc-process-filter-input');
        const filterRaw = filterInput ? filterInput.value.trim() : '';
        const targetProcesses = filterRaw ? filterRaw.split(/[\s,;]+/).map(s => s.trim()).filter(s => s.length > 0) : [];
        const normProc = (s) => String(s || '').replace(/[^\d]/g, '');

        // Comparação estrita: exige igualdade do número normalizado OU do número-base
        // (parte antes da "/"). Antes usava includes() bidirecional, o que fazia
        // "409850" casar indevidamente com "4098501/2025-4".
        const baseProc = (s) => String(s || '').split('/')[0].replace(/[^\d]/g, '');
        const matchesProcess = (tableProc, targetProc) => {
            if (!tableProc || !targetProc) return false;
            const cleanTable = tableProc.trim().toLowerCase();
            const cleanTarget = targetProc.trim().toLowerCase();
            if (cleanTable === cleanTarget) return true;
            const normTable = normProc(cleanTable);
            const normTarget = normProc(cleanTarget);
            if (normTable && normTarget && normTable === normTarget) return true;
            const baseTable = baseProc(cleanTable);
            const baseTarget = baseProc(cleanTarget);
            return !!baseTable && !!baseTarget && baseTable === baseTarget;
        };

        const foundTargets = new Set();
        const rows = tbody.querySelectorAll('tr[role="row"], tr');
        let extractedData = [];

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length > 0) {
                const getCellText = (idx) => (idx >= 0 && idx < cells.length) ? cells[idx].innerText.trim() : '';

                const processo = getCellText(colIndexes.processo);
                const proponente = getCellText(colIndexes.proponente);
                const uf = getCellText(colIndexes.uf);
                const instituicao = getCellText(colIndexes.instituicao);
                const chamadaVal = getCellText(colIndexes.chamada);

                // If a process filter list was specified, skip rows that do not match any target process
                if (targetProcesses.length > 0) {
                    const matchedTarget = targetProcesses.find(target => matchesProcess(processo, target));
                    if (!matchedTarget) {
                        return; // Skip this row
                    }
                    foundTargets.add(matchedTarget);
                }

                // Extract numeroProtocolo from links in the row
                let numeroProtocolo = "";
                const protocolLink = row.querySelector('a[href*="numeroProtocolo="]');
                if (protocolLink) {
                    const match = (protocolLink.getAttribute('href') || protocolLink.href || '').match(/numeroProtocolo=(\d+)/);
                    if (match) {
                        numeroProtocolo = match[1];
                    }
                }

                let cvCongelado = "";
                let cvLink = "";
                let pdfLink = "";
                let reviewLinks = [];
                
                // 1. Extract Pareceres Ad Hoc specifically from the "Parecer AdHoc" column cell
                if (colIndexes.parecerAdHoc >= 0 && colIndexes.parecerAdHoc < cells.length) {
                    const adHocCell = cells[colIndexes.parecerAdHoc];
                    const adHocAnchors = adHocCell.querySelectorAll('a');
                    adHocAnchors.forEach(a => {
                        const validUrl = getValidUrlFromAnchor(a);
                        if (validUrl && !reviewLinks.includes(validUrl)) {
                            reviewLinks.push(validUrl);
                        }
                    });
                }

                let supplementaryLink = '';
                const links = row.querySelectorAll('a');
                links.forEach(a => {
                    const text = (a.innerText || a.textContent || '').toLowerCase();
                    const hrefAttr = a.getAttribute('href') || a.href || '';
                    const onclickAttr = a.getAttribute('onclick') || '';
                    const validUrl = getValidUrlFromAnchor(a);

                    // Check for abrirJanelaCriptografada dropdown item / link for PDF da proposta
                    if (onclickAttr.includes('abrirJanelaCriptografada')) {
                        const cryptoMatch = onclickAttr.match(/abrirJanelaCriptografada\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i);
                        if (cryptoMatch) {
                            const arg2 = cryptoMatch[2];
                            const firstChar = arg2 ? arg2.charAt(0) : '';
                            const chamadaId = chamadaVal || '';
                            if (chamadaId && arg2 && firstChar) {
                                pdfLink = `http://anexosform.cnpq.br/doc/${chamadaId}/${firstChar}/${arg2}_cp.pdf`;
                            }
                        }
                    }

                    const cleanText = text.replace(/\s+/g, ' ').trim().toLowerCase();
                    if ((cleanText === 'currículo' || cleanText === 'curriculo') && validUrl) {
                        cvCongelado = validUrl;
                        cvLink = validUrl;
                    }
                    if (!pdfLink && (text.includes('projeto') || text.includes('proposta') || text.includes('imprimir') || hrefAttr.includes('.pdf') || onclickAttr.includes('abrirJanelaCriptografada')) && validUrl) {
                        if (!text.includes('anexo') && !text.includes('suplementar')) {
                            pdfLink = validUrl;
                        }
                    }
                    if ((text.includes('anexo') || text.includes('suplementar') || text.includes('material') || text.includes('plano') || text.includes('documento') || hrefAttr.includes('anexo') || onclickAttr.includes('anexo')) && validUrl) {
                        supplementaryLink = validUrl;
                    }
                    // Fallback if Parecer AdHoc column was not mapped
                    if (colIndexes.parecerAdHoc === -1 && (text.includes('parecer ad') || hrefAttr.includes('emissaoParecer.do')) && validUrl) {
                        if (!reviewLinks.includes(validUrl)) {
                            reviewLinks.push(validUrl);
                        }
                    }
                });

                let edital = chamadaVal || '';
                if (pdfLink && !edital) {
                    const editalMatch = pdfLink.match(/\/doc\/([^\/]+)\//i);
                    if (editalMatch) edital = editalMatch[1];
                }

                if (processo && proponente) {
                    extractedData.push({
                        processId: processo,
                        numeroProtocolo: numeroProtocolo,
                        edital: edital,
                        proponente: {
                            name: proponente,
                            cvLink: cvLink,
                            cvCongelado: cvCongelado,
                            lattesId: "",
                            uf: uf,
                            instituicao: instituicao,
                            isVisible: true
                        },
                        pdfLink: pdfLink,
                        supplementaryLink: supplementaryLink,
                        reviewLinks: reviewLinks
                    });
                }
            }
        });

        // Alert if any requested process numbers were not found in the table
        if (targetProcesses.length > 0) {
            const missing = targetProcesses.filter(target => !foundTargets.has(target));
            if (missing.length > 0) {
                alert(`⚠️ Os seguintes processos da lista não foram encontrados na tabela:\n\n• ${missing.join('\n• ')}`);
            }
            if (extractedData.length === 0) {
                setStatus("Aviso: Nenhum dos processos informados na lista foi encontrado na tabela.", '#ffcccc');
                return;
            }
        }

        console.log("piccTools Extração Concluída:", extractedData);
        
        setStatus(`Baixando PDFs, Pareceres e salvando arquivos de ${extractedData.length} proposta(s)... Aguarde.`, '#fff59d');

        const db = await safeGetDB(true);
        let addedCount = 0;
        let updatedCount = 0;

        // Contadores de falha: uma proposta problemática não deve abortar o lote inteiro.
        let failedCount = 0;
        const failedProcesses = [];
        // Avisos de leitura do PDF (layout não reconhecido) — falham de forma visível
        const parseWarnings = [];

        // Carrega o índice de CVs do piccTools UMA vez para todo o lote
        await beginCvSyncBatch();

        for (const item of extractedData) {
            try {
                // Extract 16-digit Lattes ID and raw HTML from cvCongelado / cvLink
                const targetCvUrl = item.proponente.cvCongelado || item.proponente.cvLink;
                let cvResult = targetCvUrl ? await extractLattesIdAndHtmlFromCvLink(targetCvUrl) : { lattesId: '', htmlText: '' };
                let lattesId = cvResult.lattesId || item.proponente.lattesId || '';
                item.proponente.lattesId = lattesId;
                item.lattesId = lattesId;
                if (lattesId) {
                    item.proponente.cvLink = `http://lattes.cnpq.br/${lattesId}`;
                }

                // Fetch extra data on the fly from PDF
                const pdfResult = item.pdfLink ? await extractTeamFromPDF(item.pdfLink) : { teamMembers: [], edital: '', faixa: '-' };
                const teamMembers = pdfResult.teamMembers || [];
                if (pdfResult.processData && pdfResult.processData.parseWarning) {
                    parseWarnings.push(pdfResult.processData.parseWarning);
                }
                const edital = item.edital || pdfResult.edital || '';
                const faixa = (pdfResult.processData && pdfResult.processData.faixa) || pdfResult.faixa || '-';
                item.faixa = faixa;
                const instExecutora = (pdfResult.processData && pdfResult.processData.instituicaoExecutora) || '';

                // Se o link do CV da tabela não rendeu o ID Lattes, tenta o link do bloco
                // do proponente no PDF. (Antes este fetch ocorria sempre, porque a condição
                // dependia de isValidBolsa(cvResult.bolsa), que era sempre falso.)
                if (pdfResult.processData && pdfResult.processData.proponente && pdfResult.processData.proponente.cvLink) {
                    const pdfCvLink = pdfResult.processData.proponente.cvLink;
                    if (!item.proponente.cvLink) item.proponente.cvLink = pdfCvLink;
                    if (!lattesId) {
                        const pdfCvRes = await extractLattesIdAndHtmlFromCvLink(pdfCvLink);
                        if (pdfCvRes.lattesId) {
                            lattesId = pdfCvRes.lattesId;
                            item.proponente.lattesId = lattesId;
                            item.lattesId = lattesId;
                        }
                    }
                }

                // Bolsa do proponente vem apenas da tabela (o PDF e o CV congelado não a trazem)
                const propBolsa = isValidBolsa(item.proponente.bolsa) ? item.proponente.bolsa : '-';
                item.proponente.bolsa = propBolsa;
                if (pdfResult.processData && pdfResult.processData.proponente && pdfResult.processData.proponente.formacao) {
                    if (!item.proponente.formacao || item.proponente.formacao === '-') {
                        item.proponente.formacao = pdfResult.processData.proponente.formacao;
                    }
                }

                if (!item.supplementaryLink && pdfResult.processData && pdfResult.processData.supplementaryLink) {
                    item.supplementaryLink = pdfResult.processData.supplementaryLink;
                }
                const attachments = (pdfResult.processData && Array.isArray(pdfResult.processData.attachments)) ? pdfResult.processData.attachments : [];
                // Repassa a lista completa de anexos extraída do PDF para saveProcessFiles.
                // Sem isto, apenas o supplementaryLink (1 anexo) era baixado.
                if (attachments.length > 0) item.attachments = attachments;
                const reviews = await extractReviewsFromAdHoc(item.reviewLinks);

                // Save PDF, Lattes HTML, and Parecer HTMLs (with full CSS & icons) to Downloads/picctool/<processId>/
                await saveProcessFiles(item, cvResult.htmlText, reviews);

                const existingIndex = db.findIndex(entry => entry.processId === item.processId || (entry.isProcesso && entry.customId && entry.customId.includes(item.processId)));

                let processRecord;
                if (existingIndex >= 0) {
                    // Update existing
                    let existing = db[existingIndex];
                    existing.isProcesso = true;
                    existing.processId = item.processId;
                    existing.numeroProtocolo = item.numeroProtocolo;
                    existing.edital = edital || existing.edital || '';
                    existing.faixa = faixa || existing.faixa || '-';
                    existing.instituicaoExecutora = instExecutora || existing.instituicaoExecutora || '';
                    existing.pdfLink = item.pdfLink || (pdfResult.processData && pdfResult.processData.pdfLink) || existing.pdfLink || '';
                    existing.lattesId = lattesId || existing.lattesId || '';
                    existing.proponente = item.proponente;
                    existing.teamMembers = teamMembers;
                    existing.attachments = attachments.length > 0 ? attachments : (existing.attachments || []);
                    existing.reviews = reviews;
                    existing.filesDownloaded = true;
                    existing.alreadyDownloaded = true;
                    db[existingIndex] = existing;
                    processRecord = existing;
                    updatedCount++;
                } else {
                    // Create new Processo structure
                    const newEntry = {
                        processId: item.processId,
                        numeroProtocolo: item.numeroProtocolo,
                        edital: edital,
                        faixa: faixa || '-',
                        instituicaoExecutora: instExecutora,
                        isProcesso: true,
                        filesDownloaded: true,
                        alreadyDownloaded: true,
                        customId: item.processId,
                        name: item.proponente.name, // Keep for backward compatibility in table views
                        lattesId: lattesId,
                        proponente: item.proponente,
                        teamMembers: teamMembers,
                        attachments: attachments,
                        reviews: reviews,
                        pdfLink: item.pdfLink || (pdfResult.processData && pdfResult.processData.pdfLink) || '',
                        totalPapers: 0,
                        papersWithJcr: 0,
                        gcCount: 0,
                        firstAuthorCount: 0,
                        lastAuthorCount: 0,
                        wosHIndex: 0,
                        wosCitations: 0,
                        dateAdded: new Date().toISOString()
                    };
                    db.push(newEntry);
                    processRecord = newEntry;
                    addedCount++;
                }

                // Enfileira proponente e equipe; a gravação sai em lote após o laço
                queueResearcherSync(item.proponente.name, lattesId, propBolsa, item.proponente.formacao);
                if (Array.isArray(teamMembers)) {
                    for (const tm of teamMembers) {
                        queueResearcherSync(tm.name, tm.lattesId, tm.bolsa, tm.formacao);
                    }
                }

                console.log(`[piccTools] Informações do Processo ${item.processId}:`, processRecord);

                // Guarda o HTML do CV congelado junto dos demais conteúdos pesados
                if (item.cvHtml) processRecord.cvHtml = item.cvHtml;
                await detachHeavyBlobs(processRecord);

                // Persiste esta proposta imediatamente: uma falha adiante não descarta
                // o que já foi processado (antes, tudo era salvo só ao final do laço).
                await safeSaveDB(processRecord);
            } catch (itemErr) {
                failedCount++;
                failedProcesses.push(item.processId || '(sem número)');
                console.error(`[piccTools] Erro ao processar a proposta ${item.processId}:`, itemErr);
                setStatus(`Erro na proposta ${item.processId}: ${itemErr.message}. Continuando com as demais...`, '#ffcc80');
            }
        }

        // Grava todos os CVs de pesquisadores acumulados em uma única escrita
        await flushCvSyncBatch();

        // (o salvamento das propostas é incremental, dentro do laço — não há flush global aqui)

        // Filter Input line update: remove successfully processed processes from the filter input box
        if (targetProcesses.length > 0) {
            const missingTargets = targetProcesses.filter(target => !foundTargets.has(target));
            if (filterInput) {
                filterInput.value = missingTargets.join(' ');
            }
            if (missingTargets.length > 0) {
                setTimeout(() => {
                    alert(`⚠️ Os seguintes processos da lista não foram encontrados na tabela:\n\n• ${missingTargets.join('\n• ')}`);
                }, 200);
            }
        }

        if (failedCount > 0) {
            setStatus(`Concluído com falhas: ${addedCount} novos, ${updatedCount} atualizados, ${failedCount} com erro (${failedProcesses.join(', ')}). Arquivos salvos em Downloads/piccData/.`, '#ffcc80');
        } else if (parseWarnings.length > 0) {
            setStatus(`Sucesso: ${addedCount} novos, ${updatedCount} atualizados — mas ${parseWarnings.length} PDF(s) não foram lidos corretamente: ${parseWarnings.join('; ')}`, '#ffcc80');
        } else {
            setStatus(`Sucesso: ${addedCount} novos Processos, ${updatedCount} atualizados. Arquivos salvos em Downloads/piccData/.`, '#a5d6a7');
        }

        setTimeout(() => {
            setStatus("");
        }, (failedCount > 0 || parseWarnings.length > 0) ? 20000 : 8000);
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectUI);
    } else {
        injectUI();
    }
    
    // Sometimes CNPq loads pages via AJAX, so we can also observe DOM changes or set a short timeout
    setTimeout(injectUI, 1500);

})();
