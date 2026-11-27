// Roda DENTRO da aba do perfil do Google Scholar (injetada pelo 'fetch_scholar_stats').
// Lê a tabela de citações e conta as publicações, clicando em "Show more" até o fim.
// Se a página for a de verificação do Google ("não sou um robô"), devolve captcha: true
// e não tenta mais nada: a extensão nunca tenta passar por essa verificação.
async function extractScholarMetrics() {
    const espera = (ms) => new Promise(r => setTimeout(r, ms));
    const num = (t) => { const n = parseInt(String(t || '').replace(/[^\d]/g, ''), 10); return isNaN(n) ? null : n; };
    if (/\/sorry\//.test(location.pathname) || document.querySelector('#gs_captcha_f, #recaptcha, form[action*="sorry"]')) {
        return { success: false, captcha: true, error: 'O Google pediu verificação (captcha).' };
    }
    const tabela = document.getElementById('gsc_rsb_st');
    if (!tabela) return { success: false, error: 'Página do perfil não reconhecida.' };

    // linhas: Citations, h-index, i10-index; a primeira coluna de números é "All"
    const linhas = Array.from(tabela.querySelectorAll('tbody tr')).map(tr => {
        const c = tr.querySelector('td.gsc_rsb_std');
        return c ? num(c.textContent) : null;
    });

    // Número de publicações. O perfil mostra as primeiras (até 100, com pagesize=100) e
    // traz as outras em lotes. Em vez de clicar em "Show more" — que numa aba em segundo
    // plano não carregou o lote seguinte (visto no Chrome em 2026-11-26: parou em 100) —,
    // pede cada lote pelo endereço (cstart=100, 200, ...) e conta as linhas da resposta,
    // até vir um lote incompleto. Se um pedido falhar, tenta os cliques; se nem assim
    // chegar ao fim, completo = false e o número vale como mínimo.
    const LOTE = 100;
    const contar = () => document.querySelectorAll('tr.gsc_a_tr').length;
    const mais = () => document.getElementById('gsc_bpf_more');
    const semArtigos = !!document.querySelector('td.gsc_a_e');
    let publicacoes = semArtigos ? 0 : contar();
    let completo = semArtigos || !mais() || mais().disabled;

    if (!completo) {
        const usuario = new URLSearchParams(location.search).get('user');
        let porEndereco = !!usuario;
        for (let inicio = publicacoes, volta = 0; porEndereco && volta < 50; volta++) {
            let html = null;
            try {
                const r = await fetch(`${location.origin}/citations?user=${encodeURIComponent(usuario)}&hl=en&cstart=${inicio}&pagesize=${LOTE}`, { credentials: 'include' });
                if (r.ok && !/\/sorry\//.test(r.url)) html = await r.text();
            } catch (e) { /* cai para os cliques */ }
            if (html === null) { porEndereco = false; break; }
            const noLote = /class="gsc_a_e"/.test(html) ? 0 : (html.match(/class="gsc_a_tr"/g) || []).length;
            publicacoes += noLote;
            inicio += LOTE;
            if (noLote < LOTE) { completo = true; break; }
            await espera(300);
        }
        if (!completo) {
            // reserva: os cliques, contando o que estiver na página
            for (let voltas = 0; mais() && !mais().disabled && voltas < 60; voltas++) {
                const antes = contar();
                mais().click();
                for (let i = 0; i < 60 && contar() === antes && mais() && !mais().disabled; i++) await espera(250);
                if (contar() === antes) break;
            }
            publicacoes = Math.max(publicacoes, contar());
            completo = !mais() || mais().disabled;
        }
    }
    return {
        success: true,
        url: location.href,
        // metodo: 2 = contagem por lotes; dados gravados sem esta marca são da primeira
        // versão (que parava em 100) e não são reaproveitados
        stats: { citations: linhas[0], hIndex: linhas[1], i10Index: linhas[2], publications: publicacoes, completo: completo, metodo: 2 }
    };
}

function extractMetrics() {
    const pageUrl = window.location.href;
    const pageTitle = document.title;
    console.log(`[RID Extraction Script] Injected and started on: ${pageUrl} (${pageTitle})`);
    
    return new Promise((resolve) => {
        try {
            let attempts = 0;
            const interval = setInterval(() => {
                try {
                    attempts++;
                    
                    const blocks = document.querySelectorAll('.wat-author-metric-inline-block');
                    if (blocks.length > 0) {
                        const stats = {
                            hIndex: null,
                            publications: null,
                            wosPublications: null,
                            sumOfTimesCited: null,
                            sumOfTimesCitedWithoutSelf: null,
                            beamplotPercentile: null
                        };

                        blocks.forEach(block => {
                            const valueEl = block.querySelector('.wat-author-metric');
                            const descEl = block.querySelector('.wat-author-metric-descriptor');
                            const subDescEl = block.querySelector('.wat-author-metric-sub-descriptor');

                            if (valueEl && descEl) {
                                const valText = valueEl.textContent.trim().replace(/,/g, '');
                                const val = parseInt(valText, 10);
                                const desc = descEl.textContent.trim();
                                const subDesc = subDescEl ? subDescEl.textContent.trim() : '';

                                if (/^H-Index$/i.test(desc)) {
                                    stats.hIndex = isNaN(val) ? 0 : val;
                                } else if (/^Publications$/i.test(desc)) {
                                    stats.publications = isNaN(val) ? 0 : val;
                                } else if (/^Sum of Times Cited$/i.test(desc)) {
                                    if (/without self-citations/i.test(subDesc)) {
                                        stats.sumOfTimesCitedWithoutSelf = isNaN(val) ? 0 : val;
                                    } else if (!subDesc) {
                                        stats.sumOfTimesCited = isNaN(val) ? 0 : val;
                                    }
                                }
                            }
                        });

                        const summaryItems = document.querySelectorAll('.summary-item');
                        summaryItems.forEach(item => {
                            const labelEl = item.querySelector('.summary-label');
                            const countEl = item.querySelector('.summary-count');
                            if (labelEl && countEl) {
                                const labelText = labelEl.textContent.trim();
                                if (/^Publications indexed in Web of Science$/i.test(labelText)) {
                                    const valText = countEl.textContent.trim().replace(/,/g, '');
                                    const val = parseInt(valText, 10);
                                    stats.wosPublications = isNaN(val) ? 0 : val;
                                }
                            }
                        });

                        const beamplotImgs = document.querySelectorAll('image[aria-label*="annualCitationDot"]');
                        console.log(`[RID Extraction Script] Found ${beamplotImgs.length} beamplot images with 'annualCitationDot'.`);
                        
                        if (beamplotImgs.length > 0) {
                            const beamplotImg = beamplotImgs[beamplotImgs.length - 1];
                            const ariaLabel = beamplotImg.getAttribute('aria-label');
                            console.log(`[RID Extraction Script] Last beamplot image aria-label:`, ariaLabel);
                            
                            const bpMatch = ariaLabel ? ariaLabel.match(/x,\s*([\d.]+)/i) : null;
                            if (bpMatch) {
                                stats.beamplotPercentile = parseFloat(bpMatch[1]);
                                console.log(`[RID Extraction Script] Extracted percentile:`, stats.beamplotPercentile);
                            } else {
                                console.log(`[RID Extraction Script] Failed to parse percentile from aria-label.`);
                            }
                        } else {
                            const allImages = document.querySelectorAll('image');
                            console.log(`[RID Extraction Script] Total <image> elements on page: ${allImages.length}`);
                            if (allImages.length > 0) {
                                const labels = Array.from(allImages).slice(-5).map(img => img.getAttribute('aria-label'));
                                console.log(`[RID Extraction Script] Last 5 <image> aria-labels:`, labels);
                            }
                            
                            // Let's also check for specific elements that Highcharts or similar libraries might use
                            const genericElements = document.querySelectorAll('[aria-label*="citation"]');
                            console.log(`[RID Extraction Script] Total elements with 'citation' in aria-label: ${genericElements.length}`);
                            if (genericElements.length > 0) {
                                const gLabels = Array.from(genericElements).slice(-5).map(el => el.getAttribute('aria-label'));
                                console.log(`[RID Extraction Script] Last 5 'citation' aria-labels:`, gLabels);
                            }
                        }
                        
                        // Wait for critical stats, wosPublications, and the beamplot percentile.
                        // Highcharts may take a few seconds to render the beamplot image elements.
                        // We allow up to 30 attempts (15 seconds) before giving up and using whatever we have.
                        const hasCriticalStats = stats.sumOfTimesCited !== null;
                        const hasWosPubs = stats.wosPublications !== null;
                        const hasBeamplot = stats.beamplotPercentile !== null;
                        
                        // Check if beamplot is locked behind premium access (user logged out or lacks subscription)
                        const premiumOverlay = document.querySelector('.overlay-message');
                        const isPremiumLocked = premiumOverlay && premiumOverlay.textContent.includes('premium feature');
                        if (isPremiumLocked) {
                            console.log(`[RID Extraction Script] Premium feature overlay detected. Beamplot will not load.`);
                        }

                        // If beamplot or wosPublications don't show up within 15 attempts (7.5s), we stop waiting.
                        const isReady = hasCriticalStats && 
                                        (hasWosPubs || attempts > 15) && 
                                        (hasBeamplot || isPremiumLocked || attempts > 15);
                                        
                        // Absolute max 20 attempts (10s) once critical stats are found, to avoid hanging if logged out.
                        if (isReady || attempts > 20) {
                            console.log(`[RID Extraction Script] Finalizing with stats:`, stats);
                            clearInterval(interval);
                            resolve({ success: true, stats, url: pageUrl });
                        }
                    } else if (attempts > 50) { // 25 seconds timeout
                        console.warn(`[RID Extraction Script] Timeout on ${pageUrl}. Title: ${pageTitle}`);
                        clearInterval(interval);
                        resolve({ 
                            success: false, 
                            error: "Timeout waiting for metrics to render.",
                            url: pageUrl,
                            title: pageTitle,
                            bodySnippet: document.body.innerText.substring(0, 500)
                        });
                    }
                } catch (e) {
                    console.warn(`[RID Extraction Script] Error during interval:`, e);
                    clearInterval(interval);
                    resolve({ success: false, error: e.message, url: pageUrl });
                }
            }, 500);
        } catch (e) {
            console.warn(`[RID Extraction Script] Fatal error:`, e);
            resolve({ success: false, error: e.message, url: pageUrl });
        }
    });
}

// Ferramentas de Banco de Dados (DB) devem vir habilitadas por padrão. Instalações antigas
// podem ter 'isUnlocked: false' persistido no storage; forçamos a reativação uma única vez
// nesta atualização (chave de migração dedicada evita reforçar caso o usuário desative de novo).
const DB_FORCE_ENABLE_MIGRATION_KEY = 'jcr_db_force_enable_1_5_10';

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason !== 'update' && details.reason !== 'install') return;

    chrome.storage.local.get(['jcr_private_settings', DB_FORCE_ENABLE_MIGRATION_KEY], (result) => {
        if (result[DB_FORCE_ENABLE_MIGRATION_KEY]) return;

        const settings = result.jcr_private_settings || {};
        settings.isUnlocked = true;

        chrome.storage.local.set({
            jcr_private_settings: settings,
            [DB_FORCE_ENABLE_MIGRATION_KEY]: true
        });
    });
});

// Volta as opcoes ao padrao, uma unica vez, em quem ATUALIZA de uma versao anterior a
// RESET_DE_OPCOES_NA_VERSAO: a 2.0 mudou a paleta e os limiares, e opcoes gravadas por
// versoes antigas (cores, sobretudo) ficavam valendo por cima dos padroes novos. O
// piccTools tambem volta a ficar desligado. So opcoes sao apagadas: curriculos,
// propostas e a autorizacao de membro de CA nao sao tocados.
const RESET_DE_OPCOES_NA_VERSAO = '2.0.2';
const RESET_DE_OPCOES_CHAVE = 'jcr_reset_opcoes_2_0_1';

// a < b, comparando versoes "x.y.z" numero a numero
function versaoMenor(a, b) {
    const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d !== 0) return d < 0;
    }
    return false;
}

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason !== 'update') return;
    if (!versaoMenor(details.previousVersion, RESET_DE_OPCOES_NA_VERSAO)) return;

    chrome.storage.local.get([RESET_DE_OPCOES_CHAVE], (result) => {
        if (result[RESET_DE_OPCOES_CHAVE]) return;
        // opcoes do painel e dos relatorios (limiares, periodo, cores, filtros, layout):
        // sem a chave, valem os padroes do codigo
        chrome.storage.local.remove('jcr_lattes_settings', () => {
            chrome.storage.local.set({
                // opcoes das ferramentas do banco: padrao (isUnlocked e sempre true)
                jcr_private_settings: { isUnlocked: true },
                jcr_picctools_disabled: true,
                [RESET_DE_OPCOES_CHAVE]: true
            });
        });
    });
});

 chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'download_file' && request.url && request.filename) {
        if (!chrome.downloads) { sendResponse({ success: false, error: 'permissão "downloads" indisponível' }); return; }
        chrome.downloads.download({
            url: request.url,
            filename: request.filename,
            conflictAction: 'overwrite',
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.warn('[piccTools Background] Erro ao baixar arquivo:', request.filename, chrome.runtime.lastError.message);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true, downloadId });
            }
        });
        return true;
    }

    if (request.action === 'download_data' && request.data && request.filename) {
        if (!chrome.downloads) { sendResponse({ success: false, error: 'permissão "downloads" indisponível' }); return; }
        const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(request.data);
        chrome.downloads.download({
            url: dataUrl,
            filename: request.filename,
            conflictAction: 'overwrite',
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.warn('[piccTools Background] Erro ao salvar dados:', request.filename, chrome.runtime.lastError.message);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true, downloadId });
            }
        });
        return true;
    }

    // Abre a pagina do banco de dados da extensao (db.html).
    // Content scripts nao podem chamar chrome.tabs.create diretamente; alem disso,
    // abrir via window.open('') criaria a aba na origem do CNPq, que tem zoom e
    // contexto proprios. Centralizar aqui garante origem unica para todas as aberturas.
    if (request.action === 'open_db_page') {
        const view = request.view === 'cvs' ? 'cvs' : 'propostas';
        chrome.tabs.create({ url: chrome.runtime.getURL(`db.html?view=${view}`) }, () => {
            if (chrome.runtime.lastError) {
                console.warn('[JCRLattes] Erro ao abrir db.html:', chrome.runtime.lastError.message);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true });
            }
        });
        return true;
    }

    if (request.action === 'fetch_url' && request.url) {
        fetch(request.url)
            .then(async res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const buffer = await res.arrayBuffer();
                
                // Determine charset from header or default to iso-8859-1 for CNPq pages
                const contentType = res.headers.get('content-type') || '';
                let charset = 'iso-8859-1';
                const match = contentType.match(/charset=([^\s;]+)/i);
                if (match) {
                    const c = match[1].toLowerCase();
                    if (c.includes('utf-8')) charset = 'utf-8';
                    else if (c.includes('iso') || c.includes('latin') || c.includes('windows')) charset = 'iso-8859-1';
                }

                // Peek at HTML meta tag if header was generic
                if (charset === 'iso-8859-1') {
                    const peekText = new TextDecoder('iso-8859-1').decode(buffer.slice(0, 1024));
                    if (/meta[^>]+charset=["']?utf-8/i.test(peekText)) {
                        charset = 'utf-8';
                    }
                }

                const decoder = new TextDecoder(charset);
                return decoder.decode(buffer);
            })
            .then(text => sendResponse({ success: true, text }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (request.action === 'fetch_arraybuffer' && request.url) {
        console.log(`[JCRLattes ServiceWorker] Baixando binário/PDF via background: ${request.url}`);
        fetch(request.url)
            .then(async res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const buffer = await res.arrayBuffer();
                const bytes = new Uint8Array(buffer);
                let binary = '';
                const len = bytes.length;
                for (let i = 0; i < len; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                const base64 = btoa(binary);
                console.log(`[JCRLattes ServiceWorker] Binário baixado com sucesso (${len} bytes)`);
                // o mime é necessário para montar data: URIs corretos ao embutir imagens
                sendResponse({ success: true, base64: base64, mime: res.headers.get('content-type') || '' });
            })
            .catch(err => {
                console.error(`[JCRLattes ServiceWorker] Erro ao baixar binário: ${request.url}`, err);
                sendResponse({ success: false, error: err.message });
            });
        return true;
    }

    // Métricas do perfil no Google Scholar: abre o perfil numa aba em segundo plano, lê
    // (extractScholarMetrics) e fecha. Só aceita endereço de perfil em scholar.google.com.
    if (request.action === 'fetch_scholar_stats' && request.url) {
        if (!/^https:\/\/scholar\.google\.com\/citations\?/.test(request.url)) {
            sendResponse({ success: false, error: 'Endereço do Google Scholar inválido.' });
            return false;
        }
        let abaScholar = null, respondido = false, ouvinte = null;
        const fim = (resposta) => {
            if (respondido) return;
            respondido = true;
            if (ouvinte) chrome.tabs.onUpdated.removeListener(ouvinte);
            if (abaScholar !== null) chrome.tabs.remove(abaScholar).catch(() => {});
            sendResponse(resposta);
        };
        let lendo = false;
        ouvinte = (idAba, mudanca, aba) => {
            if (idAba !== abaScholar || mudanca.status !== 'complete' || lendo) return;
            const url = aba.url || '';
            // o Google mandou para a verificação: para aqui, sem insistir
            if (/google\.[a-z.]+\/sorry\//.test(url)) { fim({ success: false, captcha: true, error: 'O Google pediu verificação (captcha).' }); return; }
            if (!/^https:\/\/scholar\.google\.[a-z.]+\/citations/.test(url)) return;
            lendo = true;
            chrome.scripting.executeScript({ target: { tabId: abaScholar }, func: extractScholarMetrics }, (resultados) => {
                if (chrome.runtime.lastError || !resultados || !resultados[0]) {
                    fim({ success: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Falha ao ler o perfil.' });
                } else {
                    fim(resultados[0].result || { success: false, error: 'Sem resultado.' });
                }
            });
        };
        chrome.tabs.onUpdated.addListener(ouvinte);
        chrome.tabs.create({ url: request.url, active: false }, (aba) => {
            abaScholar = aba.id;
            setTimeout(() => fim({ success: false, error: 'Tempo esgotado (90 s).' }), 90000);
        });
        return true;
    }

    if (request.action === 'fetch_rid_stats' && request.url) {
        console.log(`[RID Extraction Service Worker] Request started for URL: ${request.url}`);
        
        let tabId = null;
        let extractionStarted = false;
        let cleanupDone = false;

        const cleanup = (targetTabId, listener) => {
            if (cleanupDone) return;
            cleanupDone = true;
            if (listener) chrome.tabs.onUpdated.removeListener(listener);
            if (targetTabId) chrome.tabs.remove(targetTabId).catch(() => {});
        };

        const processTab = (targetTabId, url, listener) => {
            if (extractionStarted) return;
            
            if (url.includes('webofscience.com') || url.includes('researcherid.com')) {
                console.log(`[RID Extraction Service Worker] Target reached: ${url}. Injecting script...`);
                extractionStarted = true;
                
                setTimeout(() => {
                    chrome.scripting.executeScript({
                        target: { tabId: targetTabId },
                        func: extractMetrics
                    }, (results) => {
                        if (chrome.runtime.lastError || !results || !results[0]) {
                            const err = chrome.runtime.lastError?.message || "Execution failed";
                            console.warn("[RID Extraction Service Worker] Error:", err);
                            sendResponse({ success: false, error: err });
                        } else {
                            console.log(`[RID Extraction Service Worker] Success:`, results[0].result);
                            sendResponse(results[0].result);
                        }
                        cleanup(targetTabId, listener);
                    });
                }, 1500); // Increased buffer to 1.5s
            }
        };

        let listener = (updatedTabId, changeInfo, updatedTab) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                processTab(tabId, updatedTab.url, listener);
            }
        };

        chrome.tabs.onUpdated.addListener(listener);

        chrome.tabs.create({ url: request.url, active: false }, (tab) => {
            tabId = tab.id;
            
            // Safety timeout
            setTimeout(() => {
                if (!extractionStarted) {
                    console.warn("[RID Extraction Service Worker] Tab load timeout (30s).");
                    sendResponse({ success: false, error: "Tab load timeout (30s)." });
                    cleanup(tabId, listener);
                }
            }, 30000);
        });

        return true; 
    }

    if (request.action === 'open_folder') {
        const folder = request.folder || '';
        if (!chrome.downloads) { sendResponse({ success: false }); return; }

        const abrirPastaPadrao = () => {
            if (chrome.downloads.showDefaultFolder) {
                chrome.downloads.showDefaultFolder();
                sendResponse({ success: true, fallback: true });
            } else {
                sendResponse({ success: false });
            }
        };

        if (!folder) { abrirPastaPadrao(); return true; }

        // chrome.downloads.show() abre o gerenciador de arquivos JA na pasta do arquivo,
        // entao basta achar um download que esteja dentro da pasta da proposta.
        // No Windows o item.filename e um caminho absoluto com barras INVERTIDAS; a busca
        // anterior comparava com a string de barras normais, nunca casava e caia na raiz
        // de Downloads. Normalizamos os separadores dos dois lados antes de comparar.
        const normalizar = (v) => String(v || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        const alvo = normalizar(folder) + '/';

        chrome.downloads.search({ limit: 0, orderBy: ['-startTime'] }, (items) => {
            const encontrado = (items || []).find(i =>
                i && i.exists !== false && i.filename && normalizar(i.filename).includes(alvo));
            if (encontrado && chrome.downloads.show) {
                chrome.downloads.show(encontrado.id);
                sendResponse({ success: true });
            } else {
                console.warn('[piccTools Background] Nenhum arquivo encontrado em', folder, '- abrindo a pasta de Downloads.');
                abrirPastaPadrao();
            }
        });
        return true;
    }
});
