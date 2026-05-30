// db_tools.js
// This file contains database tools and metrics logic for JCR Lattes.
// It should be REPLACED WITH AN EMPTY FILE for the public Chrome Web Store release.

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
    passcode: "avalia26",
    isUnlocked: false,
    autoSave: false,
    dbKey: 'jcr_cv_database',
    settingsKey: 'jcr_private_settings',
    currentCvData: null,
    sortConfig: { key: 'name', ascending: true },
    lastArgs: null,

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
        { key: 'customId', label: 'ID', title: 'ID ou Grupo customizado', customRender: true }
    ],

    init: async function (mountId, nameLink, stats, lattesInfo = [], ridStats = null) {
        this.lastArgs = { nameLink, stats, lattesInfo, ridStats };
        this.extractData(nameLink, stats, lattesInfo, ridStats);
        await this.loadSettings();

        // Check if we are still waiting for ResearcherID stats
        const hasRidLink = !!nameLink.researcherIdLink;
        const isRidPending = hasRidLink && !ridStats;

        if (this.autoSave && this.isUnlocked && !isRidPending) {
            if (this._saveTimeout) clearTimeout(this._saveTimeout);
            this._saveTimeout = setTimeout(() => {
                // At the end of the timeout, ensure we fetch the latest DOM state again
                // by calling extractData with the most recent lastArgs
                if (this.lastArgs) {
                    this.extractData(this.lastArgs.nameLink, this.lastArgs.stats, this.lastArgs.lattesInfo, this.lastArgs.ridStats);
                }
                this.saveCurrentCV(true); // silent auto-save
            }, 3000); // Wait 3 seconds after the last update to ensure Lattes AJAX has finished injecting
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
                jif: pub.impactFactor ? parseFloat(pub.impactFactor) : 0,
                authorCount: pub.authorCount,
                authorRank: pub.authorRank || -1,
                hasEtAl: pub.hasEtAl,
                wosCitations: pub.wosCitations || 0,
                scopusCitations: pub.scopusCitations || 0,
                doi: pub.doi || '',
                reference: pub.reference || ''
            }))
        };
    },

    loadSettings: async function () {
        return new Promise((resolve) => {
            chrome.storage.local.get(this.settingsKey, (result) => {
                if (result && result[this.settingsKey]) {
                    this.isUnlocked = result[this.settingsKey].isUnlocked || false;
                    this.autoSave = result[this.settingsKey].autoSave || false;
                }
                resolve();
            });
        });
    },

    saveSettings: function () {
        chrome.storage.local.set({
            [this.settingsKey]: {
                isUnlocked: this.isUnlocked,
                autoSave: this.autoSave
            }
        });
    },

    getDB: async function () {
        return new Promise((resolve) => {
            chrome.storage.local.get(this.dbKey, (result) => {
                const db = result && result[this.dbKey] ? result[this.dbKey] : [];
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
                resolve(db);
            });
        });
    },

    saveDB: function (dbArray) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ [this.dbKey]: dbArray }, resolve);
        });
    },

    saveCurrentCV: async function (silent = false) {
        // Ensure we have the latest data before saving
        if (this.lastArgs) {
            this.extractData(this.lastArgs.nameLink, this.lastArgs.stats, this.lastArgs.lattesInfo, this.lastArgs.ridStats);
        }

        const db = await this.getDB();
        const existingIndex = db.findIndex(cv => cv.name === this.currentCvData.name);
        if (existingIndex >= 0) {
            const existing = db[existingIndex];
            
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

            // Protect JCR/WoS fields from being zeroed out by incomplete loads
            jcrFields.forEach(field => {
                const newVal = this.currentCvData[field];
                const oldVal = existing[field];
                // If new value is 0/empty but old value was non-zero, and we have papers, preserve old value
                if ((newVal === 0 || newVal === '') && oldVal && oldVal !== 0 && oldVal !== '') {
                    // Only preserve if we actually have papers (if totalPapers is 0, then 0 JCR is correct)
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
            
            db[existingIndex] = this.currentCvData;
        } else {
            if (this.currentCvData.customId === undefined) {
                this.currentCvData.customId = '';
            }
            db.push(this.currentCvData);
        }
        await this.saveDB(db);
        if (!silent) this.showToast('CV Salvo no Banco de Dados!');
    },

    deleteSingleCV: async function (name) {
        const db = await this.getDB();
        const existingIndex = db.findIndex(cv => cv.name === name);
        if (existingIndex >= 0) {
            db.splice(existingIndex, 1);
            await this.saveDB(db);
        }
    },

    clearDB: async function (silent = false) {
        if (silent || confirm("Tem certeza que deseja apagar todos os CVs salvos?")) {
            await this.saveDB([]);
            if (!silent) this.showToast('Banco de dados limpo!');
        }
    },

    promptUnlock: function () {
        // const input = prompt("Digite a senha de acesso (Comitê Assessor):");
        // if (input === this.passcode) {
            this.isUnlocked = true;
            this.saveSettings();
            const mount = document.getElementById('jcr-db-tools-mount');
            if (mount) this.renderUI('jcr-db-tools-mount');
        // } else if (input !== null) {
        //     alert("Senha incorreta!");
        // }
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
                    .btn-clear-id { background-color: #FFF3E0; color: #333; padding: 4px 6px; font-size: 14px; margin-right: 5px; border: 1px solid #FFCC80; border-radius: 4px; }
                    .btn-clear-id:hover { background-color: #FFE0B2; }
                    .btn-delete-row { background-color: #FFEBEE; color: #333; padding: 4px 6px; font-size: 14px; border: 1px solid #EF9A9A; border-radius: 4px; }
                    .btn-delete-row:hover { background-color: #FFCDD2; }
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
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>JCR Lattes - Banco de CVs (${db.length})</h1>
                    <div>
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
            let datalistHtml = `<datalist id="custom-id-list">`;
            let groupOptions = `<option value="">-- Selecione um Grupo --</option>`;
            uniqueIds.forEach(id => {
                datalistHtml += `<option value="${id.replace(/"/g, '&quot;')}">`;
                groupOptions += `<option value="${id.replace(/"/g, '&quot;')}">${id}</option>`;
            });
            datalistHtml += `</datalist>`;
            tableHtml += datalistHtml;

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
            this.METRICS_CONFIG.forEach(m => {
                const arrow = this.sortConfig.key === m.key ? (this.sortConfig.ascending ? ' ▲' : ' ▼') : '';
                const titleAttr = m.title ? ` title="${m.title}"` : '';
                let classes = ['sortable-header'];
                if (m.division) classes.push('division-left');
                if (m.numeric) classes.push('numeric-cell');
                const classAttr = ` class="${classes.join(' ')}"`;
                theadHtml += `<th${titleAttr} data-key="${m.key}"${classAttr}>${m.label}<span class="sort-indicator">${arrow}</span></th>`;
            });
            theadHtml += `<th class="division-left" style="font-size: 0.85em;">Ações</th></tr>`;

            let tbodyHtml = ``;
            db.forEach(cv => {
                tbodyHtml += `<tr>`;
                this.METRICS_CONFIG.forEach(m => {
                    const val = cv[m.key] !== undefined ? cv[m.key] : '';
                    let classes = [];
                    if (m.division) classes.push('division-left');
                    if (m.numeric) classes.push('numeric-cell');
                    if (m.key === 'name') classes.push('name-cell');
                    const classAttr = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';
                    
                    if (m.key === 'name') {
                        const lattesLink = cv.lattesId ? `http://lattes.cnpq.br/${cv.lattesId}` : '#';
                        tbodyHtml += `<td${classAttr}><strong><a href="${lattesLink}" target="_blank" style="color: #1565C0; text-decoration: none;">${val}</a></strong></td>`;
                    } else if (m.key === 'researcherIdLink') {
                        if (val) {
                            tbodyHtml += `<td class="rid-link-cell"><a href="${val}" target="_blank" title="ResearcherID" style="text-decoration:none; font-size:1.2em;">🔗</a></td>`;
                        } else {
                            tbodyHtml += `<td></td>`;
                        }
                    } else if (m.key === 'customId') {
                        const safeId = (val || '').replace(/"/g, '&quot;');
                        const safeName = (cv.name || '').replace(/"/g, '&quot;');
                        tbodyHtml += `<td${classAttr}>
                            <input type="text" class="custom-id-input" data-name="${safeName}" value="${safeId}" list="custom-id-list" placeholder="ID..." style="width: 80px; padding: 2px 4px; border: 1px solid #ccc; border-radius: 3px;">
                        </td>`;
                    } else {
                        tbodyHtml += `<td${classAttr}>${val}</td>`;
                    }
                });
                const safeName = (cv.name || '').replace(/"/g, '&quot;');
                tbodyHtml += `<td class="division-left" style="white-space: nowrap;">
                    <button class="btn btn-view-report" data-name="${safeName}" title="Relatório">📊</button>
                    <button class="btn btn-clear-id" data-name="${safeName}" title="Limpar ID">🧹</button>
                    <button class="btn btn-delete-row" data-name="${safeName}" title="Excluir">🗑️</button>
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
                if (newTab.confirm(`Tem certeza que deseja apagar o CV de ${name}?`)) {
                    this.deleteSingleCV(name).then(() => {
                        this.viewDB(newTab);
                    });
                }
            });
        });

        const customIdInputs = newTab.document.querySelectorAll('.custom-id-input');
        
        const updateDatalist = (db, currentInputVal = '') => {
            const uniqueIds = Array.from(new Set(
                db.flatMap(cv => (cv.customId || '').split(',').map(s => s.trim()).filter(s => s !== ''))
            )).sort();
            
            let prefix = '';
            const lastComma = currentInputVal.lastIndexOf(',');
            if (lastComma >= 0) {
                prefix = currentInputVal.substring(0, lastComma + 1).trim() + ' ';
            }

            const datalist = newTab.document.getElementById('custom-id-list');
            if (datalist) {
                datalist.innerHTML = '';
                uniqueIds.forEach(id => {
                    // Prevent showing duplicates in the datalist if already in prefix
                    if (prefix && prefix.includes(id)) return;
                    
                    const option = newTab.document.createElement('option');
                    option.value = prefix + id;
                    datalist.appendChild(option);
                });
            }
        };

        customIdInputs.forEach(input => {
            const updateLocalDatalist = async () => {
                const db = await this.getDB();
                updateDatalist(db, input.value);
            };
            
            input.addEventListener('focus', updateLocalDatalist);
            input.addEventListener('input', updateLocalDatalist);
            
            input.addEventListener('change', async (e) => {
                const name = e.currentTarget.getAttribute('data-name');
                let newValue = e.currentTarget.value;
                
                // Cleanup trailing commas or spaces
                const cleanedValue = newValue.split(',').map(s => s.trim()).filter(s => s !== '').join(', ');
                if (newValue.trim() !== '' && cleanedValue === '') {
                   // User typed commas but no valid ID, keep whatever they typed so they can finish
                } else {
                    newValue = cleanedValue;
                    e.currentTarget.value = newValue; // Reflect cleaned up value back to UI
                }

                const db = await this.getDB();
                const cvIndex = db.findIndex(cv => cv.name === name);
                if (cvIndex >= 0) {
                    db[cvIndex].customId = newValue;
                    await this.saveDB(db);
                    updateDatalist(db, newValue);
                }
            });
        });

        const clearIdBtns = newTab.document.querySelectorAll('.btn-clear-id');
        clearIdBtns.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const name = e.currentTarget.getAttribute('data-name');
                const db = await this.getDB();
                const cvIndex = db.findIndex(cv => cv.name === name);
                if (cvIndex >= 0) {
                    db[cvIndex].customId = '';
                    await this.saveDB(db);
                    this.viewDB(newTab); // Fully refresh the table to update sorting and datalists
                }
            });
        });

        const viewReportBtns = newTab.document.querySelectorAll('.btn-view-report');
        viewReportBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const name = e.currentTarget.getAttribute('data-name');
                if (!name) return; // Skip group report button
                const cvData = db.find(cv => cv.name === name);
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
            const groupCvs = db.filter(cv => {
                const ids = (cv.customId || '').split(',').map(s => s.trim());
                return ids.includes(groupId);
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
                name: `Grupo: ${groupId} (${groupCvs.length} membros)`,
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

        const groupBtnClear = newTab.document.getElementById('group-btn-clear');
        if (groupBtnClear) {
            groupBtnClear.addEventListener('click', async () => {
                const groupId = groupSelect.value;
                if (!groupId) return;
                if (newTab.confirm(`Tem certeza que deseja limpar o ID '${groupId}' de todos os currículos?`)) {
                    const db = await this.getDB();
                    db.forEach(cv => { 
                        let ids = (cv.customId || '').split(',').map(s => s.trim()).filter(s => s !== '');
                        if (ids.includes(groupId)) {
                            ids = ids.filter(id => id !== groupId);
                            cv.customId = ids.join(', ');
                        }
                    });
                    await this.saveDB(db);
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
                    const newDb = db.filter(cv => {
                        let ids = (cv.customId || '').split(',').map(s => s.trim()).filter(s => s !== '');
                        return !ids.includes(groupId);
                    });
                    await this.saveDB(newDb);
                    this.viewDB(newTab);
                }
            });
        }
    },

    renderCVReport: function(cvData, newTab, sortedDb = null) {
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
                showHighJcr: true,
                showMidJcr: true,
                showLowJcr: true,
                showNoJcr: true,
                showAuthorFirst: true,
                showAuthorLast: true,
                showAuthorOthers: true,
                showAuthorGc: true
            };
        }
        
        newTab.reportState = this.reportState;
        const state = newTab.reportState;
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
            
            let isFirst = pub.isFirstAuthor !== undefined ? pub.isFirstAuthor : pub.authorRank === 1;
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
            currentYear, state.customYears, startYearRecent, startYearLast10, startYearCustom, state.highJcr, state.lowJcr
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
                    <button id="btn-prev-cv" data-name="${prevCv.name.replace(/"/g, '&quot;')}" style="padding: 8px 15px; background: #95a5a6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-right: 10px;" title="CV Anterior: ${prevCv.name.replace(/"/g, '&quot;')}">⬅️ Anterior</button>
                    <button id="btn-next-cv" data-name="${nextCv.name.replace(/"/g, '&quot;')}" style="padding: 8px 15px; background: #95a5a6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-right: 10px;" title="Próximo CV: ${nextCv.name.replace(/"/g, '&quot;')}">Próximo ➡️</button>
                `;
            }
        }

        const headerHTML = `
            <div style="background: ${COLORS.backgroundSubHeader}; padding: 15px; border-bottom: 1px solid ${COLORS.border}; margin-bottom: 15px; border-radius: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h2 style="margin: 0; color: ${COLORS.footerText};">Relatório: ${cvData.name}</h2>
                    <div>
                        ${navButtonsHTML}
                        <button id="btn-back-db" style="padding: 8px 15px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">⬅️ Voltar ao Banco</button>
                    </div>
                </div>
                
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
                        <label style="cursor:pointer;"><input type="checkbox" id="chk-auth-first" ${state.showAuthorFirst ? 'checked' : ''}> 1º Autor</label><br>
                        <label style="cursor:pointer;"><input type="checkbox" id="chk-auth-last" ${state.showAuthorLast ? 'checked' : ''}> Último Autor</label><br>
                        <label style="cursor:pointer;"><input type="checkbox" id="chk-auth-others" ${state.showAuthorOthers ? 'checked' : ''}> Outros</label><br>
                        <label style="cursor:pointer;"><input type="checkbox" id="chk-auth-gc" ${state.showAuthorGc ? 'checked' : ''}> Grandes Colaborações (et al)</label>
                    </div>
                    
                    <div style="flex: 1; min-width: 200px;">
                        <div style="font-weight: bold; margin-bottom: 8px;">Período Customizado:</div>
                        <div>Anos: <input type="number" id="inp-custom-years" value="${state.customYears}" min="0" style="width: 50px;"></div>
                        <div style="margin-top: 20px; color: #666; font-size: 0.9em;">
                            ${cvData.name.startsWith('Grupo:') ? '' : `ID Lattes: ${cvData.lattesId}<br>`}
                            Sincronizado em: ${new Date(cvData.dateAdded).toLocaleDateString()}
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
                        <th style="padding: 4px; border-left: 1px solid #eee; text-align: center; background-color: ${bgTotal};">1o</th>
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
                    ${window.JCRReportUtils.generateRow(`5 anos (${startYearRecent} - ${maxYear})`, stats.recent)}
                    ${window.JCRReportUtils.generateRow(`10 anos (${startYearLast10} - ${maxYear})`, stats.last10)}
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

        let membersTableHTML = '';
        if (cvData.groupMembers && cvData.groupMembers.length > 0) {
            let theadHtml = `<tr style="background-color: ${COLORS.backgroundHeader}; border-bottom: 2px solid ${COLORS.border};">`;
            this.METRICS_CONFIG.forEach(m => {
                if (m.key === 'customId' || m.key === 'researcherIdLink') return;
                const titleAttr = m.title ? ` title="${m.title}"` : '';
                let style = 'padding: 8px; font-weight: bold; position: sticky; top: 0; z-index: 1; border-bottom: 2px solid #ccc;';
                if (m.division) style += ' border-left: 1px solid #bbb;';
                if (m.numeric || m.key === 'researcherIdLink') style += ' text-align: center;';
                theadHtml += `<th${titleAttr} style="${style}">${m.label}</th>`;
            });
            theadHtml += `</tr>`;

            let tbodyHtml = ``;
            cvData.groupMembers.forEach(cv => {
                tbodyHtml += `<tr>`;
                this.METRICS_CONFIG.forEach(m => {
                    if (m.key === 'customId' || m.key === 'researcherIdLink') return;
                    const val = cv[m.key] !== undefined ? cv[m.key] : '';
                    let style = 'padding: 6px 8px; border-bottom: 1px solid #eee;';
                    if (m.division) style += ' border-left: 1px solid #bbb;';
                    if (m.numeric || m.key === 'researcherIdLink') style += ' text-align: center;';
                    
                    if (m.key === 'name') {
                        const lattesLink = cv.lattesId ? `http://lattes.cnpq.br/${cv.lattesId}` : '#';
                        tbodyHtml += `<td style="${style}"><strong><a href="${lattesLink}" target="_blank" style="color: #1565C0; text-decoration: none;">${val}</a></strong></td>`;
                    } else if (m.key === 'researcherIdLink') {
                        if (val) {
                            tbodyHtml += `<td style="${style}"><a href="${val}" target="_blank" title="ResearcherID" style="text-decoration:none; font-size:1.2em;">🔗</a></td>`;
                        } else {
                            tbodyHtml += `<td style="${style}"></td>`;
                        }
                    } else {
                        tbodyHtml += `<td style="${style}">${val}</td>`;
                    }
                });
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
                <title>Relatório: ${cvData.name}</title>
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
                            <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                                <div style="flex: 1; min-width: 400px; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; background: #fff;">
                                    ${histogramHTML}
                                </div>
                                <div style="flex: 1; min-width: 400px; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; background: #fff;">
                                    ${papersPerYearHTML}
                                </div>
                            </div>
                        </div>
                    </div>` : ''}

                    ${membersTableHTML}

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
        
        doc.getElementById('btn-back-db').addEventListener('click', () => {
            this.viewDB(newTab);
        });

        const btnPrev = doc.getElementById('btn-prev-cv');
        if (btnPrev) {
            btnPrev.addEventListener('click', () => {
                const name = btnPrev.getAttribute('data-name');
                const nextCvData = sortedDb.find(cv => cv.name === name);
                if (nextCvData) this.renderCVReport(nextCvData, newTab, sortedDb);
            });
        }

        const btnNext = doc.getElementById('btn-next-cv');
        if (btnNext) {
            btnNext.addEventListener('click', () => {
                const name = btnNext.getAttribute('data-name');
                const nextCvData = sortedDb.find(cv => cv.name === name);
                if (nextCvData) this.renderCVReport(nextCvData, newTab, sortedDb);
            });
        }

        const reRender = () => {
            state.highJcr = parseFloat(doc.getElementById('inp-high-jcr').value) || 7.0;
            state.lowJcr = parseFloat(doc.getElementById('inp-low-jcr').value) || 1.5;
            const customYearsVal = parseInt(doc.getElementById('inp-custom-years').value, 10);
            state.customYears = isNaN(customYearsVal) ? 1 : customYearsVal;
            state.showHighJcr = doc.getElementById('chk-jcr-high').checked;
            state.showMidJcr = doc.getElementById('chk-jcr-mid').checked;
            state.showLowJcr = doc.getElementById('chk-jcr-low').checked;
            state.showNoJcr = doc.getElementById('chk-jcr-none').checked;
            state.showAuthorFirst = doc.getElementById('chk-auth-first').checked;
            state.showAuthorLast = doc.getElementById('chk-auth-last').checked;
            state.showAuthorOthers = doc.getElementById('chk-auth-others').checked;
            state.showAuthorGc = doc.getElementById('chk-auth-gc').checked;
            
            this.renderCVReport(cvData, newTab, sortedDb);
        };

        ['inp-high-jcr', 'inp-low-jcr', 'inp-custom-years'].forEach(id => {
            doc.getElementById(id).addEventListener('change', reRender);
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

                    for (const importedCV of importedDB) {
                        if (!importedCV.name) continue; // Invalid entry
                        
                        const existingIndex = currentDB.findIndex(cv => cv.name === importedCV.name);
                        if (existingIndex >= 0) {
                            currentDB[existingIndex] = importedCV;
                            updatedCount++;
                        } else {
                            currentDB.push(importedCV);
                            addedCount++;
                        }
                    }

                    await this.saveDB(currentDB);
                    alert(`Importação concluída com sucesso!\n\nCVs adicionados: ${addedCount}\nCVs atualizados: ${updatedCount}`);
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

    showToast: function (msg) {
        let toast = document.getElementById('jcr-private-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'jcr-private-toast';
            toast.style.cssText = 'position:fixed; bottom:20px; right:20px; background:#4CAF50; color:white; padding:10px 20px; border-radius:4px; font-weight:bold; z-index:9999; box-shadow:0 2px 5px rgba(0,0,0,0.2); transition: opacity 0.3s; opacity: 0;';
            document.body.appendChild(toast);
        }
        toast.innerText = msg;
        toast.style.opacity = '1';
        setTimeout(() => { toast.style.opacity = '0'; }, 3000);
    },

    renderUI: function (mountId) {
        const mount = document.getElementById(mountId);
        if (!mount) return;

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
                <button id="jcr-priv-unlock-btn" style="${btnStyle} border-color:transparent; background:transparent; font-size:1.2em; padding: 0 5px; opacity: 0.5; transition: opacity 0.2s;" title="Ativar Ferramentas de Banco de Dados" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'">
                    🔒
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
                    <button id="jcr-priv-lock" style="${btnStyle} border-color:transparent; background:transparent;" title="Bloquear ferramentas">🔓</button>
                </div>
            `;

            document.getElementById('jcr-priv-autosave').onclick = () => this.toggleAutoSave();
            document.getElementById('jcr-priv-save').onclick = () => this.saveCurrentCV();
            document.getElementById('jcr-priv-view').onclick = () => this.viewDB();
            document.getElementById('jcr-priv-lock').onclick = () => this.lock();
        }
    }
};
