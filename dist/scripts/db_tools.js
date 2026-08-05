/**
 * Available Keys for METRICS_CONFIG:
 * - name: Researcher's name
 * - lattesId: 16-digit CNPq Lattes ID
 * - totalPapers: Total count of complete papers
 * - papersWithJcr: Count of papers with an Impact Factor (JCR)
 * - gcCount: Count of papers where the author is in "et al." / Group Citations
 * - firstAuthorCount: Count of papers as first author
 * - lastAuthorCount: Count of papers as last author
 * - sumAuthors: Sum of all author counts (for average calculation)
 * - sumAuthorsNonGc: Sum of author counts excluding "et al." papers
 * - countNonGc: Count of papers excluding "et al." papers
 * - wosHIndex: H-Index from Web of Science (extracted from Lattes citations table)
 * - wosCitations: Total citations count from Web of Science (extracted from Lattes citations table)
 * - scopusHIndex: H-Index from Scopus (extracted from Lattes citations table)
 * - researcherIdLink: Full URL to the WoS ResearcherID profile
 * - ridHIndex: H-Index directly fetched from ResearcherID profile
 * - ridPublications: Total publication count from ResearcherID profile
 * - ridSumOfTimesCited: Total citations count from ResearcherID profile
 * - ridSumOfTimesCitedWithoutSelf: Citations without self-citations from ResearcherID profile
 * - ridBeamplotPercentile: Beamplot median percentile (decimal) from ResearcherID profile
 * - dateAdded: ISO timestamp of when the CV was saved to DB
 */

window.JCRDBTools = {
    isUnlocked: true,
    autoSave: false,
    reportFiltersCollapsed: false,
    dbPrintOrientation: 'landscape', // melhor padrão para a tabela larga do banco
    dbKey: 'jcr_cv_database', // chave legada (array único); migrada para chaves por CV
    cvKeyPrefix: 'jcr_cv:',
    settingsKey: 'jcr_private_settings',
    currentCvData: null,
    sortConfig: { key: 'name', ascending: true },
    lastArgs: null,
    DB_SCHEMA_VERSION: 2,

    _esc: function(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },

    // Escape a value for use inside a CSS [attr="value"] selector
    _cssAttr: function(str) {
        return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    },

    // True se o CV do banco corresponde ao par (name, lattesId).
    // Quando ambos os lados têm ID Lattes, só o ID decide (evita colisão de homônimos);
    // o nome é usado apenas quando um dos lados não tem ID.
    cvMatches: function (cv, name, lattesId) {
        if (lattesId && cv.lattesId) return cv.lattesId === lattesId;
        return !!name && cv.name === name;
    },

    // Chave de armazenamento individual do CV (preferindo o ID Lattes).
    // Registros de Processo (piccTools) usam chave própria por processo, para não
    // colidirem com o CV do proponente nem entre si (mesmo proponente, vários processos).
    _cvStorageKey: function (cv) {
        if (cv.isProcesso && cv.processId) return this.cvKeyPrefix + 'proc:' + cv.processId;
        return this.cvKeyPrefix + (cv.lattesId ? 'id:' + cv.lattesId : 'nm:' + (cv.name || ''));
    },

    // Escapa e valida uma URL para uso em atributo href ('' se não for http/https)
    _safeUrl: function (url) {
        const s = String(url || '');
        return /^https?:\/\//i.test(s) ? this._esc(s) : '';
    },

    // Returns true if the CV has old-format fields or an outdated schema version that require a re-save
    cvNeedsUpdate: function(cv) {
        if (!cv.dateAdded) return true;
        if ((cv._schemaVersion || 0) < this.DB_SCHEMA_VERSION) return true;
        if (!cv.publications || cv.publications.length === 0) return false;
        if (cv.publications.some(p => p.impactFactor !== undefined || p.isFirstAuthor !== undefined)) return true;
        // All publications lack both journalName and paperTitle → saved before those fields were extracted
        if (cv.publications.every(p => !p.journalName && !p.paperTitle)) return true;
        return false;
    },

    METRICS_CONFIG: [
        { key: 'name', label: 'Nome', title: 'Nome do Pesquisador (link para o Lattes)' },
        { key: 'fellowshipString', label: 'Bolsa', title: 'Bolsa e Nível' },
        { key: 'totalPapers', label: 'Total Artigos', title: 'Total de artigos completos publicados', numeric: true },
        { key: 'papersWithJcr', label: 'Artigos JCR', title: 'Total de artigos com Fator de Impacto (JCR)', numeric: true },
        { key: 'gcCount', label: 'GC (et al)', title: 'Artigos em Grandes Colaborações (et al.)', numeric: true },
        { key: 'firstAuthorCount', label: '1º Autor', title: 'Total de artigos como primeiro autor', numeric: true },
        { key: 'lastAuthorCount', label: 'Últ. Autor', title: 'Total de artigos como último autor', numeric: true },
        { key: 'totalPhdOrientations', label: 'Doutorado', title: 'Orientações de doutorado concluídas', division: true, numeric: true },
        { key: 'totalMscOrientations', label: 'Mestrado', title: 'Orientações de mestrado concluídas', numeric: true },
        { key: 'totalPatents', label: 'Patentes', title: 'Total de patentes e registros', numeric: true },
        { key: 'wosHIndex', label: 'Índice H (WoS)', title: 'Índice H extraído das citações declaradas no Lattes (Web of Science)', division: true, numeric: true },
        { key: 'wosCitations', label: 'Citações (WoS)', title: 'Total de citações da Web of Science extraídas do Lattes', numeric: true },
        // Division 1 starts here
        { key: 'ridHIndex', label: 'Índice H RID', title: 'Índice H da Web of Science (direto do ResearcherID)', division: true, numeric: true },
        { key: 'ridWosPublications', label: 'Pubs WoS', title: 'Publicações indexadas na Web of Science (ResearcherID)', numeric: true },
        { key: 'ridPublications', label: 'Pubs CC', title: 'Publicações da Web of Science Core Collection (ResearcherID)', numeric: true },
        { key: 'ridSumOfTimesCited', label: 'Citações RID', title: 'Soma de Vezes Citado (ResearcherID)', numeric: true },
        { key: 'ridSumOfTimesCitedWithoutSelf', label: 'Citações RID (sem auto)', title: 'Soma de Vezes Citado sem autocitações (ResearcherID)', numeric: true },
        { key: 'researcherIdLink', label: 'RID Link', title: 'Link para o perfil ResearcherID na Web of Science' },
        { key: 'customId', label: 'ID', title: 'ID ou Grupo customizado', customRender: true },
        { key: 'dateAdded', label: 'Atualizado', title: 'Data da última atualização no banco de dados', division: true }
    ],

    init: async function (mountId, nameLink, stats, lattesInfo = [], ridStats = null) {
        this.lastArgs = { nameLink, stats, lattesInfo, ridStats };
        this.extractData(nameLink, stats, lattesInfo, ridStats);
        await this.loadSettings();

        // Check if we are still waiting for ResearcherID stats
        const hasRidLink = !!nameLink.researcherIdLink;
        const isRidPending = hasRidLink && !ridStats;

        if (this.isUnlocked) {
            try {
                const db = await this.getDB();
                const isAlreadyInDb = db.some(cv =>
                    !cv.isProcesso && this.cvMatches(cv, this.currentCvData.name, this.currentCvData.lattesId)
                );

                // Existing CVs: always auto-save immediately — the save protection logic preserves
                // existing RID fields, so we don't need to wait for RID stats to arrive.
                // New CVs with autoSave=true: wait for RID stats before the first save.
                const ridBlocksSave = isRidPending && this.autoSave && !isAlreadyInDb;

                if ((this.autoSave || isAlreadyInDb) && !ridBlocksSave) {
                    if (this._saveTimeout) clearTimeout(this._saveTimeout);
                    this._saveTimeout = setTimeout(() => {
                        if (this.lastArgs) {
                            this.extractData(this.lastArgs.nameLink, this.lastArgs.stats, this.lastArgs.lattesInfo, this.lastArgs.ridStats);
                        }
                        this.saveCurrentCV(true).catch(() => {}); // silent auto-save; suppress unhandled rejection
                    }, 3000);
                }
            } catch (e) {
                console.warn('[JCRLattes] init: could not check DB for existing CV:', e.message);
            }
        }

        this.renderUI(mountId);
    },

    extractData: function (nameLink, stats, lattesInfo = [], ridStats = null) {
        // Recalculate counts directly from lattesInfo to ensure accuracy regardless of JCR loading state
        let totalCount = lattesInfo.length;
        let papersWithJcr = lattesInfo.filter(p => p.impactFactor && parseFloat(p.impactFactor) > 0).length;

        // Extract Lattes ID from the link if possible
        let lattesId = '';
        if (nameLink.link) {
            const match = nameLink.link.match(/id=([^&]+)/);
            if (match) {
                lattesId = match[1];
            } else {
                const parts = nameLink.link.split('/');
                lattesId = parts[parts.length - 1];
            }
        }

        this.currentCvData = {
            name: nameLink.name || 'Desconhecido',
            lattesId: lattesId,
            totalPapers: totalCount,
            papersWithJcr: papersWithJcr,
            gcCount: stats.all.total.gcCount,
            firstAuthorCount: stats.all.total.firstAuthorCount,
            lastAuthorCount: stats.all.total.lastAuthorCount,
            sumAuthors: stats.all.total.sumAuthors,
            sumAuthorsNonGc: stats.all.total.sumAuthorsNonGc,
            countNonGc: stats.all.total.countNonGc,
            wosHIndex: stats.all.citations.wos.hIndex,
            wosCitations: stats.all.citations.wos.sum,
            scopusHIndex: stats.all.citations.scopus.hIndex,
            fellowshipText: nameLink.fellowshipText || '',
            fellowshipString: nameLink.fellowshipString || '',
            researcherIdLink: nameLink.researcherIdLink || '',
            ridHIndex: ridStats?.hIndex !== undefined && ridStats.hIndex !== null ? ridStats.hIndex : '',
            ridPublications: ridStats?.publications !== undefined && ridStats.publications !== null ? ridStats.publications : '',
            ridWosPublications: ridStats?.wosPublications !== undefined && ridStats.wosPublications !== null ? ridStats.wosPublications : '',
            ridSumOfTimesCited: ridStats?.sumOfTimesCited !== undefined && ridStats.sumOfTimesCited !== null ? ridStats.sumOfTimesCited : '',
            ridSumOfTimesCitedWithoutSelf: ridStats?.sumOfTimesCitedWithoutSelf !== undefined && ridStats.sumOfTimesCitedWithoutSelf !== null ? ridStats.sumOfTimesCitedWithoutSelf : '',
            ridBeamplotPercentile: ridStats?.beamplotPercentile !== undefined && ridStats.beamplotPercentile !== null ? ridStats.beamplotPercentile : '',
            ridStats: ridStats || {},
            supervisions: stats.supervisions || {},
            patents: stats.all.patents || { total: 0, statusCounts: {} },
            totalPatents: stats.all.patents?.total || 0,
            totalConcludedOrientations: Object.values(stats.supervisions?.concluded || {}).reduce((sum, arr) => sum + arr.length, 0),
            totalPhdOrientations: Array.isArray(stats.supervisions?.concluded?.['Tese de doutorado']) ? stats.supervisions.concluded['Tese de doutorado'].length : 0,
            totalMscOrientations: Array.isArray(stats.supervisions?.concluded?.['Dissertação de mestrado']) ? stats.supervisions.concluded['Dissertação de mestrado'].length : 0,
            highJcr: stats.highJcr || 7.0,
            lowJcr: stats.lowJcr || 1.5,
            rawPatents: stats.patents || [],
            rawEvents: stats.events || [],
            declaredCitations: stats.declaredCitations || null,
            dateAdded: new Date().toISOString(),
            publications: lattesInfo.map(pub => ({
                year: pub.year,
                issn: pub.issn || '',
                journalName: pub.journalName || pub.title || '',
                paperTitle: pub.paperTitle || '',
                jif: pub.impactFactor ? parseFloat(pub.impactFactor) : 0,
                authorCount: pub.authorCount || 0,
                authorRank: pub.authorRank || -1,
                hasEtAl: pub.hasEtAl,
                wosCitations: pub.wosCitations || 0,
                scopusCitations: pub.scopusCitations || 0,
                doi: pub.doi || '',
                reference: pub.reference || ''
            })),
            _schemaVersion: this.DB_SCHEMA_VERSION
        };
    },

    loadSettings: async function () {
        return new Promise((resolve) => {
            try {
                if (!chrome.runtime?.id) { resolve(); return; }
                chrome.storage.local.get(this.settingsKey, (result) => {
                    if (chrome.runtime.lastError) { resolve(); return; }
                    if (result && result[this.settingsKey]) {
                        this.isUnlocked = result[this.settingsKey].isUnlocked !== undefined ? result[this.settingsKey].isUnlocked : true;
                        this.autoSave = result[this.settingsKey].autoSave !== undefined ? result[this.settingsKey].autoSave : false;
                        this.reportFiltersCollapsed = result[this.settingsKey].reportFiltersCollapsed === true;
                        this.dbPrintOrientation = result[this.settingsKey].dbPrintOrientation === 'portrait' ? 'portrait' : 'landscape';
                    }
                    resolve();
                });
            } catch (e) {
                resolve();
            }
        });
    },

    saveSettings: function () {
        try {
            if (!chrome.runtime?.id) return;
            chrome.storage.local.set({
                [this.settingsKey]: {
                    isUnlocked: this.isUnlocked,
                    autoSave: this.autoSave,
                    reportFiltersCollapsed: this.reportFiltersCollapsed,
                    dbPrintOrientation: this.dbPrintOrientation
                }
            });
        } catch (e) { /* extension context invalidated */ }
    },

    getDB: async function () {
        const items = await new Promise((resolve) => {
            try {
                if (!chrome.runtime?.id) { resolve(null); return; }
                chrome.storage.local.get(null, (result) => {
                    if (chrome.runtime.lastError) { resolve(null); return; }
                    resolve(result || {});
                });
            } catch (e) {
                resolve(null);
            }
        });
        if (!items) return [];

        const db = Object.keys(items)
            .filter(k => k.startsWith(this.cvKeyPrefix))
            .map(k => items[k])
            .filter(cv => cv && cv.name);

        // Migração: formato antigo (array único em dbKey) → uma chave por CV.
        // Cada CV passa a ser gravado isoladamente, evitando que abas concorrentes
        // sobrescrevam o banco inteiro umas das outras (last-write-wins).
        const legacy = items[this.dbKey];
        if (Array.isArray(legacy)) {
            for (const cv of legacy) {
                if (!cv || !cv.name) continue;
                // Dedupe pela chave de armazenamento: preserva Processos (piccTools)
                // e CVs do mesmo pesquisador como registros distintos.
                if (!db.some(c => this._cvStorageKey(c) === this._cvStorageKey(cv))) db.push(cv);
            }
            try {
                await this.saveCVs(db);
                await new Promise((resolve) => {
                    chrome.storage.local.remove(this.dbKey, () => {
                        void chrome.runtime.lastError;
                        resolve();
                    });
                });
            } catch (e) {
                // migração falhou: mantém a chave legada para retentar no próximo acesso
            }
        }

        // Normalize older entries that don't have wosCitations
        db.forEach(cv => {
            if (cv.wosCitations === undefined && cv.publications) {
                let sum = 0;
                cv.publications.forEach(p => {
                    if (p.wosCitations) sum += p.wosCitations;
                });
                cv.wosCitations = sum;
            }
        });
        return db;
    },

    // Grava (upsert) apenas os CVs informados, cada um em sua própria chave.
    // Nunca apaga registros: exclusões passam por removeCVs.
    saveCVs: function (cvArray) {
        return new Promise((resolve, reject) => {
            try {
                if (!chrome.runtime?.id) { reject(new Error('Extension context invalidated')); return; }
                const toSet = {};
                cvArray.forEach(cv => {
                    if (cv && cv.name) toSet[this._cvStorageKey(cv)] = cv;
                });
                if (Object.keys(toSet).length === 0) { resolve(); return; }
                chrome.storage.local.set(toSet, () => {
                    if (chrome.runtime.lastError) {
                        const msg = chrome.runtime.lastError.message || 'Erro desconhecido';
                        console.error('[JCRLattes] saveCVs failed:', msg);
                        this.showToast(`Erro ao salvar: ${msg}`, '#c62828');
                        reject(new Error(msg));
                    } else {
                        resolve();
                    }
                });
            } catch (e) {
                reject(e);
            }
        });
    },

    removeCVs: function (cvArray) {
        return new Promise((resolve, reject) => {
            try {
                if (!chrome.runtime?.id) { reject(new Error('Extension context invalidated')); return; }
                const keys = cvArray.map(cv => this._cvStorageKey(cv));
                if (keys.length === 0) { resolve(); return; }
                chrome.storage.local.remove(keys, () => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve();
                });
            } catch (e) {
                reject(e);
            }
        });
    },

    // Upsert de um CV; remove a chave antiga se o registro mudou de chave
    // (ex.: CV salvo antes sem lattesId que agora tem ID).
    upsertCV: async function (cvData, existingCv = null) {
        if (existingCv && this._cvStorageKey(existingCv) !== this._cvStorageKey(cvData)) {
            await this.removeCVs([existingCv]);
        }
        await this.saveCVs([cvData]);
    },

    // Compatibilidade (usado pelo piccTools): upsert de todos os CVs do array.
    saveDB: function (dbArray) {
        return this.saveCVs(dbArray);
    },

    saveCurrentCV: async function (silent = false) {
        // Ensure we have the latest data before saving
        if (this.lastArgs) {
            this.extractData(this.lastArgs.nameLink, this.lastArgs.stats, this.lastArgs.lattesInfo, this.lastArgs.ridStats);
        }

        const db = await this.getDB();
        // Ignora registros de Processo (piccTools): o save de um CV do Lattes
        // nunca deve substituir/remover um Processo do mesmo proponente.
        const existing = db.find(cv =>
            !cv.isProcesso && this.cvMatches(cv, this.currentCvData.name, this.currentCvData.lattesId)
        ) || null;
        if (existing) {

            // Define RID-related fields that we want to protect from being overwritten by null/empty values
            const ridFields = [
                'ridHIndex', 'ridPublications', 'ridWosPublications', 'ridSumOfTimesCited', 
                'ridSumOfTimesCitedWithoutSelf', 'ridBeamplotPercentile', 
                'ridStats'
            ];

            // Define JCR/WoS fields that we want to protect if the new extraction results in zeros
            // but the previous one had non-zero values (suggesting an incomplete load)
            const jcrFields = ['papersWithJcr', 'wosHIndex', 'scopusHIndex', 'wosCitations'];

            // Check if the current extraction was successful for RID.
            // We consider it failed if ridHIndex is empty string (default when ridStats is null/undefined)
            const isNewRidSuccessful = this.currentCvData.ridHIndex !== '';

            if (!isNewRidSuccessful) {
                // Preserve existing RID data if the new extraction doesn't have it
                ridFields.forEach(field => {
                    if (existing[field] !== undefined && existing[field] !== null && existing[field] !== '') {
                        this.currentCvData[field] = existing[field];
                    }
                });
                
                // Also preserve the link if it was missing in the new data but exists in the DB
                if (!this.currentCvData.researcherIdLink && existing.researcherIdLink) {
                    this.currentCvData.researcherIdLink = existing.researcherIdLink;
                }
            }

            // Protect JCR/WoS fields from being overwritten by incomplete page loads.
            // If the new paper count is lower than what was previously saved, treat it as a
            // partial load (Lattes AJAX still running) and restore all previous metric values.
            const isPartialLoad = existing.totalPapers > 0 &&
                this.currentCvData.totalPapers < existing.totalPapers;
            jcrFields.forEach(field => {
                const newVal = this.currentCvData[field];
                const oldVal = existing[field];
                if (isPartialLoad && oldVal && oldVal !== 0 && oldVal !== '') {
                    this.currentCvData[field] = oldVal;
                } else if ((newVal === 0 || newVal === '') && oldVal && oldVal !== 0 && oldVal !== '') {
                    if (this.currentCvData.totalPapers > 0) {
                        this.currentCvData[field] = oldVal;
                    }
                }
            });
            
            // Preserve custom ID
            if (existing.customId !== undefined) {
                this.currentCvData.customId = existing.customId;
            } else {
                this.currentCvData.customId = '';
            }
        } else {
            if (this.currentCvData.customId === undefined) {
                this.currentCvData.customId = '';
            }
        }
        // Grava só este CV (chave própria) — abas concorrentes não se sobrescrevem
        await this.upsertCV(this.currentCvData, existing);
        if (!silent) this.showToast('CV Salvo no Banco de Dados!');
    },

    // Abre o relatório individual do CV atualmente exibido na página do Lattes
    viewCurrentReport: function () {
        if (this.lastArgs) {
            this.extractData(this.lastArgs.nameLink, this.lastArgs.stats, this.lastArgs.lattesInfo, this.lastArgs.ridStats);
        }
        if (!this.currentCvData) {
            alert('Os dados do CV ainda estão sendo carregados. Tente novamente em instantes.');
            return;
        }
        const newTab = window.open('', '_blank');
        if (!newTab) {
            alert('Por favor, permita pop-ups para abrir o relatório.');
            return;
        }
        this.renderCVReport(this.currentCvData, newTab);
    },

    deleteSingleCV: async function (name, lattesId = '') {
        const db = await this.getDB();
        const existing = db.find(cv => this.cvMatches(cv, name, lattesId));
        if (existing) {
            await this.removeCVs([existing]);
        }
    },

    clearDB: async function (silent = false) {
        if (silent || confirm("Tem certeza que deseja apagar todos os CVs salvos?")) {
            const db = await this.getDB();
            await this.removeCVs(db);
            if (!silent) this.showToast('Banco de dados limpo!');
        }
    },

    promptUnlock: function () {
        this.isUnlocked = true;
        this.saveSettings();
        const mount = document.getElementById('jcr-db-tools-mount');
        if (mount) this.renderUI('jcr-db-tools-mount');
    },

    lock: function () {
        this.isUnlocked = false;
        this.saveSettings();
        const mount = document.getElementById('jcr-db-tools-mount');
        if (mount) this.renderUI('jcr-db-tools-mount');
    },

    toggleAutoSave: function () {
        this.autoSave = !this.autoSave;
        this.saveSettings();
        if (this.autoSave) {
            this.saveCurrentCV(); // Save immediately if turned on
        }
        const mount = document.getElementById('jcr-db-tools-mount');
        if (mount) this.renderUI('jcr-db-tools-mount');
    },

    getJaccardSimilarity: function(str1, str2, cacheMap) {
        if (!str1 || !str2) return 0;

        const getSet = (str) => {
            if (cacheMap && cacheMap.has(str)) return cacheMap.get(str);
            const normalize = s => s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2);
            const set = new Set(normalize(str));
            if (cacheMap) cacheMap.set(str, set);
            return set;
        };

        const set1 = getSet(str1);
        const set2 = getSet(str2);

        if (set1.size === 0 && set2.size === 0) return 1;
        if (set1.size === 0 || set2.size === 0) return 0;

        let intersectionSize = 0;
        const [smallerSet, largerSet] = set1.size < set2.size ? [set1, set2] : [set2, set1];
        for (const x of smallerSet) {
            if (largerSet.has(x)) intersectionSize++;
        }
        
        const unionSize = set1.size + set2.size - intersectionSize;
        return intersectionSize / unionSize;
    },

    deduplicateItems: function(items, exactKey, textKey, threshold = 0.8) {
        const unique = [];
        const cacheMap = new Map();
        for (const item of items) {
            let isDuplicate = false;
            for (const existing of unique) {
                // Exact match (e.g. DOI or registration number)
                if (exactKey && item[exactKey] && existing[exactKey] && item[exactKey] === existing[exactKey]) {
                    isDuplicate = true;
                    break;
                }
                // Fuzzy match using textKey (e.g. reference)
                if (textKey && item[textKey] && existing[textKey]) {
                    const sim = this.getJaccardSimilarity(item[textKey], existing[textKey], cacheMap);
                    if (sim > threshold) {
                        isDuplicate = true;
                        break;
                    }
                }
            }
            if (!isDuplicate) {
                unique.push(item);
            }
        }
        return unique;
    },

    viewDB: async function (existingTab = null) {
        let db = await this.getDB();
        
        // Sort data based on current configuration
        db.sort((a, b) => {
            let valA = a[this.sortConfig.key];
            let valB = b[this.sortConfig.key];
            
            // Normalize values for sorting
            if (valA === undefined || valA === null) valA = '';
            if (valB === undefined || valB === null) valB = '';

            let comparison = 0;
            if (typeof valA === 'number' && typeof valB === 'number') {
                comparison = valA - valB;
            } else {
                // Use numeric: true for strings that might contain numbers (like IDs or versions)
                comparison = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
            }
            
            return this.sortConfig.ascending ? comparison : -comparison;
        });

        let newTab = existingTab;
        if (!newTab || newTab.closed) {
            newTab = window.open('', '_blank');
            if (!newTab) {
                alert("Por favor, permita pop-ups para abrir a visualização do banco de dados.");
                return;
            }
        }

        // Generate HTML for the table
        let tableHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>JCR Lattes - Banco de CVs</title>
                <meta charset="utf-8">
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; background-color: #f5f5f5; color: #333; }
                    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; background: #fff; padding: 15px 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                    h1 { margin: 0; color: #1565C0; font-size: 24px; }
                    .btn { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px; transition: background 0.2s; }
                    .btn-export { background-color: #2E7D32; color: white; }
                    .btn-export:hover { background-color: #1B5E20; }
                    .btn-clear { background-color: #d32f2f; color: white; margin-left: 10px; }
                    .btn-clear:hover { background-color: #b71c1c; }
                    .btn-refresh { background-color: #1976D2; color: white; margin-right: 10px; }
                    .btn-refresh:hover { background-color: #1565C0; }
                    .btn-view-report { background-color: #E3F2FD; color: #333; padding: 4px 6px; font-size: 14px; margin-right: 5px; border: 1px solid #90CAF9; border-radius: 4px; }
                    .btn-view-report:hover { background-color: #BBDEFB; }
                    .btn-rename-id { background-color: #FFF8E1; color: #333; padding: 4px 6px; font-size: 14px; margin-right: 5px; border: 1px solid #FFE082; border-radius: 4px; }
                    .btn-rename-id:hover { background-color: #FFECB3; }
                    .btn-clear-id { background-color: #FFF3E0; color: #333; padding: 4px 6px; font-size: 14px; margin-right: 5px; border: 1px solid #FFCC80; border-radius: 4px; }
                    .btn-clear-id:hover { background-color: #FFE0B2; }
                    .btn-delete-row { background-color: #FFEBEE; color: #333; padding: 4px 6px; font-size: 14px; border: 1px solid #EF9A9A; border-radius: 4px; }
                    .btn-delete-row:hover { background-color: #FFCDD2; }
                    .btn-export-group { background-color: #E8F5E9; color: #333; padding: 4px 6px; font-size: 14px; margin-right: 5px; border: 1px solid #A5D6A7; border-radius: 4px; }
                    .btn-export-group:hover { background-color: #C8E6C9; }
                    .table-container { background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow-x: auto; }
                    table { width: 100%; border-collapse: collapse; }
                    th, td { padding: 8px 10px; border-bottom: 1px solid #eee; line-height: 1.2; }
                    th { background-color: #f8f9fa; font-weight: 600; color: #555; position: sticky; top: 0; font-size: 0.85em; white-space: normal; vertical-align: bottom; }
                    .sortable-header { cursor: pointer; user-select: none; transition: background 0.2s; }
                    th.sortable-header:hover { background-color: #f0f0f0; }
                    .sort-indicator { margin-left: 3px; font-size: 0.75em; }
                    .division-left { border-left: 1px solid #bbb !important; }
                    .division-right { border-right: 1px solid #bbb !important; }
                    .rid-link-cell { text-align: center; }
                    .numeric-cell { text-align: center; }
                    tr:hover { background-color: #f9f9f9; }
                    .name-cell { min-width: 150px; }

                    @media print {
                        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                        body { background: #fff !important; padding: 0 !important; }
                        .header { box-shadow: none; padding: 0 0 10px 0; }
                        .header > div { display: none !important; }            /* botões do topo */
                        .group-summary { display: none !important; }           /* bloco de resumo do grupo */
                        .table-container { box-shadow: none; overflow: visible; }

                        /* Coluna de checkboxes (primeira) e de ações (última) */
                        th:first-child, td:first-child,
                        th:last-child, td:last-child { display: none !important; }

                        /* Ícones e controles dentro da tabela */
                        .sort-indicator, .stale-icon, .rid-link-cell a,
                        #bulk-id-input, #bulk-id-select, .custom-id-select { display: none !important; }
                        .custom-id-input { border: none !important; background: transparent !important; padding: 0 !important; }

                        tr { break-inside: avoid; page-break-inside: avoid; }
                        thead { display: table-header-group; }
                        table { font-size: 8pt; }
                    }
                </style>
            </head>
            <body>
                <style id="print-orientation-style">@page { size: ${this.dbPrintOrientation}; }</style>
                <div class="header">
                    <h1>JCR Lattes - Banco de CVs (${db.length})</h1>
                    <div>
                        <select id="print-orientation-select" title="Orientação da página na impressão" style="padding: 7px; margin-right: 10px; border-radius: 4px; border: 1px solid #ccc; background: white; cursor: pointer;">
                            <option value="landscape"${this.dbPrintOrientation === 'landscape' ? ' selected' : ''}>🖨️ Paisagem</option>
                            <option value="portrait"${this.dbPrintOrientation === 'portrait' ? ' selected' : ''}>🖨️ Retrato</option>
                        </select>
                        <button id="refreshBtn" class="btn btn-refresh">🔄 Atualizar Lista</button>
                        <button id="exportBtn" class="btn btn-export">📊 Exportar (CSV)</button>
                        <button id="exportJsonBtn" class="btn btn-export" style="background-color: #f39c12;">📥 Backup (JSON)</button>
                        <button id="importJsonBtn" class="btn btn-export" style="background-color: #8e44ad;">📤 Restaurar (JSON)</button>
                        <input type="file" id="importJsonInput" style="display:none" accept=".json">
                        <button id="clearBtn" class="btn btn-clear">🗑️ Apagar Banco de Dados</button>
                    </div>
                </div>
                <div class="table-container">
        `;

        if (db.length === 0) {
            tableHtml += `<div class="empty-msg">Nenhum CV salvo no banco de dados.</div>`;
        } else {
            const uniqueIds = Array.from(new Set(
                db.flatMap(cv => (cv.customId || '').split(',').map(s => s.trim()).filter(s => s !== ''))
            )).sort();
            let dropdownOptionsHtml = `<option value="">&#9660;</option>`;
            let groupOptions = `<option value="">-- Selecione um Grupo --</option><option value="__selecionados__">✔ CVs selecionados</option>`;
            uniqueIds.forEach(id => {
                const safeId = this._esc(id);
                dropdownOptionsHtml += `<option value="${safeId}">${safeId}</option>`;
                groupOptions += `<option value="${safeId}">${safeId}</option>`;
            });

            tableHtml += `
                <div class="group-summary" style="margin-bottom: 20px; padding: 15px; background: #E8F5E9; border: 1px solid #C8E6C9; border-radius: 8px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <div>
                            <strong>Resumo do Grupo:</strong> 
                            <select id="group-id-select" style="padding: 5px; margin-left: 10px; border-radius: 4px; border: 1px solid #ccc; background: white;">
                                ${groupOptions}
                            </select>
                        </div>
                        <div id="group-actions-container" style="display: none; align-items: center;">
                            <button id="group-btn-report" class="btn btn-view-report" title="Relatório do Grupo">📊</button>
                            <button id="group-btn-export-json" class="btn btn-export-group" title="Salvar JSON deste grupo">📥</button>
                            <button id="group-btn-rename" class="btn btn-rename-id" title="Renomear ID deste grupo">✏️</button>
                            <button id="group-btn-clear" class="btn btn-clear-id" title="Limpar este ID de todos os CVs">🧹</button>
                            <button id="group-btn-delete" class="btn btn-delete-row" title="Excluir todos os CVs deste grupo">🗑️</button>
                        </div>
                    </div>
                    <div id="group-stats-display" style="display: none; padding: 10px; background: #fff; border-radius: 4px; border: 1px solid #eee;">
                        <table style="width: 100%; text-align: center;">
                            <tr>
                                <th style="background: none; border-bottom: 1px solid #eee; color: #1565C0;">Membros</th>
                                <th style="background: none; border-bottom: 1px solid #eee;">Total Artigos</th>
                                <th style="background: none; border-bottom: 1px solid #eee;">Artigos JCR</th>
                                <th style="background: none; border-bottom: 1px solid #eee;">GC (et al)</th>
                                <th style="background: none; border-bottom: 1px solid #eee;">Citações (WoS)</th>
                                <th style="background: none; border-bottom: 1px solid #eee;">H-Index (WoS)</th>
                                <th style="background: none; border-bottom: 1px solid #eee;">Doutorado</th>
                                <th style="background: none; border-bottom: 1px solid #eee;">Mestrado</th>
                                <th style="background: none; border-bottom: 1px solid #eee;">Patentes</th>
                            </tr>
                            <tr>
                                <td id="gstat-membros" style="font-size: 1.2em; font-weight: bold; border: none; color: #1565C0;">0</td>
                                <td id="gstat-total" style="font-size: 1.2em; font-weight: bold; border: none;">0</td>
                                <td id="gstat-jcr" style="font-size: 1.2em; font-weight: bold; border: none;">0</td>
                                <td id="gstat-gc" style="font-size: 1.2em; font-weight: bold; border: none;">0</td>
                                <td id="gstat-citacoes" style="font-size: 1.2em; font-weight: bold; border: none;">0</td>
                                <td id="gstat-hindex" style="font-size: 1.2em; font-weight: bold; border: none;">0</td>
                                <td id="gstat-doutorado" style="font-size: 1.2em; font-weight: bold; border: none;">0</td>
                                <td id="gstat-mestrado" style="font-size: 1.2em; font-weight: bold; border: none;">0</td>
                                <td id="gstat-patentes" style="font-size: 1.2em; font-weight: bold; border: none;">0</td>
                            </tr>
                        </table>
                    </div>
                </div>
            `;

            let theadHtml = `<tr>`;
            theadHtml += `<th style="width: 30px; text-align: center;"><input type="checkbox" id="selectAllCheckbox" title="Selecionar Todos"></th>`;
            const targetRank = (this.reportState && this.reportState.targetAuthorRank) ? parseInt(this.reportState.targetAuthorRank) : 1;
            this.METRICS_CONFIG.forEach(m => {
                const arrow = this.sortConfig.key === m.key ? (this.sortConfig.ascending ? ' ▲' : ' ▼') : '';
                let label = m.label;
                let title = m.title;
                if (m.key === 'firstAuthorCount') {
                    label = `${targetRank}º Autor`;
                    title = `Total de artigos como ${targetRank}º autor`;
                }
                const titleAttr = title ? ` title="${title}"` : '';
                let classes = ['sortable-header'];
                if (m.division) classes.push('division-left');
                if (m.numeric) classes.push('numeric-cell');
                const classAttr = ` class="${classes.join(' ')}"`;
                
                if (m.key === 'customId') {
                    theadHtml += `<th${titleAttr} data-key="${m.key}"${classAttr}>
                        ${label}<span class="sort-indicator">${arrow}</span><br>
                        <div style="display: flex; gap: 2px; margin-top: 4px;">
                            <input type="text" id="bulk-id-input" placeholder="Lote..." style="width: 100%; min-width: 60px; padding: 2px 4px; font-weight: normal; border: 1px solid #ccc; border-radius: 3px; box-sizing: border-box;">
                            <select id="bulk-id-select" style="width: 24px; border: 1px solid #ccc; border-radius: 3px; background: white;" title="Selecionar ID Existente">${dropdownOptionsHtml}</select>
                        </div>
                    </th>`;
                } else {
                    theadHtml += `<th${titleAttr} data-key="${m.key}"${classAttr}>${label}<span class="sort-indicator">${arrow}</span></th>`;
                }
            });
            theadHtml += `<th class="division-left" style="font-size: 0.85em; text-align: center; white-space: nowrap;">
                Ações<br>
                <div style="margin-top: 4px;">
                    <button id="bulk-btn-report" style="border:1px solid #ccc; border-radius:3px; cursor:pointer; background:#fff; padding:2px 4px;" title="Relatório dos Selecionados">📊</button>
                    <button id="bulk-btn-clear" style="border:1px solid #ccc; border-radius:3px; cursor:pointer; background:#fff; padding:2px 4px;" title="Limpar ID dos Selecionados">🧹</button>
                    <button id="bulk-btn-delete" style="border:1px solid #ccc; border-radius:3px; cursor:pointer; background:#fff; padding:2px 4px;" title="Excluir Selecionados">🗑️</button>
                    <button id="bulk-btn-open" style="border:1px solid #ccc; border-radius:3px; cursor:pointer; background:#fff; padding:2px 4px;" title="Abrir CVs selecionados no Lattes para atualizar">🔄</button>
                </div>
            </th></tr>`;

            let tbodyHtml = ``;
            db.forEach(cv => {
                tbodyHtml += `<tr>`;
                tbodyHtml += `<td style="text-align: center;"><input type="checkbox" class="row-checkbox" data-name="${this._esc(cv.name || '')}" data-lattesid="${this._esc(cv.lattesId || '')}" data-needs-update="${this.cvNeedsUpdate(cv) ? 'true' : 'false'}"></td>`;
                this.METRICS_CONFIG.forEach(m => {
                    const val = cv[m.key] !== undefined ? cv[m.key] : '';
                    let classes = [];
                    if (m.division) classes.push('division-left');
                    if (m.numeric) classes.push('numeric-cell');
                    if (m.key === 'name') classes.push('name-cell');
                    const classAttr = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';

                    if (m.key === 'name') {
                        const lattesLink = cv.lattesId ? `http://lattes.cnpq.br/${this._esc(cv.lattesId)}` : '#';
                        tbodyHtml += `<td${classAttr}><strong><a href="${lattesLink}" target="_blank" style="color: #1565C0; text-decoration: none;">${this._esc(String(val))}</a></strong></td>`;
                    } else if (m.key === 'firstAuthorCount') {
                        let count = 0;
                        if (cv.publications && Array.isArray(cv.publications)) {
                            count = cv.publications.filter(p => {
                                if (targetRank === 1) {
                                    return p.authorRank === 1 || (p.authorRank === undefined && p.isFirstAuthor);
                                }
                                return p.authorRank === targetRank;
                            }).length;
                        } else {
                            count = cv.firstAuthorCount || 0;
                        }
                        tbodyHtml += `<td${classAttr}>${count}</td>`;
                    } else if (m.key === 'researcherIdLink') {
                        const safeRid = this._safeUrl(val);
                        if (safeRid) {
                            tbodyHtml += `<td class="rid-link-cell"><a href="${safeRid}" target="_blank" title="ResearcherID" style="text-decoration:none; font-size:1.2em;">🔗</a></td>`;
                        } else {
                            tbodyHtml += `<td></td>`;
                        }
                    } else if (m.key === 'dateAdded') {
                        const dateStr = val ? new Date(val).toLocaleDateString() : '';
                        tbodyHtml += `<td${classAttr} style="text-align: center; white-space: nowrap;">${dateStr}</td>`;
                    } else if (m.key === 'customId') {
                        tbodyHtml += `<td${classAttr}>
                            <div style="display: flex; gap: 2px;">
                                <input type="text" class="custom-id-input" data-name="${this._esc(cv.name || '')}" data-lattesid="${this._esc(cv.lattesId || '')}" value="${this._esc(String(val))}" placeholder="ID..." style="width: 100%; min-width: 100px; padding: 2px 4px; border: 1px solid #ccc; border-radius: 3px; box-sizing: border-box;">
                                <select class="custom-id-select" data-name="${this._esc(cv.name || '')}" data-lattesid="${this._esc(cv.lattesId || '')}" style="width: 24px; border: 1px solid #ccc; border-radius: 3px; background: white;" title="Adicionar ID Existente">${dropdownOptionsHtml}</select>
                            </div>
                        </td>`;
                    } else {
                        tbodyHtml += `<td${classAttr}>${this._esc(String(val))}</td>`;
                    }
                });
                const needsUpdate = this.cvNeedsUpdate(cv);
                tbodyHtml += `<td class="division-left" style="white-space: nowrap;">
                    <button class="btn btn-view-report" data-name="${this._esc(cv.name || '')}" data-lattesid="${this._esc(cv.lattesId || '')}" title="Relatório">📊</button>
                    <button class="btn btn-clear-id" data-name="${this._esc(cv.name || '')}" data-lattesid="${this._esc(cv.lattesId || '')}" title="Limpar ID">🧹</button>
                    <button class="btn btn-delete-row" data-name="${this._esc(cv.name || '')}" data-lattesid="${this._esc(cv.lattesId || '')}" title="Excluir">🗑️</button>
                    <button class="btn btn-open-cv" data-lattesid="${this._esc(cv.lattesId || '')}" title="${needsUpdate ? 'CV desatualizado: abrir no Lattes para atualizar' : 'Abrir no Lattes'}">${needsUpdate ? '⚠️' : '🔄'}</button>
                </td></tr>`;
            });

            tableHtml += `
                <table>
                    <thead>
                        ${theadHtml}
                    </thead>
                    <tbody>
                        ${tbodyHtml}
                    </tbody>
                </table>
            `;
        }

        tableHtml += `
                </div>
            </body>
            </html>
        `;
        
        newTab.document.open();
        newTab.document.write(tableHtml);
        newTab.document.close();

        // Attach events directly to avoid Content Security Policy (CSP) inline script errors
        const exportBtn = newTab.document.getElementById('exportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.exportCSV();
            });
        }

        const exportJsonBtn = newTab.document.getElementById('exportJsonBtn');
        if (exportJsonBtn) {
            exportJsonBtn.addEventListener('click', () => {
                this.exportJSON();
            });
        }

        const importJsonBtn = newTab.document.getElementById('importJsonBtn');
        const importJsonInput = newTab.document.getElementById('importJsonInput');
        if (importJsonBtn && importJsonInput) {
            importJsonBtn.addEventListener('click', () => {
                importJsonInput.click();
            });
            importJsonInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.importJSON(file).then(() => {
                        this.viewDB(newTab);
                    });
                }
            });
        }

        const refreshBtn = newTab.document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.viewDB(newTab);
            });
        }

        // Orientação da impressão: atualiza a regra @page e persiste a escolha.
        // (Fixar @page direto no CSS travaria o seletor do diálogo de impressão do Chrome.)
        const orientationSelect = newTab.document.getElementById('print-orientation-select');
        if (orientationSelect) {
            orientationSelect.addEventListener('change', (e) => {
                this.dbPrintOrientation = e.target.value === 'portrait' ? 'portrait' : 'landscape';
                const styleEl = newTab.document.getElementById('print-orientation-style');
                if (styleEl) styleEl.textContent = `@page { size: ${this.dbPrintOrientation}; }`;
                this.saveSettings();
            });
        }

        const clearBtn = newTab.document.getElementById('clearBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (newTab.confirm("Tem certeza que deseja apagar todos os CVs salvos?")) {
                    this.clearDB(true).then(() => {
                        this.viewDB(newTab);
                    });
                }
            });
        }

        const deleteBtns = newTab.document.querySelectorAll('.btn-delete-row');
        deleteBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const name = e.currentTarget.getAttribute('data-name');
                const lattesId = e.currentTarget.getAttribute('data-lattesid');
                if (newTab.confirm(`Tem certeza que deseja apagar o CV de ${name}?`)) {
                    this.deleteSingleCV(name, lattesId).then(() => {
                        this.viewDB(newTab);
                    });
                }
            });
        });

        const customIdInputs = newTab.document.querySelectorAll('.custom-id-input');
        const customIdSelects = newTab.document.querySelectorAll('.custom-id-select');
        
        const updateAllDropdowns = (db) => {
            const uniqueIds = Array.from(new Set(
                db.flatMap(cv => (cv.customId || '').split(',').map(s => s.trim()).filter(s => s !== ''))
            )).sort();

            let newOptionsHtml = `<option value="">&#9660;</option>`;
            uniqueIds.forEach(id => {
                const safeId = this._esc(id);
                newOptionsHtml += `<option value="${safeId}">${safeId}</option>`;
            });

            const allSelects = newTab.document.querySelectorAll('.custom-id-select, #bulk-id-select');
            allSelects.forEach(select => {
                select.innerHTML = newOptionsHtml;
            });
            
            // Also update the group select
            const groupSelect = newTab.document.getElementById('group-id-select');
            if (groupSelect) {
                const currentVal = groupSelect.value;
                let groupOptions = `<option value="">-- Selecione um Grupo --</option><option value="__selecionados__"${currentVal === '__selecionados__' ? ' selected' : ''}>✔ CVs selecionados</option>`;
                uniqueIds.forEach(id => {
                    const safeId = this._esc(id);
                    const selected = id === currentVal ? ' selected' : '';
                    groupOptions += `<option value="${safeId}"${selected}>${safeId}</option>`;
                });
                groupSelect.innerHTML = groupOptions;
            }
        };

        const findCvIndex = (dbArr, name, lattesId) => dbArr.findIndex(cv => this.cvMatches(cv, name, lattesId));

        const updateCustomId = async (name, lattesId, newValue, inputEl) => {
            const freshDb = await this.getDB();
            const cvIndex = findCvIndex(freshDb, name, lattesId);
            if (cvIndex >= 0) {
                let finalIds = newValue.split(',').map(s => s.trim()).filter(s => s !== '');
                const finalValue = finalIds.join(', ');

                freshDb[cvIndex].customId = finalValue;
                await this.saveCVs([freshDb[cvIndex]]);
                updateAllDropdowns(freshDb);

                const localIndex = findCvIndex(db, name, lattesId);
                if (localIndex >= 0) db[localIndex].customId = finalValue;

                if (inputEl) inputEl.value = finalValue;
            }
        };

        customIdInputs.forEach(input => {
            input.addEventListener('change', async (e) => {
                const name = e.currentTarget.getAttribute('data-name');
                const lattesId = e.currentTarget.getAttribute('data-lattesid');
                const newValue = e.currentTarget.value;
                await updateCustomId(name, lattesId, newValue, e.currentTarget);
            });
        });

        customIdSelects.forEach(select => {
            select.addEventListener('change', async (e) => {
                const selectedVal = e.currentTarget.value;
                e.currentTarget.value = '';
                if (!selectedVal) return;

                const name = e.currentTarget.getAttribute('data-name');
                const lattesId = e.currentTarget.getAttribute('data-lattesid');
                const inputEl = (lattesId ? newTab.document.querySelector(`.custom-id-input[data-lattesid="${this._cssAttr(lattesId)}"]`) : null) ||
                                newTab.document.querySelector(`.custom-id-input[data-name="${this._cssAttr(name)}"]`);

                if (inputEl) {
                    let currentVal = inputEl.value;
                    let existingIds = currentVal.split(',').map(s => s.trim()).filter(s => s !== '');

                    if (!existingIds.includes(selectedVal)) {
                        existingIds.push(selectedVal);
                        const finalValue = existingIds.join(', ');
                        inputEl.value = finalValue;
                        await updateCustomId(name, lattesId, finalValue, inputEl);
                    }
                }
            });
        });

        // Add Bulk Action and Checkbox Event Listeners
        const selectAllCheckbox = newTab.document.getElementById('selectAllCheckbox');
        const rowCheckboxes = newTab.document.querySelectorAll('.row-checkbox');
        const bulkBtnOpen = newTab.document.getElementById('bulk-btn-open');

        const updateBulkOpenBtn = () => {
            const checked = Array.from(rowCheckboxes).filter(cb => cb.checked);
            const anyNeedsUpdate = checked.some(cb => cb.getAttribute('data-needs-update') === 'true');
            if (bulkBtnOpen) {
                bulkBtnOpen.textContent = anyNeedsUpdate ? '⚠️' : '🔄';
                bulkBtnOpen.title = anyNeedsUpdate
                    ? 'Alguns CVs selecionados precisam de atualização. Abrir no Lattes.'
                    : 'Abrir CVs selecionados no Lattes para atualizar';
            }
        };

        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (e) => {
                const isChecked = e.currentTarget.checked;
                rowCheckboxes.forEach(cb => { cb.checked = isChecked; });
                updateBulkOpenBtn();
            });
        }
        rowCheckboxes.forEach(cb => cb.addEventListener('change', updateBulkOpenBtn));
        
        const bulkIdInput = newTab.document.getElementById('bulk-id-input');
        const bulkIdSelect = newTab.document.getElementById('bulk-id-select');

        const selectedCheckboxData = () => Array.from(rowCheckboxes)
            .filter(cb => cb.checked)
            .map(cb => ({ name: cb.getAttribute('data-name'), lattesId: cb.getAttribute('data-lattesid') }));

        const applyBulkId = async (newValue, inputEl) => {
            if (!newValue) return;

            const selected = selectedCheckboxData();
            if (selected.length === 0) {
                newTab.alert("Selecione pelo menos um CV na tabela para aplicar o ID em lote.");
                if (inputEl) inputEl.value = '';
                return;
            }

            const newIds = newValue.split(',').map(s => s.trim()).filter(s => s !== '');
            if (newIds.length === 0) {
                if (inputEl) inputEl.value = '';
                return;
            }

            const freshDb = await this.getDB();
            const modifiedCvs = [];

            selected.forEach(({ name, lattesId }) => {
                const cvIndex = findCvIndex(freshDb, name, lattesId);
                if (cvIndex >= 0) {
                    let existingIds = (freshDb[cvIndex].customId || '').split(',').map(s => s.trim()).filter(s => s !== '');
                    let modified = false;

                    newIds.forEach(id => {
                        if (!existingIds.includes(id)) {
                            existingIds.push(id);
                            modified = true;
                        }
                    });

                    if (modified) {
                        freshDb[cvIndex].customId = existingIds.join(', ');
                        modifiedCvs.push(freshDb[cvIndex]);
                    }
                }
            });

            if (modifiedCvs.length > 0) {
                await this.saveCVs(modifiedCvs);
                this.viewDB(newTab);
            } else {
                if (inputEl) inputEl.value = '';
            }
        };

        if (bulkIdInput) {
            bulkIdInput.addEventListener('click', (e) => e.stopPropagation());
            bulkIdInput.addEventListener('change', async (e) => {
                await applyBulkId(e.currentTarget.value.trim(), e.currentTarget);
            });
        }

        if (bulkIdSelect) {
            bulkIdSelect.addEventListener('click', (e) => e.stopPropagation());
            bulkIdSelect.addEventListener('change', async (e) => {
                const selectedVal = e.currentTarget.value;
                e.currentTarget.value = ""; 
                if (!selectedVal) return;

                const currentVal = bulkIdInput ? bulkIdInput.value.trim() : "";
                let existingIds = currentVal.split(',').map(s => s.trim()).filter(s => s !== '');
                
                if (!existingIds.includes(selectedVal)) {
                    existingIds.push(selectedVal);
                    const finalValue = existingIds.join(', ');
                    if (bulkIdInput) {
                        bulkIdInput.value = finalValue;
                        await applyBulkId(finalValue, bulkIdInput);
                    }
                }
            });
        }
        
        const bulkBtnReport = newTab.document.getElementById('bulk-btn-report');
        if (bulkBtnReport) {
            bulkBtnReport.addEventListener('click', async () => {
                const selected = selectedCheckboxData();
                if (selected.length === 0) {
                    newTab.alert("Selecione pelo menos um CV na tabela.");
                    return;
                }
                const selectedDb = db.filter(cv => selected.some(s => this.cvMatches(cv, s.name, s.lattesId)));
                this.renderCVReport(selectedDb[0], newTab, selectedDb);
            });
        }

        const bulkBtnClear = newTab.document.getElementById('bulk-btn-clear');
        if (bulkBtnClear) {
            bulkBtnClear.addEventListener('click', async () => {
                const selected = selectedCheckboxData();
                if (selected.length === 0) return;

                if (newTab.confirm(`Tem certeza que deseja limpar o ID de ${selected.length} CV(s)?`)) {
                    const freshDb = await this.getDB();
                    const modifiedCvs = [];
                    selected.forEach(({ name, lattesId }) => {
                        const cvIndex = findCvIndex(freshDb, name, lattesId);
                        if (cvIndex >= 0) {
                            freshDb[cvIndex].customId = '';
                            modifiedCvs.push(freshDb[cvIndex]);
                        }
                    });
                    await this.saveCVs(modifiedCvs);
                    this.viewDB(newTab);
                }
            });
        }

        const bulkBtnDelete = newTab.document.getElementById('bulk-btn-delete');
        if (bulkBtnDelete) {
            bulkBtnDelete.addEventListener('click', async () => {
                const selected = selectedCheckboxData();
                if (selected.length === 0) return;

                if (newTab.confirm(`Tem certeza que deseja EXCLUIR ${selected.length} CV(s) do banco de dados? Esta ação não pode ser desfeita.`)) {
                    const freshDb = await this.getDB();
                    const toRemove = freshDb.filter(cv => selected.some(s => this.cvMatches(cv, s.name, s.lattesId)));
                    await this.removeCVs(toRemove);
                    this.viewDB(newTab);
                }
            });
        }

        if (bulkBtnOpen) {
            bulkBtnOpen.addEventListener('click', () => {
                const selected = selectedCheckboxData();
                if (selected.length === 0) {
                    this.showToast('Nenhum CV selecionado.', '#e67e22');
                    return;
                }
                const MAX_OPEN = 10;
                if (selected.length > MAX_OPEN) {
                    if (!newTab.confirm(`Abrir ${selected.length} CVs de uma vez pode ser bloqueado pelo navegador. Continuar?`)) return;
                }
                selected.forEach(({ lattesId }) => {
                    if (lattesId) newTab.open(`http://lattes.cnpq.br/${lattesId}`, '_blank');
                });
            });
        }

        const openCvBtns = newTab.document.querySelectorAll('.btn-open-cv');
        openCvBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const lattesId = e.currentTarget.getAttribute('data-lattesid');
                if (lattesId) newTab.open(`http://lattes.cnpq.br/${lattesId}`, '_blank');
            });
        });

        const clearIdBtns = newTab.document.querySelectorAll('.btn-clear-id');
        clearIdBtns.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const name = e.currentTarget.getAttribute('data-name');
                const lattesId = e.currentTarget.getAttribute('data-lattesid');
                const freshDb = await this.getDB();
                const cvIndex = findCvIndex(freshDb, name, lattesId);
                if (cvIndex >= 0) {
                    freshDb[cvIndex].customId = '';
                    await this.saveCVs([freshDb[cvIndex]]);
                    this.viewDB(newTab);
                }
            });
        });

        const viewReportBtns = newTab.document.querySelectorAll('.btn-view-report');
        viewReportBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const name = e.currentTarget.getAttribute('data-name');
                const lattesId = e.currentTarget.getAttribute('data-lattesid');
                if (!name) return;
                const cvData = db.find(cv => this.cvMatches(cv, name, lattesId));
                if (cvData) {
                    this.renderCVReport(cvData, newTab, db);
                }
            });
        });

        // Add sorting event listeners to headers
        const headers = newTab.document.querySelectorAll('.sortable-header');
        headers.forEach(th => {
            th.addEventListener('click', () => {
                const key = th.getAttribute('data-key');
                if (this.sortConfig.key === key) {
                    this.sortConfig.ascending = !this.sortConfig.ascending;
                } else {
                    this.sortConfig.key = key;
                    this.sortConfig.ascending = true;
                }
                this.viewDB(newTab);
            });
        });

        // Group Handlers
        const updateGroupStats = async (groupId) => {
            const groupActions = newTab.document.getElementById('group-actions-container');
            const groupStats = newTab.document.getElementById('group-stats-display');
            
            if (!groupId) {
                groupActions.style.display = 'none';
                groupStats.style.display = 'none';
                newTab.currentGroupCvData = null;
                return;
            }

            groupActions.style.display = 'flex';
            groupStats.style.display = 'block';

            const displayIds = ['gstat-membros', 'gstat-total', 'gstat-jcr', 'gstat-gc', 'gstat-citacoes', 'gstat-hindex', 'gstat-doutorado', 'gstat-mestrado', 'gstat-patentes'];
            displayIds.forEach(id => {
                const el = newTab.document.getElementById(id);
                if (el) el.innerHTML = '<span style="color: #888; font-size: 0.8em;">...</span>';
            });
            const membrosEl = newTab.document.getElementById('gstat-membros');
            if (membrosEl) membrosEl.innerHTML = '<span style="color: #888; font-size: 0.6em;">Processando...</span>';

            // Yield execution to allow browser to render the loading state
            await new Promise(r => setTimeout(r, 50));

            const db = await this.getDB();
            const isSelectionGroup = groupId === '__selecionados__';
            let groupCvs;
            if (isSelectionGroup) {
                const selected = selectedCheckboxData();
                groupCvs = db.filter(cv => selected.some(s => this.cvMatches(cv, s.name, s.lattesId)));
                if (groupCvs.length === 0) {
                    newTab.alert('Selecione pelo menos um CV nos checkboxes da tabela.');
                    groupActions.style.display = 'none';
                    groupStats.style.display = 'none';
                    newTab.currentGroupCvData = null;
                    const sel = newTab.document.getElementById('group-id-select');
                    if (sel) sel.value = '';
                    return;
                }
            } else {
                groupCvs = db.filter(cv => {
                    const ids = (cv.customId || '').split(',').map(s => s.trim());
                    return ids.includes(groupId);
                });
            }

            // Ações de ID de grupo (exportar/renomear/limpar/excluir) não se aplicam
            // à seleção via checkboxes — só o relatório fica disponível.
            ['group-btn-export-json', 'group-btn-rename', 'group-btn-clear', 'group-btn-delete'].forEach(id => {
                const btn = newTab.document.getElementById(id);
                if (btn) btn.style.display = isSelectionGroup ? 'none' : '';
            });

            let allPubs = [];
            let allPatents = [];
            let allEvents = [];
            let allSupervisions = [];

            for (const cv of groupCvs) {
                if (cv.publications) allPubs = allPubs.concat(cv.publications);
                if (cv.rawPatents) allPatents = allPatents.concat(cv.rawPatents);
                if (cv.rawEvents) allEvents = allEvents.concat(cv.rawEvents);
                if (cv.supervisions && cv.supervisions.raw) {
                    allSupervisions = allSupervisions.concat(cv.supervisions.raw);
                }
            }

            const uniquePubs = this.deduplicateItems(allPubs, 'doi', 'reference');
            const uniquePatents = this.deduplicateItems(allPatents, 'registro', 'reference');
            const uniqueEvents = this.deduplicateItems(allEvents, null, 'reference');
            const uniqueSupervisions = this.deduplicateItems(allSupervisions, null, 'reference');

            let groupInCourse = {};
            let groupConcluded = {};
            uniqueSupervisions.forEach(s => {
                const cat = s.category;
                if (!cat) return;
                if (s.status === 'Concluída') {
                    if (!groupConcluded[cat]) groupConcluded[cat] = [];
                    if (s.year && !isNaN(s.year)) {
                        groupConcluded[cat].push(parseInt(s.year));
                    }
                } else if (s.status === 'Em andamento') {
                    groupInCourse[cat] = (groupInCourse[cat] || 0) + 1;
                }
            });

            const groupCvData = {
                name: `Grupo: ${isSelectionGroup ? 'Seleção' : groupId} (${groupCvs.length} membros)`,
                lattesId: '',
                dateAdded: new Date().toISOString(),
                publications: uniquePubs,
                rawPatents: uniquePatents,
                rawEvents: uniqueEvents,
                supervisions: { 
                    raw: uniqueSupervisions,
                    inCourse: groupInCourse,
                    concluded: groupConcluded
                },
                declaredCitations: null,
                ridStats: null,
                researcherIdLink: null,
                highJcr: 7.0,
                lowJcr: 1.5,
                groupMembers: groupCvs,
            };

            const currentYear = new Date().getFullYear();
            const stats = window.JCRReportUtils.calculateReportStats(
                groupCvData.publications,
                groupCvData.rawPatents,
                groupCvData.rawEvents,
                groupCvData.supervisions,
                groupCvData.declaredCitations,
                currentYear,
                1,
                currentYear - 5,
                currentYear - 10,
                currentYear - 1,
                parseFloat(groupCvData.highJcr),
                parseFloat(groupCvData.lowJcr)
            );

            newTab.currentGroupCvData = groupCvData;

            newTab.document.getElementById('gstat-membros').innerText = groupCvs.length;
            newTab.document.getElementById('gstat-total').innerText = stats.all.total.count;
            newTab.document.getElementById('gstat-jcr').innerText = stats.all.total.countWithJcr;
            newTab.document.getElementById('gstat-gc').innerText = stats.all.total.gcCount;
            newTab.document.getElementById('gstat-citacoes').innerText = stats.all.citations.wos.sum;
            newTab.document.getElementById('gstat-hindex').innerText = stats.all.citations.wos.hIndex;
            
            const phdCount = Array.isArray(stats.supervisions?.concluded?.['Tese de doutorado']) ? stats.supervisions.concluded['Tese de doutorado'].length : 0;
            const mscCount = Array.isArray(stats.supervisions?.concluded?.['Dissertação de mestrado']) ? stats.supervisions.concluded['Dissertação de mestrado'].length : 0;
            
            newTab.document.getElementById('gstat-doutorado').innerText = phdCount;
            newTab.document.getElementById('gstat-mestrado').innerText = mscCount;
            newTab.document.getElementById('gstat-patentes').innerText = stats.all.patents?.total || 0;
        };

        const groupSelect = newTab.document.getElementById('group-id-select');
        if (groupSelect) {
            groupSelect.addEventListener('change', (e) => updateGroupStats(e.target.value));
        }

        const groupBtnReport = newTab.document.getElementById('group-btn-report');
        if (groupBtnReport) {
            groupBtnReport.addEventListener('click', () => {
                if (newTab.currentGroupCvData) {
                    this.renderCVReport(newTab.currentGroupCvData, newTab);
                }
            });
        }

        const groupBtnExportJson = newTab.document.getElementById('group-btn-export-json');
        if (groupBtnExportJson) {
            groupBtnExportJson.addEventListener('click', async () => {
                const groupId = groupSelect.value;
                if (!groupId) return;
                
                const db = await this.getDB();
                const groupCvs = db.filter(cv => {
                    let ids = (cv.customId || '').split(',').map(s => s.trim()).filter(s => s !== '');
                    return ids.includes(groupId);
                });
                
                if (groupCvs.length === 0) {
                    newTab.alert("Nenhum CV encontrado para este grupo.");
                    return;
                }

                const jsonContent = JSON.stringify(groupCvs, null, 2);
                const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = newTab.document.createElement("a");
                link.setAttribute("href", url);
                link.setAttribute("download", `${groupId}_jcr_lattes_database_backup.json`);
                newTab.document.body.appendChild(link);
                link.click();
                newTab.document.body.removeChild(link);
                setTimeout(() => URL.revokeObjectURL(url), 100);
            });
        }

        const groupBtnRename = newTab.document.getElementById('group-btn-rename');
        if (groupBtnRename) {
            groupBtnRename.addEventListener('click', async () => {
                const groupId = groupSelect.value;
                if (!groupId) return;
                const newId = newTab.prompt(`Digite o novo ID para substituir '${groupId}':`);
                if (newId !== null && newId.trim() !== '') {
                    const cleanNewId = newId.trim();
                    const db = await this.getDB();
                    const modifiedCvs = [];
                    db.forEach(cv => {
                        let ids = (cv.customId || '').split(',').map(s => s.trim()).filter(s => s !== '');
                        if (ids.includes(groupId)) {
                            const index = ids.indexOf(groupId);
                            ids[index] = cleanNewId;
                            cv.customId = [...new Set(ids)].join(', ');
                            modifiedCvs.push(cv);
                        }
                    });
                    await this.saveCVs(modifiedCvs);
                    this.viewDB(newTab);
                }
            });
        }

        const groupBtnClear = newTab.document.getElementById('group-btn-clear');
        if (groupBtnClear) {
            groupBtnClear.addEventListener('click', async () => {
                const groupId = groupSelect.value;
                if (!groupId) return;
                if (newTab.confirm(`Tem certeza que deseja limpar o ID '${groupId}' de todos os currículos?`)) {
                    const db = await this.getDB();
                    const modifiedCvs = [];
                    db.forEach(cv => {
                        let ids = (cv.customId || '').split(',').map(s => s.trim()).filter(s => s !== '');
                        if (ids.includes(groupId)) {
                            ids = ids.filter(id => id !== groupId);
                            cv.customId = ids.join(', ');
                            modifiedCvs.push(cv);
                        }
                    });
                    await this.saveCVs(modifiedCvs);
                    this.viewDB(newTab);
                }
            });
        }

        const groupBtnDelete = newTab.document.getElementById('group-btn-delete');
        if (groupBtnDelete) {
            groupBtnDelete.addEventListener('click', async () => {
                const groupId = groupSelect.value;
                if (!groupId) return;
                if (newTab.confirm(`ATENÇÃO! Tem certeza que deseja EXCLUIR permanentemente todos os currículos com ID '${groupId}' do banco de dados?`)) {
                    const db = await this.getDB();
                    const toRemove = db.filter(cv => {
                        let ids = (cv.customId || '').split(',').map(s => s.trim()).filter(s => s !== '');
                        return ids.includes(groupId);
                    });
                    await this.removeCVs(toRemove);
                    this.viewDB(newTab);
                }
            });
        }
    },

    renderCVReport: function(cvData, newTab, sortedDb = null, parentGroupData = null) {
        const publications = cvData.publications || [];
        const rawPatents = cvData.rawPatents || [];
        const rawEvents = cvData.rawEvents || [];
        const supervisions = cvData.supervisions || {};
        const declaredCitations = cvData.declaredCitations || null;

        const currentYear = new Date().getFullYear();
        if (!this.reportState) {
            this.reportState = {
                highJcr: parseFloat(cvData.highJcr || 7.0),
                lowJcr: parseFloat(cvData.lowJcr || 1.5),
                customYears: 1,
                targetAuthorRank: 1,
                pubListYears: 5,
                journalYears: 5,
                minJournalPapers: 1,
                showHighJcr: true,
                showMidJcr: true,
                showLowJcr: true,
                showNoJcr: true,
                showAuthorFirst: true,
                showAuthorLast: true,
                showAuthorOthers: true,
                showAuthorGc: true,
                showPubListJcr: true,
                showPubListDoi: true,
                showPubListCitations: true
            };
        }
        
        newTab.reportState = this.reportState;
        const state = newTab.reportState;
        const targetRank = parseInt(state.targetAuthorRank) || 1;
        const startYearRecent = currentYear - 5;
        const startYearLast10 = currentYear - 10;
        const startYearCustom = currentYear - state.customYears;

        // Filter publications based on UI state
        const filteredPublications = publications.filter(pub => {
            let ifVal = pub.jif !== undefined ? pub.jif : (pub.impactFactor !== undefined ? pub.impactFactor : 0);
            ifVal = parseFloat(ifVal) || 0;
            
            let category = 'noJcr';
            if (ifVal > 0) {
                if (ifVal >= state.highJcr) category = 'high';
                else if (ifVal >= state.lowJcr) category = 'mid';
                else category = 'low';
            }
            
            if (category === 'high' && !state.showHighJcr) return false;
            if (category === 'mid' && !state.showMidJcr) return false;
            if (category === 'low' && !state.showLowJcr) return false;
            if (category === 'noJcr' && !state.showNoJcr) return false;
            
            let isFirst = false;
            if (targetRank === 1) {
                isFirst = pub.isFirstAuthor !== undefined ? pub.isFirstAuthor : pub.authorRank === 1;
            } else {
                isFirst = pub.authorRank === targetRank;
            }
            let isLast = pub.isLastAuthor !== undefined ? pub.isLastAuthor : (pub.authorRank === pub.authorCount && !pub.hasEtAl && pub.authorCount > 1);
            let isGc = pub.hasEtAl;
            let isOther = !isFirst && !isLast && !isGc;
            
            if (isFirst && !state.showAuthorFirst) return false;
            if (isLast && !state.showAuthorLast) return false;
            if (isOther && !state.showAuthorOthers) return false;
            if (isGc && !state.showAuthorGc) return false;
            
            return true;
        });

        // Recalculate stats for the report
        const stats = window.JCRReportUtils.calculateReportStats(
            filteredPublications, rawPatents, rawEvents, supervisions, declaredCitations,
            currentYear, state.customYears, startYearRecent, startYearLast10, startYearCustom, state.highJcr, state.lowJcr, targetRank
        );

        const COLORS = window.JCRReportUtils.COLORS;
        
        const minYear = stats.minYear;
        const maxYear = stats.maxYear;

        let navButtonsHTML = '';
        if (sortedDb && sortedDb.length > 1 && !cvData.name.startsWith('Grupo:')) {
            const currentIndex = sortedDb.findIndex(cv => cv.name === cvData.name);
            if (currentIndex !== -1) {
                const prevIndex = currentIndex > 0 ? currentIndex - 1 : sortedDb.length - 1;
                const nextIndex = currentIndex < sortedDb.length - 1 ? currentIndex + 1 : 0;
                const prevCv = sortedDb[prevIndex];
                const nextCv = sortedDb[nextIndex];
                
                navButtonsHTML = `
                    <button id="btn-prev-cv" data-name="${this._esc(prevCv.name)}" style="padding: 8px 15px; background: #95a5a6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-right: 10px;" title="CV Anterior: ${this._esc(prevCv.name)}">⬅️ Anterior</button>
                    <button id="btn-next-cv" data-name="${this._esc(nextCv.name)}" style="padding: 8px 15px; background: #95a5a6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-right: 10px;" title="Próximo CV: ${this._esc(nextCv.name)}">Próximo ➡️</button>
                `;
            }
        }

        const filtersCollapsed = this.reportFiltersCollapsed === true;

        // Linha-resumo dos filtros, impressa no lugar do bloco interativo
        const jcrHidden = [];
        if (!state.showHighJcr) jcrHidden.push('Alto');
        if (!state.showMidJcr) jcrHidden.push('Médio');
        if (!state.showLowJcr) jcrHidden.push('Baixo');
        if (!state.showNoJcr) jcrHidden.push('Sem JCR');
        const authHidden = [];
        if (!state.showAuthorFirst) authHidden.push(`${targetRank}º Autor`);
        if (!state.showAuthorLast) authHidden.push('Último Autor');
        if (!state.showAuthorOthers) authHidden.push('Outros');
        if (!state.showAuthorGc) authHidden.push('GC (et al)');
        const printFiltersSummary =
            `Limiares: Alto ≥ ${state.highJcr} · Médio ≥ ${state.lowJcr}` +
            ` | JCR: ${jcrHidden.length === 0 ? 'todas as faixas' : 'oculto — ' + jcrHidden.join(', ')}` +
            ` | Autoria: ${authHidden.length === 0 ? 'todos' : 'oculto — ' + authHidden.join(', ')}`;

        const headerHTML = `
            <div style="background: ${COLORS.backgroundSubHeader}; padding: 15px; border-bottom: 1px solid ${COLORS.border}; margin-bottom: 15px; border-radius: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h2 style="margin: 0; color: ${COLORS.footerText};">Relatório: ${this._esc(cvData.name)}</h2>
                        <div style="margin-top: 4px; color: #666; font-size: 0.85em;">
                            ${cvData.name.startsWith('Grupo:') ? '' : `ID Lattes: <a href="http://lattes.cnpq.br/${this._esc(cvData.lattesId)}" target="_blank" style="color: #1565C0; text-decoration: none;">${this._esc(cvData.lattesId)}</a> &nbsp;&middot;&nbsp; `}Sincronizado em: ${new Date(cvData.dateAdded).toLocaleDateString()}
                        </div>
                    </div>
                    <div>
                        ${navButtonsHTML}
                        <button id="btn-print-report" style="padding: 8px 15px; background: #7f8c8d; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-right: 10px;" title="Imprime as seções abertas, com tabelas e listas em toda a extensão">🖨️ Imprimir</button>
                        <button id="btn-back-db" style="padding: 8px 15px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">⬅️ Voltar</button>
                    </div>
                </div>
            </div>

            <div id="print-filters-summary" style="display: none; color: #555; font-size: 0.85em; margin: 8px 0; padding: 6px 10px; border: 1px solid #ddd; border-radius: 4px;">${printFiltersSummary}</div>

            <div class="collapsible-section" id="sec-report-filters">
                <div class="collapsible-header" id="header-report-filters">
                    <h3>Limiares e Filtros</h3>
                    <span class="toggle-icon">${filtersCollapsed ? '[+]' : '[-]'}</span>
                </div>
                <div class="collapsible-content" id="content-report-filters"${filtersCollapsed ? ' style="display: none;"' : ''}>
                    <div style="display: flex; gap: 20px; flex-wrap: wrap; font-size: 0.9em;">
                        <div style="flex: 1; min-width: 200px; border-right: 1px solid #ddd; padding-right: 15px;">
                            <div style="font-weight: bold; margin-bottom: 8px;">JCR Limiares:</div>
                            <div style="margin-bottom: 5px;">Alto >= <input type="number" id="inp-high-jcr" value="${state.highJcr}" step="0.5" style="width: 50px;"></div>
                            <div>Médio >= <input type="number" id="inp-low-jcr" value="${state.lowJcr}" step="0.5" style="width: 50px;"></div>
                            <div style="margin-top: 10px; font-weight: bold;">Mostrar/Ocultar JCR:</div>
                            <label style="cursor:pointer;"><input type="checkbox" id="chk-jcr-high" ${state.showHighJcr ? 'checked' : ''}> Alto</label><br>
                            <label style="cursor:pointer;"><input type="checkbox" id="chk-jcr-mid" ${state.showMidJcr ? 'checked' : ''}> Médio</label><br>
                            <label style="cursor:pointer;"><input type="checkbox" id="chk-jcr-low" ${state.showLowJcr ? 'checked' : ''}> Baixo</label><br>
                            <label style="cursor:pointer;"><input type="checkbox" id="chk-jcr-none" ${state.showNoJcr ? 'checked' : ''}> Sem JCR</label>
                        </div>

                        <div style="flex: 1; min-width: 200px; border-right: 1px solid #ddd; padding-right: 15px;">
                            <div style="font-weight: bold; margin-bottom: 8px;">Filtro de Autoria:</div>
                            <label style="cursor:pointer;"><input type="checkbox" id="chk-auth-first" ${state.showAuthorFirst ? 'checked' : ''}> <span id="lbl-auth-first">${targetRank}º Autor</span></label><br>
                            <label style="cursor:pointer;"><input type="checkbox" id="chk-auth-last" ${state.showAuthorLast ? 'checked' : ''}> Último Autor</label><br>
                            <label style="cursor:pointer;"><input type="checkbox" id="chk-auth-others" ${state.showAuthorOthers ? 'checked' : ''}> Outros</label><br>
                            <label style="cursor:pointer;"><input type="checkbox" id="chk-auth-gc" ${state.showAuthorGc ? 'checked' : ''}> Grandes Colaborações (et al)</label>
                            <div style="margin-top: 8px; font-weight: bold;">Rank do Autor: <input type="number" id="inp-target-author-rank" value="${targetRank}" min="1" max="99" style="width: 45px; text-align: center;"></div>
                        </div>

                        <div style="flex: 1; min-width: 200px;">
                            <div style="font-weight: bold; margin-bottom: 8px;">Período Customizado:</div>
                            <div>Anos: <input type="number" id="inp-custom-years" value="${state.customYears}" min="0" style="width: 50px;"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const getSoftColor = window.JCRReportUtils.getSoftColor.bind(window.JCRReportUtils);
        const bgTotal = '#f8f9fa';
        const bgHigh = getSoftColor(COLORS.highJcr, 0.85);
        const bgMid = getSoftColor(COLORS.midJcr, 0.85);
        const bgLow = getSoftColor(COLORS.lowJcr, 0.85);
        const bgNone = getSoftColor(COLORS.noJcr, 0.85);

        const tableHTML = `
            <table style="width: 100%; border-collapse: collapse; text-align: center; font-family: inherit; font-size: 0.9em; margin-bottom: 20px; border: 1px solid ${COLORS.border};">
                <thead>
                    <tr style="background-color: ${COLORS.backgroundHeader}; border-bottom: 2px solid ${COLORS.border};">
                        <th rowspan="2" style="padding: 8px; text-align: left;">Produção Bibliográfica</th>
                        <th rowspan="2" style="padding: 8px; border-left: 1px solid #ccc; text-align: center; background-color: ${bgTotal};">Total</th>
                        <th colspan="2" style="padding: 8px; border-left: 1px solid #ccc; text-align: center;">Impacto (Σ)</th>
                        <th colspan="3" style="padding: 8px; border-left: 1px solid #ccc; text-align: center; background-color: ${bgTotal};">Autoria</th>
                        <th rowspan="2" style="padding: 8px; border-left: 1px solid #ccc; text-align: center;">GC</th>
                        <th colspan="3" style="padding: 8px; border-left: 1px solid #ccc; text-align: center; background-color: ${bgHigh};">Alto (≥${state.highJcr})</th>
                        <th colspan="3" style="padding: 8px; border-left: 1px solid #ccc; text-align: center; background-color: ${bgMid};">Médio</th>
                        <th colspan="3" style="padding: 8px; border-left: 1px solid #ccc; text-align: center; background-color: ${bgLow};">Baixo (<${state.lowJcr})</th>
                        <th rowspan="2" style="padding: 8px; border-left: 1px solid #ccc; text-align: center; background-color: ${bgNone};">Sem JCR</th>
                    </tr>
                    <tr style="background-color: ${COLORS.backgroundSubHeader}; border-bottom: 1px solid ${COLORS.border}; font-size: 0.85em;">
                        <th style="padding: 4px; border-left: 1px solid #eee; text-align: center;">Soma</th>
                        <th style="padding: 4px; text-align: center;">Média</th>
                        <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgTotal};">${targetRank}o</th>
                        <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgTotal};">Últ.</th>
                        <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgTotal};">N Aut</th>
                        
                        <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgHigh};">Qtd</th>
                        <th style="padding: 4px; text-align: center; background-color: ${bgHigh};">Soma</th>
                        <th style="padding: 4px; text-align: center; background-color: ${bgHigh};">Média</th>
                        
                        <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgMid};">Qtd</th>
                        <th style="padding: 4px; text-align: center; background-color: ${bgMid};">Soma</th>
                        <th style="padding: 4px; text-align: center; background-color: ${bgMid};">Média</th>
                        
                        <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgLow};">Qtd</th>
                        <th style="padding: 4px; text-align: center; background-color: ${bgLow};">Soma</th>
                        <th style="padding: 4px; text-align: center; background-color: ${bgLow};">Média</th>
                    </tr>
                </thead>
                <tbody>
                    ${window.JCRReportUtils.generateRow(`Total (${minYear} - ${maxYear})`, stats.all)}
                    ${window.JCRReportUtils.generateRow(`10 anos (${startYearLast10} - ${maxYear})`, stats.last10)}
                    ${window.JCRReportUtils.generateRow(`5 anos (${startYearRecent} - ${maxYear})`, stats.recent)}
                    ${window.JCRReportUtils.generateRow(`${state.customYears} ${state.customYears == 1 ? 'ano' : 'anos'} (${startYearCustom} - ${maxYear})`, stats.custom)}
                </tbody>
            </table>
        `;

        const isGroup = cvData.name.startsWith('Grupo:');
        const citationTableHTML = window.JCRReportUtils.generateCitationTableHTML(stats);
        const ridTableHTML = (cvData.ridStats && cvData.researcherIdLink && !isGroup) ? 
            window.JCRReportUtils.generateRidTableHTML(cvData.ridStats, cvData.researcherIdLink, this.isUnlocked) : '';
        const supervisionTableHTML = window.JCRReportUtils.generateSupervisionTableHTML(stats, state.customYears);
        const patentTableHTML = window.JCRReportUtils.generatePatentTableHTML(stats, state.customYears);
        const eventTableHTML = window.JCRReportUtils.generateEventTableHTML(stats, state.customYears);

        const histogramHTML = window.JCRReportUtils.generateHistogramHTML(filteredPublications, state.highJcr, state.lowJcr);
        const papersPerYearHTML = window.JCRReportUtils.generatePapersPerYearGraphHTML(filteredPublications, state.highJcr, state.lowJcr);
        const authorRankHistogramHTML = window.JCRReportUtils.generateAuthorRankHistogramHTML(filteredPublications, state.highJcr, state.lowJcr, state.showAuthorLast, state.showAuthorGc);
        const supervisionsPerYearHTML = window.JCRReportUtils.generateSupervisionsPerYearGraphHTML(supervisions);

        let membersTableHTML = '';
        if (cvData.groupMembers && cvData.groupMembers.length > 0) {
            let theadHtml = `<tr style="background-color: ${COLORS.backgroundHeader}; border-bottom: 2px solid ${COLORS.border};">`;
            this.METRICS_CONFIG.forEach(m => {
                if (['customId', 'researcherIdLink', 'firstAuthorCount', 'lastAuthorCount', 'gcCount'].includes(m.key)) return;
                const titleAttr = m.title ? ` title="${m.title}"` : '';
                let style = 'padding: 8px; font-weight: bold; position: sticky; top: 0; z-index: 1; border-bottom: 2px solid #ccc;';
                if (m.division) style += ' border-left: 1px solid #bbb;';
                if (m.numeric || m.key === 'researcherIdLink') style += ' text-align: center;';
                theadHtml += `<th${titleAttr} style="${style}">${m.label}</th>`;
            });
            theadHtml += `<th style="padding: 8px; font-weight: bold; position: sticky; top: 0; z-index: 1; border-bottom: 2px solid #ccc; text-align: center;">Ações</th>`;
            theadHtml += `</tr>`;

            let tbodyHtml = ``;
            const sortedMembers = [...cvData.groupMembers].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            sortedMembers.forEach(cv => {
                tbodyHtml += `<tr>`;
                this.METRICS_CONFIG.forEach(m => {
                    if (['customId', 'researcherIdLink', 'firstAuthorCount', 'lastAuthorCount', 'gcCount'].includes(m.key)) return;
                    const val = cv[m.key] !== undefined ? cv[m.key] : '';
                    let style = 'padding: 6px 8px; border-bottom: 1px solid #eee;';
                    if (m.division) style += ' border-left: 1px solid #bbb;';
                    if (m.numeric || m.key === 'researcherIdLink') style += ' text-align: center;';

                    if (m.key === 'name') {
                        const lattesLink = cv.lattesId ? `http://lattes.cnpq.br/${this._esc(cv.lattesId)}` : '#';
                        tbodyHtml += `<td style="${style}"><strong><a href="${lattesLink}" target="_blank" style="color: #1565C0; text-decoration: none;">${this._esc(String(val))}</a></strong></td>`;
                    } else if (m.key === 'researcherIdLink') {
                        const safeRid = this._safeUrl(val);
                        if (safeRid) {
                            tbodyHtml += `<td style="${style}"><a href="${safeRid}" target="_blank" title="ResearcherID" style="text-decoration:none; font-size:1.2em;">🔗</a></td>`;
                        } else {
                            tbodyHtml += `<td style="${style}"></td>`;
                        }
                    } else if (m.key === 'dateAdded') {
                        const dateStr = val ? new Date(val).toLocaleDateString() : '';
                        tbodyHtml += `<td style="${style}">${dateStr}</td>`;
                    } else {
                        tbodyHtml += `<td style="${style}">${this._esc(String(val))}</td>`;
                    }
                });
                tbodyHtml += `<td style="padding: 6px 8px; border-bottom: 1px solid #eee; text-align: center;">
                    <button class="btn btn-view-member-report" data-name="${this._esc(cv.name || '')}" data-lattesid="${this._esc(cv.lattesId || '')}" title="Relatório Individual" style="border:1px solid #ccc; border-radius:3px; cursor:pointer; background:#fff; padding:2px 4px;">📊</button>
                </td>`;
                tbodyHtml += `</tr>`;
            });

            membersTableHTML = `
                <div class="collapsible-section" id="sec-members">
                    <div class="collapsible-header">
                        <h3>Membros do Grupo</h3>
                        <span class="toggle-icon">[-]</span>
                    </div>
                    <div class="collapsible-content" style="padding: 0;">
                        <div style="overflow-x: auto; max-height: 500px;">
                            <table style="width: 100%; border-collapse: collapse; text-align: left; font-family: inherit; font-size: 0.9em;">
                                <thead>
                                    ${theadHtml}
                                </thead>
                                <tbody>
                                    ${tbodyHtml}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;
        }

        const fullHTML = `
            <!DOCTYPE html>
            <html lang="pt-BR">
            <head>
                <meta charset="UTF-8">
                <title>Relatório: ${this._esc(cvData.name)}</title>
                <style>
                    body { font-family: Arial, sans-serif; background-color: #f4f4f9; margin: 0; padding: 20px; color: #333; line-height: 1.4; }
                    .container { max-width: 1200px; margin: auto; background: white; padding: 25px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
                    .rodape-cv { margin-top: 15px; border: 1px solid #ddd; border-radius: 4px; overflow: hidden; }
                    input[type="number"] { padding: 4px; border: 1px solid #ccc; border-radius: 4px; }
                    input[type="checkbox"] { vertical-align: middle; }
                    
                    .collapsible-header { 
                        display: flex; 
                        justify-content: space-between; 
                        align-items: center; 
                        background: #f8f9fa; 
                        padding: 10px 15px; 
                        border-left: 4px solid #3498db; 
                        margin: 20px 0 0 0; 
                        cursor: pointer; 
                        user-select: none;
                        border-radius: 4px 4px 0 0;
                        transition: background 0.2s;
                    }
                    .collapsible-header:hover { background: #eef1f4; }
                    .collapsible-header h3 { margin: 0; font-size: 1.1em; color: #2c3e50; }
                    .collapsible-content { 
                        border: 1px solid #eee; 
                        border-top: none; 
                        padding: 15px; 
                        border-radius: 0 0 4px 4px;
                        margin-bottom: 20px;
                    }
                    .toggle-icon { font-weight: bold; color: #3498db; font-family: monospace; }

                    @media print {
                        /* Preserva cores de fundo (barras dos gráficos, faixas JCR) */
                        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

                        body { background: #fff !important; padding: 0 !important; }
                        .container { max-width: none !important; box-shadow: none !important; padding: 0 !important; }

                        /* Oculta controles interativos e o bloco de filtros */
                        #btn-back-db, #btn-prev-cv, #btn-next-cv, #btn-print-report,
                        #sec-report-filters, .toggle-icon, .y-icon,
                        .no-print,
                        .btn-view-member-report { display: none !important; }

                        /* Mantém "Período (anos)" e "Mín. artigos" legíveis, só remove o estilo de campo */
                        #header-pub-list input, #header-journal-list input {
                            border: none !important; background: transparent !important; padding: 0 !important;
                            -webkit-appearance: none; appearance: textfield;
                        }

                        /* Linha-resumo dos filtros: aparece somente na impressão */
                        #print-filters-summary { display: block !important; }

                        /* Libera contêineres com scroll: imprime o conteúdo completo */
                        .collapsible-content div { max-height: none !important; overflow: visible !important; }

                        /* Quebras de página: não parte linhas nem deixa títulos órfãos */
                        tr, .collapsible-header { break-inside: avoid; page-break-inside: avoid; }
                        thead { display: table-header-group; }

                        /* Tabelas largas: fonte reduzida para caber na página */
                        table { font-size: 8.5pt; }
                        .collapsible-header { cursor: default; }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    ${headerHTML}
                    
                    ${filteredPublications.length > 0 ? `
                    <div class="collapsible-section" id="sec-publications">
                        <div class="collapsible-header">
                            <h3>Estatísticas de Publicações</h3>
                            <span class="toggle-icon">[-]</span>
                        </div>
                        <div class="collapsible-content">
                            ${tableHTML}
                        </div>
                    </div>` : ''}
                    
                    ${(ridTableHTML !== '' || citationTableHTML !== '') ? `
                    <div class="collapsible-section" id="sec-citations">
                        <div class="collapsible-header">
                            <h3>Citações e Índices</h3>
                            <span class="toggle-icon">[-]</span>
                        </div>
                        <div class="collapsible-content">
                            ${ridTableHTML}
                            ${citationTableHTML}
                        </div>
                    </div>` : ''}
                    
                    ${supervisionTableHTML !== '' ? `
                    <div class="collapsible-section" id="sec-supervisions">
                        <div class="collapsible-header">
                            <h3>Orientações</h3>
                            <span class="toggle-icon">[-]</span>
                        </div>
                        <div class="collapsible-content">
                            ${supervisionTableHTML}
                        </div>
                    </div>` : ''}
                    
                    ${patentTableHTML !== '' ? `
                    <div class="collapsible-section" id="sec-patents">
                        <div class="collapsible-header">
                            <h3>Patentes</h3>
                            <span class="toggle-icon">[-]</span>
                        </div>
                        <div class="collapsible-content">
                            ${patentTableHTML}
                        </div>
                    </div>` : ''}

                    ${eventTableHTML !== '' ? `
                    <div class="collapsible-section" id="sec-events">
                        <div class="collapsible-header">
                            <h3>Participação em Eventos</h3>
                            <span class="toggle-icon">[-]</span>
                        </div>
                        <div class="collapsible-content">
                            ${eventTableHTML}
                        </div>
                    </div>` : ''}

                    ${filteredPublications.length > 0 ? `
                    <div class="collapsible-section" id="sec-graphs">
                        <div class="collapsible-header">
                            <h3>Gráficos e Distribuição</h3>
                            <span class="toggle-icon">[-]</span>
                        </div>
                        <div class="collapsible-content">
                            <div style="display: flex; flex-direction: column; gap: 20px;">
                                <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                                    <div style="flex: 1; min-width: 400px; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; background: #fff;">
                                        ${histogramHTML}
                                    </div>
                                    <div style="flex: 1; min-width: 400px; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; background: #fff;">
                                        ${papersPerYearHTML}
                                    </div>
                                </div>
                                <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                                    <div style="flex: 1; min-width: 400px; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; background: #fff;">
                                        ${authorRankHistogramHTML}
                                    </div>
                                    <div style="flex: 1; min-width: 400px; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; background: #fff;">
                                        ${supervisionsPerYearHTML}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>` : ''}

                    ${membersTableHTML}

                    ${filteredPublications.length > 0 ? `
                    <div class="collapsible-section" id="sec-pub-list">
                        <div class="collapsible-header" id="header-pub-list">
                            <div style="display: flex; align-items: center; gap: 15px;">
                                <h3 style="margin: 0;">Lista de Publicações</h3>
                                <div style="font-size: 0.9em; font-weight: normal; margin-top: 2px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;" onclick="event.stopPropagation();">
                                    <span>Período (anos): <input type="number" id="inp-pub-list-years" value="${state.pubListYears !== undefined ? state.pubListYears : 5}" min="0" style="width: 50px; padding: 2px;"></span>
                                    <button id="btn-pub-list-update" class="no-print" style="padding: 2px 8px; cursor: pointer; border-radius: 3px; border: 1px solid #ccc; background: #fff;">Atualizar</button>
                                    <span class="no-print" style="display: flex; align-items: center; gap: 10px; color: #555;">
                                        <label style="cursor: pointer;"><input type="checkbox" id="chk-pub-show-jcr" ${state.showPubListJcr !== false ? 'checked' : ''}> JCR</label>
                                        <label style="cursor: pointer;"><input type="checkbox" id="chk-pub-show-doi" ${state.showPubListDoi !== false ? 'checked' : ''}> DOI</label>
                                        <label style="cursor: pointer;"><input type="checkbox" id="chk-pub-show-cit" ${state.showPubListCitations !== false ? 'checked' : ''}> Citações</label>
                                    </span>
                                </div>
                            </div>
                            <span class="toggle-icon">[+]</span>
                        </div>
                        <div class="collapsible-content" style="display: none;" id="content-pub-list">
                            <div id="pub-list-container" style="max-height: 500px; overflow-y: auto; padding: 15px; border: 1px solid #eee; background: #fafafa; border-radius: 4px;">
                                <div style="color: #777; text-align: center;">Carregando...</div>
                            </div>
                        </div>
                    </div>` : ''}

                    ${filteredPublications.length > 0 ? `
                    <div class="collapsible-section" id="sec-journals">
                        <div class="collapsible-header" id="header-journal-list">
                            <div style="display: flex; align-items: center; gap: 15px;">
                                <h3 style="margin: 0;">Publicações por Periódico</h3>
                                <div style="font-size: 0.9em; font-weight: normal; margin-top: 2px;" onclick="event.stopPropagation();">
                                    Período (anos): <input type="number" id="inp-journal-years" value="${state.journalYears !== undefined ? state.journalYears : 5}" min="0" style="width: 50px; padding: 2px;">
                                    &nbsp;Mín. artigos: <input type="number" id="inp-journal-min-papers" value="${state.minJournalPapers !== undefined ? state.minJournalPapers : 1}" min="1" style="width: 40px; padding: 2px;">
                                    <button id="btn-journal-update" class="no-print" style="padding: 2px 8px; cursor: pointer; border-radius: 3px; border: 1px solid #ccc; background: #fff;">Atualizar</button>
                                </div>
                            </div>
                            <span class="toggle-icon">[+]</span>
                        </div>
                        <div class="collapsible-content" style="display: none;" id="content-journal-list">
                            <div id="journal-list-container" style="padding: 5px;">
                                <div style="color: #777; text-align: center; padding: 20px;">Abra a seção para gerar a lista.</div>
                            </div>
                        </div>
                    </div>` : ''}

                    <div style="margin-top: 40px; text-align: center; color: #999; font-size: 0.85em; border-top: 1px solid #eee; padding-top: 15px;">
                        Gerado por JCR Lattes em ${new Date().toLocaleString()}
                    </div>
                </div>
            </body>
            </html>
        `;

        newTab.document.open();
        newTab.document.write(fullHTML);
        newTab.document.close();

        // Re-attach all event listeners
        const doc = newTab.document;
        
        const btnPrint = doc.getElementById('btn-print-report');
        if (btnPrint) {
            btnPrint.addEventListener('click', () => newTab.print());
        }

        doc.getElementById('btn-back-db').addEventListener('click', () => {
            if (parentGroupData) {
                this.renderCVReport(parentGroupData, newTab);
            } else {
                this.viewDB(newTab);
            }
        });

        const btnPrev = doc.getElementById('btn-prev-cv');
        if (btnPrev) {
            btnPrev.addEventListener('click', () => {
                const name = btnPrev.getAttribute('data-name');
                const nextCvData = sortedDb.find(cv => cv.name === name);
                if (nextCvData) this.renderCVReport(nextCvData, newTab, sortedDb, parentGroupData);
            });
        }

        const btnNext = doc.getElementById('btn-next-cv');
        if (btnNext) {
            btnNext.addEventListener('click', () => {
                const name = btnNext.getAttribute('data-name');
                const nextCvData = sortedDb.find(cv => cv.name === name);
                if (nextCvData) this.renderCVReport(nextCvData, newTab, sortedDb, parentGroupData);
            });
        }

        const viewMemberReportBtns = doc.querySelectorAll('.btn-view-member-report');
        if (viewMemberReportBtns.length > 0 && cvData.groupMembers) {
            const sortedGroupMembers = [...cvData.groupMembers].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            viewMemberReportBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const name = e.currentTarget.getAttribute('data-name');
                    if (!name) return;
                    const memberData = sortedGroupMembers.find(cv => cv.name === name);
                    if (memberData) {
                        this.renderCVReport(memberData, newTab, sortedGroupMembers, cvData);
                    }
                });
            });
        }

        const reRender = () => {
            state.highJcr = parseFloat(doc.getElementById('inp-high-jcr').value) || 7.0;
            state.lowJcr = parseFloat(doc.getElementById('inp-low-jcr').value) || 1.5;
            const customYearsVal = parseInt(doc.getElementById('inp-custom-years').value, 10);
            state.customYears = isNaN(customYearsVal) ? 1 : customYearsVal;
            const targetRankVal = parseInt(doc.getElementById('inp-target-author-rank')?.value, 10);
            state.targetAuthorRank = isNaN(targetRankVal) || targetRankVal < 1 ? 1 : targetRankVal;
            state.showHighJcr = doc.getElementById('chk-jcr-high').checked;
            state.showMidJcr = doc.getElementById('chk-jcr-mid').checked;
            state.showLowJcr = doc.getElementById('chk-jcr-low').checked;
            state.showNoJcr = doc.getElementById('chk-jcr-none').checked;
            state.showAuthorFirst = doc.getElementById('chk-auth-first').checked;
            state.showAuthorLast = doc.getElementById('chk-auth-last').checked;
            state.showAuthorOthers = doc.getElementById('chk-auth-others').checked;
            state.showAuthorGc = doc.getElementById('chk-auth-gc').checked;
            
            this.renderCVReport(cvData, newTab, sortedDb, parentGroupData);
        };

        ['inp-high-jcr', 'inp-low-jcr', 'inp-custom-years', 'inp-target-author-rank'].forEach(id => {
            const el = doc.getElementById(id);
            if (el) el.addEventListener('change', reRender);
        });

        ['chk-jcr-high', 'chk-jcr-mid', 'chk-jcr-low', 'chk-jcr-none', 
         'chk-auth-first', 'chk-auth-last', 'chk-auth-others', 'chk-auth-gc'].forEach(id => {
            doc.getElementById(id).addEventListener('change', reRender);
        });

        // Add collapsible functionality
        doc.querySelectorAll('.collapsible-header').forEach(header => {
            header.addEventListener('click', () => {
                const content = header.nextElementSibling;
                const icon = header.querySelector('.toggle-icon');
                const isHidden = content.style.display === 'none';
                
                content.style.display = isHidden ? '' : 'none';
                icon.innerText = isHidden ? '[-]' : '[+]';
                
                // If it's a section with tables/graphs, this might help with layout if needed
                if (isHidden) {
                    // Trigger a resize if there were any dynamic layout elements
                    newTab.dispatchEvent(new Event('resize'));
                }
            });
        });

        // Lembra o estado (aberto/recolhido) do bloco "Limiares e Filtros".
        // Registrado após o handler genérico acima, para ler o estado já alternado.
        const filtersHeader = doc.getElementById('header-report-filters');
        if (filtersHeader) {
            filtersHeader.addEventListener('click', () => {
                const content = doc.getElementById('content-report-filters');
                this.reportFiltersCollapsed = !!content && content.style.display === 'none';
                this.saveSettings();
            });
        }

        const headerPubList = doc.getElementById('header-pub-list');
        const contentPubList = doc.getElementById('content-pub-list');
        const pubContainer = doc.getElementById('pub-list-container');
        const inpPubYears = doc.getElementById('inp-pub-list-years');
        const btnPubUpdate = doc.getElementById('btn-pub-list-update');
        
        let isPubListGenerated = false;

        const generatePubList = () => {
            const pubYears = parseInt(inpPubYears.value, 10) || 0;
            state.pubListYears = pubYears;
            const startYear = currentYear - pubYears;
            
            const pubsInRange = filteredPublications.filter(p => {
                const y = parseInt(p.year, 10);
                return !isNaN(y) && y >= startYear;
            });

            pubsInRange.sort((a, b) => {
                const yA = parseInt(a.year, 10) || 0;
                const yB = parseInt(b.year, 10) || 0;
                if (yB !== yA) return yB - yA;
                const jA = parseFloat(a.jif) || 0;
                const jB = parseFloat(b.jif) || 0;
                return jB - jA;
            });

            let html = '';
            let currentPubYear = null;
            
            pubsInRange.forEach((pub, index) => {
                const pYear = pub.year || 'Desconhecido';
                if (pYear !== currentPubYear) {
                    if (currentPubYear !== null) html += `</div></div>`;
                    currentPubYear = pYear;
                    html += `
                    <div style="margin-bottom: 15px;">
                        <div class="pub-year-header" style="background: #e0e0e0; padding: 6px 12px; cursor: pointer; font-weight: bold; border-radius: 4px; display: flex; justify-content: space-between; border: 1px solid #ccc;" onclick="const c = this.nextElementSibling; const isHidden = c.style.display === 'none'; c.style.display = isHidden ? 'block' : 'none'; this.querySelector('.y-icon').textContent = isHidden ? '[-]' : '[+]';">
                            <span>Ano: ${pYear}</span>
                            <span class="y-icon">[-]</span>
                        </div>
                        <div class="pub-year-content" style="padding: 12px; border: 1px solid #ccc; border-top: none; background: #fff; display: block; border-radius: 0 0 4px 4px;">
                    `;
                }

                let cleanRef = pub.reference || 'Referência indisponível';
                cleanRef = cleanRef.replace(/^\s*\d+\.\s*/, '');
                cleanRef = cleanRef.replace(/\s*Fator de Impacto:\s*[\d.]+\s*(?:\(.*?\))?/g, '');
                cleanRef = cleanRef.replace(/\s*Não classificado\s*(?:\(.*?\))?/g, '');
                cleanRef = cleanRef.replace(/\s*Citações:\s*\d+(?:\|\d+)?/g, '');
                cleanRef = this._esc(cleanRef.trim());
                cleanRef = `<b>${index + 1}.</b> ` + cleanRef;
                
                let extraInfo = [];
                if (state.showPubListJcr !== false && pub.jif > 0) {
                    let jcrColor = '#555';
                    const jifVal = parseFloat(pub.jif) || 0;
                    if (jifVal >= state.highJcr) jcrColor = window.JCRReportUtils.COLORS.highJcr;
                    else if (jifVal >= state.lowJcr) jcrColor = window.JCRReportUtils.COLORS.midJcr;
                    else jcrColor = window.JCRReportUtils.COLORS.lowJcr;

                    extraInfo.push(`<strong style="color: ${jcrColor};">JCR: ${jifVal.toFixed(3)}</strong>`);
                }
                if (state.showPubListCitations !== false && ((pub.wosCitations || 0) > 0 || (pub.scopusCitations || 0) > 0)) {
                    const citParts = [];
                    if (pub.wosCitations > 0) citParts.push(`WoS: ${pub.wosCitations}`);
                    if (pub.scopusCitations > 0) citParts.push(`Scopus: ${pub.scopusCitations}`);
                    extraInfo.push(`Citações: ${citParts.join(' / ')}`);
                }
                if (state.showPubListDoi !== false && pub.doi) {
                    const safeDoi = this._esc(pub.doi);
                    extraInfo.push(`DOI: <a href="https://doi.org/${safeDoi}" target="_blank" style="color: #1565C0; text-decoration: none;">${safeDoi}</a>`);
                }

                const extraHtml = extraInfo.length > 0 ? `<div style="font-size: 0.9em; margin-top: 4px; color: #555;">${extraInfo.join(' | ')}</div>` : '';
                
                html += `<div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px dashed #ddd; text-align: left;">
                    <div style="font-size: 0.95em;">${cleanRef}</div>
                    ${extraHtml}
                </div>`;
            });
            if (currentPubYear !== null) html += `</div></div>`;
            
            if (pubsInRange.length === 0) {
                html = `<div style="padding: 10px; color: #777; text-align: center;">Nenhuma publicação encontrada neste período.</div>`;
            }

            pubContainer.innerHTML = html;
            isPubListGenerated = true;
        };

        if (headerPubList) {
            headerPubList.addEventListener('click', () => {
                if (!isPubListGenerated) generatePubList();
            });
        }

        if (btnPubUpdate) {
            btnPubUpdate.addEventListener('click', (e) => {
                e.stopPropagation();
                generatePubList();
                contentPubList.style.display = 'block';
                headerPubList.querySelector('.toggle-icon').textContent = '[-]';
            });
        }

        const chkPubShowJcr = doc.getElementById('chk-pub-show-jcr');
        const chkPubShowDoi = doc.getElementById('chk-pub-show-doi');
        const chkPubShowCit = doc.getElementById('chk-pub-show-cit');
        [
            [chkPubShowJcr, 'showPubListJcr'],
            [chkPubShowDoi, 'showPubListDoi'],
            [chkPubShowCit, 'showPubListCitations']
        ].forEach(([chk, key]) => {
            if (!chk) return;
            chk.addEventListener('change', () => {
                state[key] = chk.checked;
                if (isPubListGenerated) generatePubList();
            });
        });

        // Journal table
        const headerJournalList = doc.getElementById('header-journal-list');
        const contentJournalList = doc.getElementById('content-journal-list');
        const journalContainer = doc.getElementById('journal-list-container');
        const inpJournalYears = doc.getElementById('inp-journal-years');
        const inpJournalMinPapers = doc.getElementById('inp-journal-min-papers');
        const btnJournalUpdate = doc.getElementById('btn-journal-update');
        let isJournalGenerated = false;

        const attachJournalSort = () => {
            const table = doc.getElementById('journal-table');
            if (!table) return;
            const tbody = doc.getElementById('journal-table-body');
            const sortState = { col: 3, dir: -1 };

            table.querySelectorAll('th[data-sort-col]').forEach(th => {
                th.addEventListener('click', () => {
                    const col = parseInt(th.getAttribute('data-sort-col'));
                    const sortType = th.getAttribute('data-sort-type');
                    if (sortState.col === col) {
                        sortState.dir *= -1;
                    } else {
                        sortState.col = col;
                        sortState.dir = -1;
                    }
                    const dir = sortState.dir;
                    const rows = Array.from(tbody.querySelectorAll('tr'));
                    rows.sort((a, b) => {
                        const tdA = a.querySelectorAll('td')[col];
                        const tdB = b.querySelectorAll('td')[col];
                        let valA, valB;
                        if (sortType === 'num') {
                            valA = parseFloat(tdA.getAttribute('data-val')) || 0;
                            valB = parseFloat(tdB.getAttribute('data-val')) || 0;
                        } else {
                            valA = tdA.textContent.trim().toLowerCase();
                            valB = tdB.textContent.trim().toLowerCase();
                        }
                        const cmp = valA < valB ? -1 : valA > valB ? 1 : 0;
                        return dir === 1 ? cmp : -cmp;
                    });
                    rows.forEach(r => tbody.appendChild(r));
                    table.querySelectorAll('th[data-sort-col]').forEach(h => {
                        const c = parseInt(h.getAttribute('data-sort-col'));
                        const base = h.textContent.replace(/\s[▲▼]$/, '');
                        h.textContent = base + (c === col ? ' ' + (dir === -1 ? '▼' : '▲') : '');
                    });
                });
            });
        };

        const generateJournalList = () => {
            const years = parseInt(inpJournalYears.value, 10);
            const minP = parseInt(inpJournalMinPapers.value, 10);
            state.journalYears = isNaN(years) ? 5 : Math.max(0, years);
            state.minJournalPapers = isNaN(minP) || minP < 1 ? 1 : minP;
            journalContainer.innerHTML = window.JCRReportUtils.generateJournalTableHTML(
                filteredPublications, state.journalYears, state.minJournalPapers,
                currentYear, state.highJcr, state.lowJcr
            );
            attachJournalSort();
            isJournalGenerated = true;
        };

        if (headerJournalList) {
            headerJournalList.addEventListener('click', () => {
                if (!isJournalGenerated) generateJournalList();
            });
        }

        if (btnJournalUpdate) {
            btnJournalUpdate.addEventListener('click', (e) => {
                e.stopPropagation();
                generateJournalList();
                contentJournalList.style.display = 'block';
                headerJournalList.querySelector('.toggle-icon').textContent = '[-]';
            });
        }

        // Lista de Publicações e Publicações por Periódico começam recolhidas e só são geradas
        // sob demanda. Sem isto, imprimir sem antes abri-las manualmente resulta na seção vazia
        // (só o título, sem lista) — então expandimos e geramos ambas antes de qualquer impressão,
        // seja pelo botão da página ou por Ctrl+P do navegador.
        newTab.addEventListener('beforeprint', () => {
            if (!isPubListGenerated) generatePubList();
            if (contentPubList) contentPubList.style.display = 'block';
            const pubIcon = headerPubList && headerPubList.querySelector('.toggle-icon');
            if (pubIcon) pubIcon.textContent = '[-]';

            if (!isJournalGenerated) generateJournalList();
            if (contentJournalList) contentJournalList.style.display = 'block';
            const journalIcon = headerJournalList && headerJournalList.querySelector('.toggle-icon');
            if (journalIcon) journalIcon.textContent = '[-]';
        });
    },

    exportCSV: async function () {
        const db = await this.getDB();
        if (db.length === 0) {
            alert("O banco de dados está vazio.");
            return;
        }

        // Using semicolon for Excel compatibility in Brazil
        let csvContent = "\uFEFF"; // BOM for UTF-8 Excel
        
        // CSV Header
        csvContent += this.METRICS_CONFIG.map(m => m.label.replace(/(\r\n|\n|\r)/gm, " ")).join(';') + "\r\n";

        // CSV Rows
        db.forEach(cv => {
            let row = this.METRICS_CONFIG.map(m => {
                let val = cv[m.key] !== undefined ? String(cv[m.key]) : '';
                // Format decimal numbers for Brazilian Excel
                if (val.includes('.') && !isNaN(val)) {
                    val = val.replace('.', ',');
                }
                // Escape quotes
                val = '"' + val.replace(/"/g, '""') + '"';
                return val;
            });
            csvContent += row.join(';') + "\r\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "jcr_lattes_database.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 100);
    },

    exportJSON: async function () {
        const db = await this.getDB();
        if (db.length === 0) {
            alert("O banco de dados está vazio.");
            return;
        }

        const jsonContent = JSON.stringify(db, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "jcr_lattes_database_backup.json");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 100);
    },

    importJSON: function (file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const importedDB = JSON.parse(e.target.result);
                    if (!Array.isArray(importedDB)) {
                        alert("Erro: O arquivo JSON não contém um banco de dados válido (esperado um array).");
                        resolve();
                        return;
                    }
                    
                    const currentDB = await this.getDB();
                    let addedCount = 0;
                    let updatedCount = 0;
                    let skippedCount = 0;
                    const toUpsert = [];
                    const toRemoveOldKey = [];

                    for (const importedCV of importedDB) {
                        if (!importedCV.name) continue; // Invalid entry

                        const existingIndex = currentDB.findIndex(cv => this.cvMatches(cv, importedCV.name, importedCV.lattesId));
                        if (existingIndex >= 0) {
                            const existing = currentDB[existingIndex];
                            const existingDate = existing.dateAdded ? new Date(existing.dateAdded) : new Date(0);
                            const importedDate = importedCV.dateAdded ? new Date(importedCV.dateAdded) : new Date(0);
                            if (importedDate <= existingDate) {
                                skippedCount++;
                                continue; // Keep the newer local version
                            }
                            if (this._cvStorageKey(existing) !== this._cvStorageKey(importedCV)) {
                                toRemoveOldKey.push(existing);
                            }
                            currentDB[existingIndex] = importedCV;
                            updatedCount++;
                        } else {
                            currentDB.push(importedCV);
                            addedCount++;
                        }
                        toUpsert.push(importedCV);
                    }

                    if (toRemoveOldKey.length > 0) await this.removeCVs(toRemoveOldKey);
                    await this.saveCVs(toUpsert);
                    const skippedMsg = skippedCount > 0 ? `\nCVs mantidos (versão local mais recente): ${skippedCount}` : '';
                    alert(`Importação concluída com sucesso!\n\nCVs adicionados: ${addedCount}\nCVs atualizados: ${updatedCount}${skippedMsg}`);
                    resolve();
                } catch (error) {
                    alert("Erro ao ler o arquivo JSON: " + error.message);
                    resolve();
                }
            };
            reader.onerror = () => {
                alert("Erro ao ler o arquivo.");
                resolve();
            };
            reader.readAsText(file);
        });
    },

    showToast: function (msg, color = '#4CAF50') {
        let toast = document.getElementById('jcr-private-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'jcr-private-toast';
            toast.style.cssText = 'position:fixed; bottom:20px; right:20px; color:white; padding:10px 20px; border-radius:4px; font-weight:bold; z-index:9999; box-shadow:0 2px 5px rgba(0,0,0,0.2); transition: opacity 0.3s; opacity: 0;';
            document.body.appendChild(toast);
        }
        toast.style.background = color;
        toast.innerText = msg;
        toast.style.opacity = '1';
        setTimeout(() => { toast.style.opacity = '0'; }, 3000);
    },

    renderUI: function (mountId) {
        const mount = document.getElementById(mountId);
        if (!mount) return;

        // Evita re-render se a UI já reflete o estado atual: reescrever o innerHTML
        // a cada reprocessamento faz os botões piscarem e o layout "tremer".
        const alreadyUnlocked = !!mount.querySelector('#jcr-priv-save');
        const alreadyLocked   = !!mount.querySelector('#jcr-priv-unlock-btn');
        const autoSaveBtn = mount.querySelector('#jcr-priv-autosave');
        const autoSaveMatches = !!autoSaveBtn && autoSaveBtn.innerText.includes(this.autoSave ? 'ON' : 'OFF');
        if ((this.isUnlocked && alreadyUnlocked && autoSaveMatches) || (!this.isUnlocked && alreadyLocked)) return;

        // Base styles for buttons
        const btnStyle = 'cursor:pointer; font-size:0.85em; padding:3px 8px; border:1px solid #ccc; border-radius:4px; background:#fff; color:#333; display:inline-flex; align-items:center; height:24px; font-weight:500;';
        
        // Remove any existing bottom unlock button (for cleanup during transition)
        let bottomUnlock = document.getElementById('jcr-bottom-unlock-btn');
        if (bottomUnlock) {
            bottomUnlock.remove();
        }

        if (!this.isUnlocked) {
            // Locked UI - Place padlock directly in the mount
            mount.innerHTML = `
                <button id="jcr-priv-unlock-btn" style="${btnStyle} border-color:transparent; background:transparent; font-size:1.8em; height:auto; padding: 0 5px;" title="Ativar Ferramentas de Banco de Dados">
                    🗄️
                </button>
            `;
            document.getElementById('jcr-priv-unlock-btn').onclick = () => this.promptUnlock();
        } else {
            // Unlocked UI
            const autoSaveColor = this.autoSave ? '#e8f5e9' : '#fff';
            const autoSaveBorder = this.autoSave ? '#4CAF50' : '#ccc';
            
            mount.innerHTML = `
                <div style="display:flex; gap:5px; align-items:center; background:#f0f7ff; padding:2px 5px; border-radius:6px; border:1px solid #bbdefb;">
                    <button id="jcr-priv-autosave" style="${btnStyle} background:${autoSaveColor}; border-color:${autoSaveBorder};" title="Salvar automaticamente novos currículos">
                        ${this.autoSave ? '✅ Auto-Save: ON' : '⏸️ Auto-Save: OFF'}
                    </button>
                    <button id="jcr-priv-save" style="${btnStyle}" title="Salvar/Atualizar CV atual no Banco">💾 Salvar</button>
                    <button id="jcr-priv-view" style="${btnStyle} border-color:#2196F3; color:#1976D2;" title="Visualizar Banco de CVs">👁️ View DB</button>
                    <button id="jcr-priv-lock" style="${btnStyle} border-color:transparent; background:transparent;" title="Ocultar ferramentas">🗄️</button>
                </div>
            `;

            document.getElementById('jcr-priv-autosave').onclick = () => this.toggleAutoSave();
            document.getElementById('jcr-priv-save').onclick = () => this.saveCurrentCV();
            document.getElementById('jcr-priv-view').onclick = () => this.viewDB();
            document.getElementById('jcr-priv-lock').onclick = () => this.lock();
        }
    }
};
