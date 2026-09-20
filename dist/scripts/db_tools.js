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
    // Estado (recolhido = true) de cada bloco do relatorio, por chave derivada do titulo.
    // E global: vale para todos os relatorios abertos depois, ate mudar de novo.
    reportCollapsed: {},
    // Marcado na ultima exportacao de propostas: incluir ou nao os documentos em HTML.
    exportIncludeHtml: true,
    dbPrintOrientation: 'landscape', // melhor padrão para a tabela larga do banco
    dbKey: 'jcr_cv_database', // chave legada (array único); migrada para chaves por CV
    procKeyPrefix: 'jcr_proc:',
    cvKeyPrefix: 'jcr_cv:',
    settingsKey: 'jcr_private_settings',
    currentCvData: null,
    sortConfig: { key: 'name', ascending: true },
    faixaFilter: '',                 // '' = todas as faixas; '-' = propostas sem faixa
    lastArgs: null,
    DB_SCHEMA_VERSION: 2,

    _esc: function(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    },

    // ---------------------------------------------------------------------------
    // Reimportar uma proposta nao pode apagar o que foi ajustado a mao. O editor da
    // equipe deixa marcas no registro e a extracao as respeita:
    //   manual: true   -> membro acrescentado a mao (a extracao nunca o traz)
    //   editado: true  -> membro corrigido a mao (a versao do usuario vence)
    //   removedMembers -> nomes apagados a mao (a extracao nao os traz de volta)
    // ---------------------------------------------------------------------------
    _chaveMembro: function (nome) {
        return String(nome || '').trim().toLowerCase();
    },

    // Junta a equipe recem-extraida com a que ja estava no banco.
    mesclarEquipe: function (extraidos, existentes, removidos) {
        const novos = Array.isArray(extraidos) ? extraidos.filter(m => m && m.name) : [];
        const antigos = Array.isArray(existentes) ? existentes.filter(m => m && m.name) : [];
        const apagados = new Set((Array.isArray(removidos) ? removidos : []).map(n => this._chaveMembro(n)));

        const porChave = new Map();
        antigos.forEach(m => porChave.set(this._chaveMembro(m.name), m));

        const resultado = [];
        const usados = new Set();

        novos.forEach(m => {
            const k = this._chaveMembro(m.name);
            if (apagados.has(k)) return;              // o usuario apagou: nao volta
            if (usados.has(k)) return;                // nome repetido na extracao entra uma vez
            usados.add(k);
            const antigo = porChave.get(k);
            // corrigido a mao vence a extracao; senao entra o dado novo
            resultado.push((antigo && antigo.editado) ? antigo : m);
        });

        // acrescentados ou corrigidos a mao que a extracao nao trouxe continuam na lista
        antigos.forEach(m => {
            const k = this._chaveMembro(m.name);
            if (usados.has(k) || apagados.has(k)) return;
            if (m.manual || m.editado) { usados.add(k); resultado.push(m); }
        });

        return resultado;
    },

    // O proponente corrigido a mao tambem nao e sobrescrito pela extracao.
    mesclarProponente: function (novo, existente) {
        if (existente && existente.editado) return existente;
        return novo || existente || {};
    },

    // Nº de participantes da proposta: proponente + equipe, sem repetir nomes — a mesma
    // contagem que o relatorio da proposta mostra na tabela de equipe.
    _contarParticipantes: function (proc) {
        if (!proc) return 0;
        const nomes = new Set();
        const chave = (n) => String(n || '').trim().toLowerCase();
        const propNome = chave((proc.proponente && proc.proponente.name) || proc.name);
        if (propNome) nomes.add(propNome);
        (Array.isArray(proc.teamMembers) ? proc.teamMembers : []).forEach(tm => {
            const n = chave(tm && tm.name);
            if (n) nomes.add(n);
        });
        return nomes.size;
    },

    // Nº de pareceres ad hoc da proposta.
    _contarPareceres: function (proc) {
        return (proc && Array.isArray(proc.reviews)) ? proc.reviews.length : 0;
    },

    // Valor de uma coluna. As colunas Equipe e Pareceres sao calculadas na hora, e nao
    // campos do registro: assim nao vao parar no armazenamento nem ficam desatualizadas.
    _valorColuna: function (cv, key) {
        if (!cv) return '';
        if (key === 'teamCount') return this._contarParticipantes(cv);
        if (key === 'reviewCount') return this._contarPareceres(cv);
        return cv[key];
    },

    // Faixa da proposta como aparece na tabela: maiuscula, ou '-' quando nao ha
    _faixaDe: function (cv) {
        const f = cv && cv.faixa;
        return (f !== undefined && f !== null && String(f).trim() !== '') ? String(f).trim().toUpperCase() : '-';
    },

    // Identidade de um artigo, para reconhecer o mesmo trabalho em CVs diferentes.
    // Mesma ideia do tools/parse_jcr_backup.py: o DOI manda; sem ele, o titulo
    // normalizado mais o ano. Nao depende de producoes_parser.js porque o relatorio
    // tambem roda na pagina do Lattes, onde aquele script nao e carregado.
    _chaveArtigo: function (pub) {
        if (!pub) return '';
        const doi = String(pub.doi || '').trim().toLowerCase();
        if (doi) return 'doi:' + doi;
        const titulo = String(pub.paperTitle || pub.title || '')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&[a-z#0-9]+;/gi, ' ')
            .replace(/\$\$[\s\S]*?\$\$/g, ' ')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
        if (!titulo) return '';
        return 'tt:' + titulo + '|' + (pub.year || '');
    },

    // Conjunto de artigos de um CV, para as intersecoes da matriz de coautoria.
    _artigosDoCv: function (cv) {
        const chaves = new Set();
        const pubs = (cv && Array.isArray(cv.publications)) ? cv.publications : [];
        pubs.forEach(p => {
            const k = this._chaveArtigo(p);
            if (k) chaves.add(k);
        });
        return chaves;
    },

    // Matriz de coautoria de um conjunto de curriculos.
    //   cvs      curriculos a considerar (os incluidos no consolidado)
    //   fichas   {name, lattesId, role, formacao} da equipe da proposta, para o filtro;
    //            lista vazia (relatorio de grupo) = ninguem e filtrado
    //   anos     0 = toda a carreira; N = ultimos N anos
    // Devolve { gente: [{nome, artigos}], m: matriz NxN, maior, pares }.
    _matrizCoautoria: function (cvs, fichas, anos, anoAtual) {
        const lista = Array.isArray(cvs) ? cvs : [];
        const fichasArr = Array.isArray(fichas) ? fichas : [];

        // Entram os doutores com curriculo no banco; tecnicos e alunos ficam de fora.
        // Titulacao em branco NAO exclui: ela vem do PDF e nem sempre esta preenchida,
        // e perder um pesquisador em silencio e pior do que listar um a mais.
        const elegivel = (cv) => {
            if (fichasArr.length === 0) return true;
            const f = fichasArr.find(x => this.cvMatches(cv, x.name, x.lattesId));
            if (!f) return true;
            if (/^(t[ée]cnic|aluno|estudante)/i.test(String(f.role || '').trim())) return false;
            const formacao = String(f.formacao || '').trim();
            if (formacao && !/doutor/i.test(formacao)) return false;
            return true;
        };

        // 0 significa sem corte. Difere da Lista de Publicacoes, onde 0 deixa so o ano
        // corrente: numa matriz de colaboracao o util por omissao e a carreira inteira.
        const janela = Number(anos) || 0;
        const corte = janela > 0 ? ((Number(anoAtual) || new Date().getFullYear()) - janela) : null;

        const artigosDe = (cv) => {
            const chaves = new Set();
            const pubs = (cv && Array.isArray(cv.publications)) ? cv.publications : [];
            pubs.forEach(p => {
                if (corte !== null) {
                    const ano = parseInt(p && p.year, 10);
                    if (isNaN(ano) || ano < corte) return;
                }
                const k = this._chaveArtigo(p);
                if (k) chaves.add(k);
            });
            return chaves;
        };

        // O coordenador abre a lista: e a partir dele que se le a rede da equipe.
        // Os demais em ordem alfabetica.
        const gente = lista.filter(elegivel)
            .map(cv => {
                const f = fichasArr.find(x => this.cvMatches(cv, x.name, x.lattesId));
                const coordenador = !!(f && /^(proponente|coordenador)/i.test(String(f.role || '').trim()));
                // a instituicao vem da ficha da equipe; o CV do Lattes nao a traz
                const instituicao = String((f && f.instituicao) || '').trim();
                return {
                    nome: cv.name || '(sem nome)',
                    artigos: artigosDe(cv),
                    coordenador: coordenador,
                    instituicao: instituicao
                };
            })
            .sort((a, b) => {
                if (a.coordenador !== b.coordenador) return a.coordenador ? -1 : 1;
                return a.nome.localeCompare(b.nome, 'pt-BR');
            });

        const n = gente.length;
        const m = Array.from({ length: n }, () => new Array(n).fill(0));
        let maior = 0, pares = 0;
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                // percorre o menor conjunto: a intersecao custa o tamanho dele
                const a = gente[i].artigos, b = gente[j].artigos;
                const [curto, longo] = a.size <= b.size ? [a, b] : [b, a];
                let comuns = 0;
                curto.forEach(k => { if (longo.has(k)) comuns++; });
                m[i][j] = m[j][i] = comuns;
                if (comuns > 0) { pares++; if (comuns > maior) maior = comuns; }
            }
        }

        // ---- Agrupamento: quem colabora junto fica junto ----
        // Seriacao gulosa. Comeca pelo coordenador (na falta dele, por quem mais
        // colabora) e, a cada passo, puxa quem tem mais artigos em comum com os ja
        // posicionados. Esgotado um grupo conectado, abre o proximo pelo restante de
        // maior colaboracao. Nao e clusterizacao otima — isso exigiria algo como
        // Louvain, fora de proposito aqui —, mas concentra os blocos na diagonal, roda
        // em O(n^2) e e deterministica, que e o que a leitura da matriz pede.
        const somaDe = (i) => m[i].reduce((s, v) => s + v, 0);
        const restantes = new Set(gente.map((_, i) => i));
        const ordem = [];
        const grupo = new Array(n).fill(0);
        let g = 0;

        while (restantes.size > 0) {
            g++;
            // semente do grupo: o coordenador abre o primeiro; depois, o mais colaborativo
            let semente = -1;
            restantes.forEach(i => {
                if (semente === -1) { semente = i; return; }
                if (gente[i].coordenador !== gente[semente].coordenador) {
                    if (gente[i].coordenador) semente = i;
                    return;
                }
                const di = somaDe(i), ds = somaDe(semente);
                if (di > ds || (di === ds && gente[i].nome.localeCompare(gente[semente].nome, 'pt-BR') < 0)) semente = i;
            });
            restantes.delete(semente);
            ordem.push(semente);
            grupo[semente] = g;

            // cresce o grupo enquanto houver quem colabore com ele
            for (;;) {
                let escolhido = -1, peso = 0;
                restantes.forEach(i => {
                    let p = 0;
                    ordem.forEach(j => { if (grupo[j] === g) p += m[i][j]; });
                    if (p > peso) { peso = p; escolhido = i; }
                    else if (p === peso && p > 0 && escolhido >= 0) {
                        // empate no vinculo com o grupo: sobe quem colabora mais no total,
                        // para os centrais ficarem perto do coordenador. Numa equipe em que
                        // todos publicam juntos os empates sao a regra, e sem este criterio
                        // a ordem caia direto no alfabeto e nao dizia nada.
                        const si = somaDe(i), se = somaDe(escolhido);
                        if (si > se || (si === se && gente[i].nome.localeCompare(gente[escolhido].nome, 'pt-BR') < 0)) escolhido = i;
                    }
                });
                if (escolhido === -1 || peso <= 0) break;
                restantes.delete(escolhido);
                ordem.push(escolhido);
                grupo[escolhido] = g;
            }
        }

        // aplica a ordem a lista e a matriz
        const genteOrd = ordem.map((idx, pos) => Object.assign({}, gente[idx], { grupo: grupo[idx], primeiroDoGrupo: pos > 0 && grupo[idx] !== grupo[ordem[pos - 1]] }));
        const mOrd = ordem.map(i => ordem.map(j => m[i][j]));

        return { gente: genteOrd, m: mOrd, maior: maior, pares: pares, grupos: g };
    },

    // Le "Resultado da avaliação" e a justificativa do HTML de uma pagina de parecer.
    //
    // So aceita parecer AD HOC: a pagina de pre-selecao usa exatamente os mesmos ids
    // (listaResultadoContent / listaJustificativaContent), mas com resultado de outra
    // natureza; o titulo da pagina e o que separa as duas. Paginas que nao sao parecer
    // nao tem os blocos e voltam vazias.
    //
    // Mora aqui, e nao em picc_content.js, porque tem dois chamadores: a importacao
    // pela planilha e o proprio relatorio da proposta, que roda em db.html — onde
    // picc_content.js nao e carregado.
    _lerAvaliacaoParecer: function (htmlText) {
        const vazio = { resultado: '', justificativa: '' };
        if (!htmlText || typeof DOMParser === 'undefined') return vazio;

        let doc = null;
        try { doc = new DOMParser().parseFromString(String(htmlText), 'text/html'); } catch (e) { return vazio; }
        if (!doc) return vazio;

        const elTitulo = doc.querySelector('title');
        if (!/parecer\s*ad[\s-]?hoc/i.test(elTitulo ? String(elTitulo.textContent || '') : '')) return vazio;

        const texto = (el) => el
            ? String(el.textContent || '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
            : '';

        return {
            // o resultado e uma linha so; a justificativa preserva os paragrafos
            resultado: texto(doc.getElementById('listaResultadoContent')).replace(/\s+/g, ' '),
            justificativa: texto(doc.getElementById('listaJustificativaContent'))
        };
    },

    // Traduz o "Resultado da avaliação" de um parecer ad hoc para o que a interface
    // precisa: o texto como veio, a sigla e as cores. Parecer sem resultado — porque a
    // pagina nao era ad hoc, ou nao trazia o bloco, ou foi importado antes desta leitura
    // existir — fica neutro, com o mesmo laranja de sempre.
    _avaliacaoParecer: function (rev) {
        const neutro = { resultado: '', sigla: '', cor: '#F57C00', corClara: '#FFF3E0', corBorda: '#FFE082', corTexto: '#E65100' };
        const resultado = (rev && typeof rev === 'object' && rev.resultado) ? String(rev.resultado).trim() : '';
        if (!resultado) return neutro;
        if (/^n[ãa]o/i.test(resultado)) {
            return { resultado: resultado, sigla: 'NR', cor: '#C62828', corClara: '#FFEBEE', corBorda: '#FFCDD2', corTexto: '#B71C1C' };
        }
        if (/^recomendad/i.test(resultado)) {
            return { resultado: resultado, sigla: 'R', cor: '#2E7D32', corClara: '#E8F5E9', corBorda: '#C8E6C9', corTexto: '#1B5E20' };
        }
        return Object.assign({}, neutro, { resultado: resultado });
    },

    // Chave estavel de um bloco recolhivel do relatorio, derivada do proprio titulo
    // ("Limiares e Filtros" -> "limiares-e-filtros"). Assim o estado independe da
    // proposta ou do CV aberto.
    _chaveColapso: function (texto) {
        return String(texto || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    },

    // Chave estavel de uma proposta: o numero do processo. Vazia quando nao ha
    // processId, e quem chama trata isso como "sem correspondencia" em vez de
    // arriscar casar registros diferentes.
    _chaveProposta: function (p) {
        return String((p && p.processId) || '');
    },

    // Lista percorrida pelos botoes Anterior/Proxima do relatorio de proposta.
    // Mantem a ordem da tabela e, havendo selecao por checkbox com mais de um item,
    // restringe a navegacao a ela (so se a proposta aberta estiver na selecao).
    _listaNavegacao: function (db, alvo, selecionados) {
        const lista = Array.isArray(db) ? db : [];
        if (!Array.isArray(selecionados) || selecionados.length < 2) return lista;

        const chaveAlvo = this._chaveProposta(alvo);
        if (!chaveAlvo) return lista;

        const chaves = new Set(selecionados.map(sel => this._chaveProposta(sel)).filter(Boolean));
        if (chaves.size < 2) return lista;

        const subconjunto = lista.filter(p => {
            const k = this._chaveProposta(p);
            return k && chaves.has(k);
        });
        if (subconjunto.length < 2) return lista;
        if (!subconjunto.some(p => this._chaveProposta(p) === chaveAlvo)) return lista;

        subconjunto.jcrSelecao = true;   // sinaliza o rotulo "(seleção)" no relatório
        return subconjunto;
    },

    // Escape a value for use inside a CSS [attr="value"] selector
    _cssAttr: function(str) {
        return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    },

    normalizeName: function (str) {
        if (!str) return '';
        return String(str)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    },

    // True se o CV do banco corresponde ao par (name, lattesId).
    // Quando ambos os lados têm ID Lattes, só o ID decide (evita colisão de homônimos);
    // o nome é usado apenas quando um dos lados não tem ID.
    cvMatches: function (cv, name, lattesId, processId = '') {
        if (!cv) return false;
        if (processId && cv.processId && cv.processId === processId) return true;
        if (lattesId && cv.lattesId && String(cv.lattesId).trim() === String(lattesId).trim()) return true;
        if (name && cv.name) {
            const n1 = this.normalizeName(cv.name);
            const n2 = this.normalizeName(name);
            if (n1 && n2) {
                if (n1 === n2 || n1.includes(n2) || n2.includes(n1)) return true;
                const tokens1 = n1.split(' ').filter(t => t.length > 2);
                const tokens2 = n2.split(' ').filter(t => t.length > 2);
                if (tokens1.length >= 2 && tokens2.length >= 2) {
                    if (tokens1[0] === tokens2[0] && tokens1[tokens1.length - 1] === tokens2[tokens2.length - 1]) return true;
                }
            }
        }
        if (name && cv.processId && String(cv.processId).trim() === String(name).trim()) return true;
        return false;
    },

    // Chave de armazenamento individual do CV (preferindo o ID Lattes).
    // Registros de Processo (piccTools) usam a chave jcr_proc:proc:<processId>
    _cvStorageKey: function (cv) {
        if (!cv) return (this.cvKeyPrefix || 'jcr_cv:') + 'unknown';
        if (cv.isProcesso || cv.processId) {
            const procId = String(cv.processId || cv.lattesId || 'proc');
            return (this.procKeyPrefix || 'jcr_proc:') + 'proc:' + procId;
        }
        return (this.cvKeyPrefix || 'jcr_cv:') + (cv.lattesId ? 'id:' + cv.lattesId : 'nm:' + (cv.name || ''));
    },

    piccCvPrefix: 'jcr_picc_cv:',

    // Chave de armazenamento dedicada aos CVs do piccTools
    _piccCvStorageKey: function (cv) {
        if (!cv) return 'jcr_picc_cv:unknown';
        if (cv.lattesId) return this.piccCvPrefix + 'id:' + String(cv.lattesId).trim();
        const name = (cv.name || '').trim().toLowerCase();
        return this.piccCvPrefix + 'nm:' + name;
    },

    // Retorna todos os CVs salvos no banco dedicado do piccTools
    getPiccCVs: function () {
        return new Promise((resolve) => {
            if (!chrome.runtime?.id) { resolve([]); return; }
            chrome.storage.local.get(null, (allItems) => {
                if (chrome.runtime.lastError || !allItems) { resolve([]); return; }
                const list = [];
                Object.keys(allItems).forEach(k => {
                    if (k.startsWith(this.piccCvPrefix || 'jcr_picc_cv:')) {
                        list.push(allItems[k]);
                    }
                });
                resolve(list);
            });
        });
    },

    // Retorna true se o registro de CV possui dados completos analisados (publicações, orientações, estatísticas, etc.)
    // Retorna false se for apenas um registro básico/esqueleto criado ao importar a proposta
    isFullCv: function (cv) {
        if (!cv) return false;
        if (cv.hasFullCv === true) return true;
        if (cv.hasFullCv === false) return false;

        // Avaliação de fallback para registros existentes criados antes da flag hasFullCv:
        if (Array.isArray(cv.publications) && cv.publications.length > 0) return true;
        if (Array.isArray(cv.rawPatents) && cv.rawPatents.length > 0) return true;
        if (Array.isArray(cv.rawEvents) && cv.rawEvents.length > 0) return true;
        if ((cv.totalPapers || 0) > 0 || (cv.papersWithJcr || 0) > 0) return true;
        if ((cv.wosHIndex || 0) > 0 || (cv.wosCitations || 0) > 0) return true;
        if (cv.supervisions && (
            (cv.supervisions.phdCount || 0) > 0 ||
            (cv.supervisions.mscCount || 0) > 0 ||
            (Array.isArray(cv.supervisions.phdCompleted) && cv.supervisions.phdCompleted.length > 0) ||
            (Array.isArray(cv.supervisions.mscCompleted) && cv.supervisions.mscCompleted.length > 0)
        )) return true;
        if ((cv.totalPhdOrientations || 0) > 0 || (cv.totalMscOrientations || 0) > 0) return true;
        if (cv.dateAdded && (cv.publications !== undefined || cv.totalPapers !== undefined)) return true;

        return false;
    },

    // Salva ou atualiza um CV no banco dedicado do piccTools
    savePiccCV: function (cvData) {
        return new Promise((resolve, reject) => {
            if (!chrome.runtime?.id) { resolve(); return; }
            if (!cvData) { resolve(); return; }
            if (this.isFullCv(cvData)) {
                cvData.hasFullCv = true;
            }
            const key = this._piccCvStorageKey(cvData);
            chrome.storage.local.set({ [key]: cvData }, () => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve();
            });
        });
    },

    // ---------------------------------------------------------------------------
    // Conteúdos pesados das Propostas (PDF em base64, HTML do CV congelado, HTMLs de
    // pareceres, anexos em base64) ficam FORA do registro da proposta, em chave própria
    // jcr_proc_blob:<processId>. Motivo: getDB() faz chrome.storage.local.get(null) e
    // desserializa tudo; com megabytes de base64 embutidos no registro, toda listagem
    // pagava esse custo. O visualizador carrega esses conteúdos sob demanda.
    // ---------------------------------------------------------------------------
    procBlobPrefix: 'jcr_proc_blob:',

    _procBlobKey: function (processId) {
        return (this.procBlobPrefix || 'jcr_proc_blob:') + String(processId || 'proc');
    },

    getProcBlobs: function (processId) {
        return new Promise((resolve) => {
            if (!chrome.runtime?.id || !processId) { resolve({}); return; }
            const key = this._procBlobKey(processId);
            chrome.storage.local.get(key, (result) => {
                if (chrome.runtime.lastError || !result) { resolve({}); return; }
                resolve(result[key] || {});
            });
        });
    },

    // Mescla com o que já existe (não perde conteúdos salvos em execuções anteriores)
    saveProcBlobs: async function (processId, blobs) {
        if (!chrome.runtime?.id || !processId || !blobs || Object.keys(blobs).length === 0) return;
        const key = this._procBlobKey(processId);
        const existing = await this.getProcBlobs(processId);
        const merged = Object.assign({}, existing, blobs);
        await new Promise((resolve, reject) => {
            chrome.storage.local.set({ [key]: merged }, () => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve();
            });
        });
    },

    // Prefixo da chamada usado no caminho dos PDFs em anexosform.cnpq.br/doc/<prefixo>/.
    // Guardado por chamada (a chave e o valor da coluna "Chamada" da planilha, compactado),
    // porque cada edital tem o seu. Vai junto no backup: quem leva a base para outra
    // maquina nao precisa redescobrir o prefixo.
    piccChamadasKey: 'jcr_picc_chamadas',

    _chaveChamada: function (valorColuna) {
        const c = String(valorColuna || '').replace(/\s+/g, '').toLowerCase();
        return c || '(sem coluna)';
    },

    getPiccChamadas: function () {
        return new Promise((resolve) => {
            if (!chrome.runtime?.id) { resolve({}); return; }
            chrome.storage.local.get(this.piccChamadasKey, (r) => {
                if (chrome.runtime.lastError || !r) { resolve({}); return; }
                const v = r[this.piccChamadasKey];
                resolve((v && typeof v === 'object') ? v : {});
            });
        });
    },

    savePiccChamadas: async function (mapa) {
        if (!chrome.runtime?.id || !mapa || typeof mapa !== 'object') return;
        await new Promise((resolve) => {
            chrome.storage.local.set({ [this.piccChamadasKey]: mapa }, () => resolve());
        });
    },

    // Grava o prefixo de uma chamada, preservando os demais
    setPiccChamada: async function (valorColuna, prefixo) {
        const mapa = await this.getPiccChamadas();
        mapa[this._chaveChamada(valorColuna)] = String(prefixo || '');
        await this.savePiccChamadas(mapa);
        return mapa;
    },

    // ---------------------------------------------------------------------------
    // Leitura da pasta piccData sincronizada (OneDrive e afins).
    //
    // Uma extensao nao consegue ler arquivos por caminho: fetch('file://') e bloqueado e
    // chrome.downloads.open so alcanca downloads DESTE perfil — numa segunda maquina os
    // arquivos chegaram pela sincronizacao e nao estao no historico. O unico caminho e a
    // File System Access API: o usuario aponta a pasta uma vez e guardamos a referencia.
    //
    // O handle nao cabe em chrome.storage (nao e serializavel em JSON), entao vai para o
    // IndexedDB, que preserva o tipo. A permissao precisa ser reconfirmada a cada sessao,
    // sempre a partir de um clique — por isso a leitura acontece nos handlers de botao.
    // ---------------------------------------------------------------------------
    pastaIdbNome: 'jcr_picc_fs',
    pastaIdbStore: 'handles',
    pastaIdbChave: 'piccData',

    _abrirIdb: function () {
        return new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB indisponível')); return; }
            const req = indexedDB.open(this.pastaIdbNome, 1);
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(this.pastaIdbStore)) {
                    req.result.createObjectStore(this.pastaIdbStore);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('falha ao abrir o IndexedDB'));
        });
    },

    _idbHandle: function (valor) {
        // sem argumento: le. Com argumento: grava (null apaga).
        const lendo = arguments.length === 0;
        return this._abrirIdb().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(this.pastaIdbStore, lendo ? 'readonly' : 'readwrite');
            const store = tx.objectStore(this.pastaIdbStore);
            const req = lendo ? store.get(this.pastaIdbChave)
                      : (valor === null ? store.delete(this.pastaIdbChave) : store.put(valor, this.pastaIdbChave));
            req.onsuccess = () => resolve(lendo ? req.result : true);
            req.onerror = () => reject(req.error);
        })).catch(() => (lendo ? null : false));
    },

    pastaLocalDisponivel: function () {
        return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
    },

    // Pede ao usuario que aponte a pasta piccData. Precisa vir de um clique.
    escolherPastaLocal: async function () {
        if (!this.pastaLocalDisponivel()) return null;
        try {
            const handle = await window.showDirectoryPicker({ id: 'piccData', mode: 'read' });
            await this._idbHandle(handle);
            return handle;
        } catch (e) {
            if (e && e.name !== 'AbortError') console.warn('[dbTools] Falha ao escolher a pasta:', e);
            return null;
        }
    },

    esquecerPastaLocal: async function () {
        await this._idbHandle(null);
    },

    // Devolve o handle guardado se a permissao ainda valer. Com pedir=true tenta
    // reobter a permissao (so funciona dentro de um clique).
    pastaLocalHandle: async function (pedir = false) {
        const handle = await this._idbHandle();
        if (!handle || typeof handle.queryPermission !== 'function') return null;
        try {
            if (await handle.queryPermission({ mode: 'read' }) === 'granted') return handle;
            if (!pedir) return null;
            if (await handle.requestPermission({ mode: 'read' }) === 'granted') return handle;
        } catch (e) {
            console.warn('[dbTools] Permissão da pasta local indisponível:', e);
        }
        return null;
    },

    // Procura <sub>/<arquivo> dentro do handle, tolerando o nivel que o usuario escolheu:
    // a propria piccData, a pasta que a contem, ou ja a pasta da proposta.
    _acharArquivoNaPasta: async function (raiz, subpasta, arquivo) {
        const tentativas = [[subpasta], ['piccData', subpasta], []];
        for (const caminho of tentativas) {
            try {
                let dir = raiz;
                for (const parte of caminho) dir = await dir.getDirectoryHandle(parte);
                const fh = await dir.getFileHandle(arquivo);
                return await fh.getFile();
            } catch (e) { /* proximo caminho */ }
        }
        return null;
    },

    // Lê um arquivo da proposta na pasta sincronizada. Devolve o File ou null.
    lerArquivoDaProposta: async function (proc, arquivo, pedirPermissao = false) {
        if (!proc || !arquivo || !this.pastaLocalDisponivel()) return null;
        const raiz = await this.pastaLocalHandle(pedirPermissao);
        if (!raiz) return null;
        const subpasta = String(this._projectFolderPath(proc) || '').replace(/^piccData\//, '');
        if (!subpasta) return null;
        try {
            return await this._acharArquivoNaPasta(raiz, subpasta, arquivo);
        } catch (e) {
            console.warn('[dbTools] Falha ao ler da pasta local:', e);
            return null;
        }
    },

    // Caminho da pasta da proposta nos Downloads (mesma regra usada pelo piccTools)
    // Nome da pasta da proposta nos Downloads:
    //   piccData/<proponente> - <processo>
    // A faixa foi retirada do nome: a extracao dela do PDF nem sempre e confiavel, e um
    // valor errado (ou ausente) mudaria a pasta da proposta.
    // Implementacao unica: piccTools e as mensagens do relatorio usam esta funcao.
    //
    // O nome e reduzido a ASCII (sem acentos nem pontuacao). Acentos podem ser gravados
    // em formas Unicode diferentes (NFC/NFD) por quem cria e por quem le o caminho, e
    // duas cadeias visualmente iguais deixam de casar — foi o que impedia de localizar a
    // pasta pelo historico de downloads.
    _nomeSeguro: function (v, barraViraHifen) {
        let t = String(v || '');
        if (barraViraHifen) t = t.replace(/[\/\\]/g, '-');
        return t
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // remove acentos
            .replace(/[^A-Za-z0-9 _-]/g, '')                        // remove pontuacao
            .replace(/\s+/g, ' ')
            .trim();
    },

    _projectFolderPath: function (proc) {
        if (!proc) return 'piccData/processo';

        const processId = this._nomeSeguro(proc.processId || '', true);
        const propName = this._nomeSeguro((proc.proponente && proc.proponente.name) ? proc.proponente.name : (proc.name || ''));

        const partes = [];
        if (propName) partes.push(propName);
        if (processId) partes.push(processId);

        return `piccData/${partes.join(' - ') || 'processo'}`;
    },

    // Chave do CV de um pesquisador dentro dos blobs da proposta
    _memberCvBlobKey: function (lattesId, name) {
        const id = String(lattesId || '').trim();
        if (id) return 'memberCv_id:' + id;
        return 'memberCv_nm:' + String(name || '').trim().toLowerCase();
    },

    // Localiza as propostas em que o pesquisador aparece (proponente ou equipe)
    findProposalsForResearcher: async function (lattesId, name) {
        const id = String(lattesId || '').trim();
        const nm = String(name || '').trim().toLowerCase();
        if (!id && !nm) return [];
        const procs = await this.getDB(true);
        return procs.filter(proc => {
            const people = [];
            if (proc.proponente) people.push(proc.proponente);
            if (Array.isArray(proc.teamMembers)) people.push(...proc.teamMembers);
            return people.some(p => p && (
                (id && p.lattesId && String(p.lattesId).trim() === id) ||
                (nm && p.name && String(p.name).trim().toLowerCase() === nm)
            ));
        });
    },

    // Salva o CV Lattes aberto na pasta de cada proposta em que o pesquisador participa
    // e guarda uma cópia nos blobs da proposta para a leitura em modo local.
    saveCvToMatchingProposals: async function (lattesId, name, htmlText) {
        const resultado = { propostas: [], erro: null };
        if (!htmlText || (!lattesId && !name)) return resultado;
        try {
            const alvos = await this.findProposalsForResearcher(lattesId, name);
            if (alvos.length === 0) return resultado;

            const safeId = String(lattesId || name || 'cv').replace(/[\/\?%*:|"<>\s]/g, '_');
            const blobKey = this._memberCvBlobKey(lattesId, name);

            for (const proc of alvos) {
                const filename = `${this._projectFolderPath(proc)}/curriculo_lattes_${safeId}.html`;
                try {
                    chrome.runtime.sendMessage({ action: 'download_data', data: htmlText, filename }, () => {
                        if (chrome.runtime.lastError) {
                            console.warn('[JCRLattes] Falha ao salvar CV na pasta da proposta:', chrome.runtime.lastError.message);
                        }
                    });
                } catch (e) {
                    console.warn('[JCRLattes] Falha ao solicitar download do CV:', e);
                }
                await this.saveProcBlobs(proc.processId, { [blobKey]: htmlText });
                resultado.propostas.push(proc.processId);
            }
        } catch (e) {
            resultado.erro = e.message;
            console.warn('[JCRLattes] Erro ao salvar CV nas propostas:', e);
        }
        return resultado;
    },

    // Salva vários CVs do piccTools em UMA única escrita no storage.
    // Usado pelo fluxo em lote do picc, que antes gravava um a um.
    savePiccCVs: function (cvArray) {
        return new Promise((resolve, reject) => {
            if (!chrome.runtime?.id) { resolve(); return; }
            if (!Array.isArray(cvArray) || cvArray.length === 0) { resolve(); return; }
            const toSet = {};
            cvArray.forEach(cv => {
                if (!cv || !cv.name) return;
                if (this.isFullCv(cv)) cv.hasFullCv = true;
                toSet[this._piccCvStorageKey(cv)] = cv;
            });
            if (Object.keys(toSet).length === 0) { resolve(); return; }
            chrome.storage.local.set(toSet, () => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve();
            });
        });
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
        { key: 'prioridade', label: 'Prioridade', title: 'Prioridade da Proposta (-, 0, 1, 2, 3, 4)', numeric: true },
        { key: 'faixa', label: 'Faixa', title: 'Faixa da Proposta (ex: A, B, C)', numeric: true },
        { key: 'fellowshipString', label: 'Bolsa', title: 'Bolsa e Nível' },
        { key: 'instituicaoExecutora', label: 'Executora/Sede', title: 'Instituição Executora/Sede da proposta (extraída do PDF)' },
        { key: 'teamCount', label: 'Equipe', title: 'Nº de participantes da proposta (proponente + equipe extraída do PDF)', numeric: true },
        { key: 'reviewCount', label: 'Pareceres', title: 'Nº de pareceres ad hoc recebidos pela proposta', numeric: true },
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
                const db = await this.getDB(false);
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
                        this.exportIncludeHtml = result[this.settingsKey].exportIncludeHtml !== false;
                        const salvos = result[this.settingsKey].reportCollapsed;
                        this.reportCollapsed = (salvos && typeof salvos === 'object') ? { ...salvos } : {};
                        // Migracao: antes so o bloco de filtros era lembrado, num booleano proprio
                        if (!salvos && this.reportFiltersCollapsed) {
                            this.reportCollapsed[this._chaveColapso('Limiares e Filtros')] = true;
                        }
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
                    reportCollapsed: this.reportCollapsed || {},
                    exportIncludeHtml: this.exportIncludeHtml !== false,
                    dbPrintOrientation: this.dbPrintOrientation
                }
            });
        } catch (e) { /* extension context invalidated */ }
    },

    getDB: async function (isProcessoOnly = false) {
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

        const cvPrefix = this.cvKeyPrefix || 'jcr_cv:';
        const procPrefix = this.procKeyPrefix || 'jcr_proc:';

        const db = Object.keys(items)
            .filter(k => {
                if (isProcessoOnly) {
                    return k.startsWith(procPrefix) || k.startsWith(cvPrefix + 'proc:');
                }
                return k.startsWith(cvPrefix) && !k.startsWith(cvPrefix + 'proc:');
            })
            .map(k => items[k])
            .filter(cv => {
                if (!cv) return false;
                const isProc = !!(cv.isProcesso || cv.processId);
                return isProcessoOnly ? isProc : !isProc;
            });

        // Migração: formato antigo (array único em dbKey) → uma chave por CV.
        const legacy = items[this.dbKey];
        if (Array.isArray(legacy)) {
            for (const cv of legacy) {
                if (!cv || (!cv.name && !cv.processId)) continue;
                const isProc = !!(cv.isProcesso || cv.processId);
                if ((isProcessoOnly && isProc) || (!isProcessoOnly && !isProc)) {
                    if (!db.some(c => this._cvStorageKey(c) === this._cvStorageKey(cv))) db.push(cv);
                }
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

    // Remove registros do storage.
    //
    // Ao excluir uma Proposta (piccTools), remove também os CVs-esqueleto que ela criou no
    // banco dedicado do picc (jcr_picc_cv:) — mas apenas se nenhuma outra proposta ainda
    // referenciar aquela pessoa.
    //
    // IMPORTANTE: nunca remove chaves do banco principal de CVs (jcr_cv:). Esses registros
    // podem ter sido analisados no Lattes pelo usuário (publicações, orientações,
    // estatísticas) e não pertencem à proposta. Havia aqui uma segunda implementação de
    // removeCVs que fazia exatamente isso; ela era código morto (a chave duplicada no
    // objeto fazia a versão simples vencer) e foi removida.
    removeCVs: async function (cvArray) {
        if (!chrome.runtime?.id) throw new Error('Extension context invalidated');
        if (!Array.isArray(cvArray) || cvArray.length === 0) return;

        const keys = new Set();
        const piccCandidates = new Set();

        const peopleOf = (proc) => {
            const people = [];
            if (proc && proc.proponente) people.push(proc.proponente);
            if (proc && Array.isArray(proc.teamMembers)) people.push(...proc.teamMembers);
            return people.filter(p => p && (p.lattesId || p.name));
        };

        cvArray.forEach(cv => {
            if (!cv) return;
            keys.add(this._cvStorageKey(cv));
            if (cv._storageKey) keys.add(cv._storageKey);
            if (cv.isProcesso || cv.processId) {
                peopleOf(cv).forEach(p => piccCandidates.add(this._piccCvStorageKey(p)));
                if (cv.processId) keys.add(this._procBlobKey(cv.processId));
            }
        });

        // Preserva o CV-esqueleto se outra proposta ainda o referencia
        if (piccCandidates.size > 0) {
            try {
                const remaining = (await this.getDB(true)).filter(p => !keys.has(this._cvStorageKey(p)));
                const stillReferenced = new Set();
                remaining.forEach(proc => {
                    peopleOf(proc).forEach(p => stillReferenced.add(this._piccCvStorageKey(p)));
                });
                piccCandidates.forEach(k => { if (!stillReferenced.has(k)) keys.add(k); });
            } catch (e) {
                console.warn('[JCRLattes] removeCVs: falha ao checar referências restantes; CVs do picc preservados.', e);
            }
        }

        const keysArray = Array.from(keys).filter(Boolean);
        if (keysArray.length === 0) return;

        await new Promise((resolve, reject) => {
            chrome.storage.local.remove(keysArray, () => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve();
            });
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

    // Helper que verifica se um pesquisador (nome ou lattesId) pertence a alguma proposta do piccTools
    isPiccProposalMember: async function (name, lattesId = '') {
        const proposals = await this.getDB(true);
        if (!Array.isArray(proposals) || proposals.length === 0) return false;
        
        const normName = this.normalizeName(name);
        const cleanId = String(lattesId || '').trim();

        return proposals.some(proc => {
            if (!proc || (!proc.isProcesso && !proc.processId)) return false;

            // Check proponente
            if (proc.proponente) {
                if (cleanId && proc.proponente.lattesId && String(proc.proponente.lattesId).trim() === cleanId) return true;
                if (normName && proc.proponente.name) {
                    const normProp = this.normalizeName(proc.proponente.name);
                    if (normProp && (normProp === normName || normProp.includes(normName) || normName.includes(normProp))) return true;
                }
            }

            // Check team members
            if (Array.isArray(proc.teamMembers)) {
                return proc.teamMembers.some(tm => {
                    if (!tm) return false;
                    if (cleanId && tm.lattesId && String(tm.lattesId).trim() === cleanId) return true;
                    if (normName && tm.name) {
                        const normTm = this.normalizeName(tm.name);
                        return normTm && (normTm === normName || normTm.includes(normName) || normName.includes(normTm));
                    }
                    return false;
                });
            }

            return false;
        });
    },

    saveCurrentCV: async function (silent = false) {
        // Ensure we have the latest data before saving
        if (this.lastArgs) {
            this.extractData(this.lastArgs.nameLink, this.lastArgs.stats, this.lastArgs.lattesInfo, this.lastArgs.ridStats);
        }

        if (!this.currentCvData || !this.currentCvData.name) return;

        // Se o pesquisador pertence a alguma proposta do piccTools, salva EXCLUSIVAMENTE no banco dedicado (jcr_picc_cv:)
        const isPicc = await this.isPiccProposalMember(this.currentCvData.name, this.currentCvData.lattesId);
        this.currentCvData.hasFullCv = true;

        if (isPicc) {
            await this.savePiccCV(this.currentCvData);
            // Remove do banco de CVs geral se porventura existia lá anteriormente para evitar duplicação
            await this.removeCVs([this.currentCvData]);
            if (!silent) this.showToast('CV do piccTools Salvo na Base Dedicada!');
            return;
        }

        const db = await this.getDB(false);
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
        // Grava só este CV no banco de CVs geral (chave própria)
        await this.upsertCV(this.currentCvData, existing);
        if (!silent) this.showToast('CV Salvo no Banco de Dados!');
    },

    showAlert: function (msg, targetTab = null) {
        if (targetTab && !targetTab.closed && typeof targetTab.alert === 'function') {
            targetTab.alert(msg);
        } else if (typeof window !== 'undefined' && typeof window.alert === 'function') {
            window.alert(msg);
        }
    },

    showConfirm: function (msg, targetTab = null) {
        if (targetTab && !targetTab.closed && typeof targetTab.confirm === 'function') {
            return targetTab.confirm(msg);
        } else if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
            return window.confirm(msg);
        }
        return false;
    },

    // Dialogo do backup de propostas: explicacao + caixa para incluir os documentos em
    // HTML + OK. Um confirm() nativo nao aceita caixa de selecao, entao e montado no
    // documento da aba (sem handler inline: a CSP da pagina da extensao bloqueia).
    // Resolve { ok, comHtml }; o valor da caixa fica guardado nas configuracoes.
    // Lista dos numeros de processo pronta para colar no campo "Processos" da barra do
    // piccTools, na planilha de julgamento. Aquele campo aceita espaco, virgula ou ponto
    // e virgula como separador; usamos espaco, que e o que o placeholder dele pede.
    // `origem` so descreve de onde veio a lista (selecao ou tabela inteira).
    mostrarListaProcessos: function (targetTab, processos, origem) {
        const alvo = (targetTab && !targetTab.closed && targetTab.document) ? targetTab
                   : ((typeof window !== 'undefined' && window.document) ? window : null);
        const doc = alvo && alvo.document;
        if (!doc || !doc.body) return;

        const lista = (Array.isArray(processos) ? processos : []).join(' ');

        const fundo = doc.createElement('div');
        fundo.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 10000; display: flex; align-items: center; justify-content: center;';

        const cartao = doc.createElement('div');
        cartao.style.cssText = 'background: #fff; border-radius: 8px; padding: 22px; width: min(620px, 92vw); box-shadow: 0 8px 30px rgba(0,0,0,0.35); font-family: \'Segoe UI\', Tahoma, Geneva, Verdana, sans-serif; color: #333;';

        const titulo = doc.createElement('h3');
        titulo.textContent = '\u{1F4CB} Processos para extração';
        titulo.style.cssText = 'margin: 0 0 10px 0; color: #1565C0;';

        const texto = doc.createElement('p');
        texto.style.cssText = 'margin: 0 0 14px 0; font-size: 0.9em; line-height: 1.5; color: #555;';
        texto.innerHTML = 'Cole no campo <strong>Processos</strong> da barra do piccTools, na planilha de julgamento, '
            + 'e extraia somente estas propostas.<br><span style="color:#777;">'
            + processos.length + ' processo(s) — ' + origem + '.</span>';

        const area = doc.createElement('textarea');
        area.readOnly = true;
        area.value = lista;
        area.style.cssText = 'width: 100%; height: 110px; padding: 10px; border: 1px solid #90CAF9; border-radius: 6px; font-family: Consolas, monospace; font-size: 13px; resize: vertical; box-sizing: border-box; background: #F5F9FF; color: #333; line-height: 1.5;';

        const barra = doc.createElement('div');
        barra.style.cssText = 'display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 16px;';

        const aviso = doc.createElement('span');
        aviso.style.cssText = 'font-size: 0.85em; font-weight: bold; color: #2E7D32; visibility: hidden;';
        aviso.textContent = '✓ Copiado';

        const acoes = doc.createElement('div');
        acoes.style.cssText = 'display: flex; gap: 10px;';

        const btnCopiar = doc.createElement('button');
        btnCopiar.textContent = '\u{1F4CB} Copiar';
        btnCopiar.style.cssText = 'padding: 8px 16px; background: #1565C0; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';

        const btnFechar = doc.createElement('button');
        btnFechar.textContent = 'Fechar';
        btnFechar.style.cssText = 'padding: 8px 16px; background: #ECEFF1; color: #37474F; border: 1px solid #CFD8DC; border-radius: 4px; cursor: pointer; font-weight: bold;';

        const fechar = () => { if (fundo.parentNode) fundo.parentNode.removeChild(fundo); };

        btnCopiar.addEventListener('click', async () => {
            let copiou = false;
            try {
                if (alvo.navigator && alvo.navigator.clipboard) {
                    await alvo.navigator.clipboard.writeText(lista);
                    copiou = true;
                }
            } catch (e) { /* sem permissao de clipboard: cai no execCommand */ }
            if (!copiou) {
                // Fallback para quando a aba nao tem acesso a API de clipboard
                area.select();
                try { copiou = doc.execCommand('copy'); } catch (e) { copiou = false; }
            }
            aviso.textContent = copiou ? '✓ Copiado' : 'Copie com Ctrl+C (texto já selecionado)';
            aviso.style.color = copiou ? '#2E7D32' : '#E65100';
            aviso.style.visibility = 'visible';
            if (!copiou) area.select();
        });

        btnFechar.addEventListener('click', fechar);
        fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
        doc.addEventListener('keydown', function esc(e) {
            if (e.key === 'Escape') { fechar(); doc.removeEventListener('keydown', esc); }
        });

        acoes.appendChild(btnCopiar);
        acoes.appendChild(btnFechar);
        barra.appendChild(aviso);
        barra.appendChild(acoes);
        cartao.appendChild(titulo);
        cartao.appendChild(texto);
        cartao.appendChild(area);
        cartao.appendChild(barra);
        fundo.appendChild(cartao);
        doc.body.appendChild(fundo);

        area.focus();
        area.select();
    },

    perguntarOpcoesBackup: function (targetTab = null) {
        return new Promise((resolve) => {
            const alvo = (targetTab && !targetTab.closed && targetTab.document) ? targetTab
                       : ((typeof window !== 'undefined' && window.document) ? window : null);
            const doc = alvo && alvo.document;
            const marcadoInicial = this.exportIncludeHtml !== false;
            if (!doc || !doc.body) { resolve({ ok: true, comHtml: marcadoInicial }); return; }

            const fundo = doc.createElement('div');
            fundo.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 10000; display: flex; align-items: center; justify-content: center;';

            const cartao = doc.createElement('div');
            cartao.style.cssText = 'background: #fff; border-radius: 8px; padding: 22px; width: min(520px, 92vw); box-shadow: 0 8px 30px rgba(0,0,0,0.35); font-family: \'Segoe UI\', Tahoma, Geneva, Verdana, sans-serif; color: #333;';

            const titulo = doc.createElement('h3');
            titulo.textContent = '\u{1F4BE} Backup das propostas';
            titulo.style.cssText = 'margin: 0 0 10px 0; color: #1565C0;';

            const texto = doc.createElement('p');
            texto.style.cssText = 'margin: 0 0 16px 0; font-size: 0.9em; line-height: 1.5; color: #555;';
            texto.textContent = 'O backup sempre leva os dados das propostas. Os documentos em HTML '
                + '(pareceres ad hoc, CV congelado e CVs da equipe) sao opcionais: incluir deixa o '
                + 'arquivo autossuficiente, mas bem maior. Se voce sincroniza a pasta piccData, pode '
                + 'deixar de fora e apontar a pasta no relatorio da proposta (botao \u{1F4C1}).';

            const rotulo = doc.createElement('label');
            rotulo.style.cssText = 'display: flex; align-items: flex-start; gap: 10px; cursor: pointer; background: #F5F7FA; border: 1px solid #CFD8DC; border-radius: 6px; padding: 12px; font-size: 0.92em;';

            const caixa = doc.createElement('input');
            caixa.type = 'checkbox';
            caixa.checked = marcadoInicial;
            caixa.style.cssText = 'width: 16px; height: 16px; margin-top: 2px; cursor: pointer; accent-color: #1565C0;';

            const textoCaixa = doc.createElement('span');
            textoCaixa.innerHTML = '<strong>Incluir os documentos em HTML</strong>'
                + '<br><span style="color:#777; font-size:0.9em;">Pareceres ad hoc, CV congelado e CVs da equipe.</span>';

            rotulo.appendChild(caixa);
            rotulo.appendChild(textoCaixa);

            const barra = doc.createElement('div');
            barra.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;';

            const btnCancelar = doc.createElement('button');
            btnCancelar.textContent = 'Cancelar';
            btnCancelar.style.cssText = 'padding: 8px 16px; border: 1px solid #B0BEC5; background: #fff; border-radius: 4px; cursor: pointer; font-weight: bold;';

            const btnOk = doc.createElement('button');
            btnOk.textContent = 'OK';
            btnOk.style.cssText = 'padding: 8px 22px; border: none; background: #1565C0; color: #fff; border-radius: 4px; cursor: pointer; font-weight: bold;';

            barra.appendChild(btnCancelar);
            barra.appendChild(btnOk);
            cartao.appendChild(titulo);
            cartao.appendChild(texto);
            cartao.appendChild(rotulo);
            cartao.appendChild(barra);
            fundo.appendChild(cartao);
            doc.body.appendChild(fundo);

            let encerrado = false;
            const fechar = (ok) => {
                if (encerrado) return;
                encerrado = true;
                const comHtml = caixa.checked;
                if (fundo.parentNode) fundo.parentNode.removeChild(fundo);
                if (ok) {
                    this.exportIncludeHtml = comHtml;
                    this.saveSettings();
                }
                resolve({ ok, comHtml });
            };

            btnOk.addEventListener('click', () => fechar(true));
            btnCancelar.addEventListener('click', () => fechar(false));
            fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(false); });
            fundo.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') fechar(false);
                else if (e.key === 'Enter') fechar(true);
            });
            btnOk.focus();
        });
    },

    showPrompt: function (msg, defaultVal = '', targetTab = null) {
        if (targetTab && !targetTab.closed && typeof targetTab.prompt === 'function') {
            return targetTab.prompt(msg, defaultVal);
        } else if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
            return window.prompt(msg, defaultVal);
        }
        return null;
    },

    // Abre o relatório individual do CV atualmente exibido na página do Lattes
    viewCurrentReport: function () {
        if (this.lastArgs) {
            this.extractData(this.lastArgs.nameLink, this.lastArgs.stats, this.lastArgs.lattesInfo, this.lastArgs.ridStats);
        }
        if (!this.currentCvData) {
            this.showAlert('Os dados do CV ainda estão sendo carregados. Tente novamente em instantes.');
            return;
        }
        const newTab = window.open('', '_blank');
        if (!newTab) {
            this.showAlert('Por favor, permita pop-ups para abrir o relatório.');
            return;
        }
        this.renderCVReport(this.currentCvData, newTab);
    },

    deleteSingleCV: async function (name, lattesId = '', isProcessoOnly = false) {
        const db = await this.getDB(isProcessoOnly);
        const existing = db.find(cv => this.cvMatches(cv, name, lattesId));
        if (existing) {
            await this.removeCVs([existing]);
        }
    },

    clearDB: async function (silent = false, isProcessoOnly = false, targetTab = null) {
        const confirmMsg = isProcessoOnly 
            ? "Tem certeza que deseja apagar TODAS as Propostas e CVs salvos do piccTools?" 
            : "Tem certeza que deseja apagar todos os CVs e Propostas salvas?";
        if (silent || this.showConfirm(confirmMsg, targetTab)) {
            const allItems = await new Promise(res => chrome.storage.local.get(null, res)) || {};
            const cvPrefix = this.cvKeyPrefix || 'jcr_cv:';
            const procPrefix = this.procKeyPrefix || 'jcr_proc:';
            const piccCvPrefix = this.piccCvPrefix || 'jcr_picc_cv:';
            const keysToRemove = new Set();

            Object.keys(allItems).forEach(k => {
                const val = allItems[k];
                const isProcKey = k.startsWith(procPrefix) || k.startsWith(cvPrefix + 'proc:');
                const isPiccCvKey = k.startsWith(piccCvPrefix);
                const isCvKey = k.startsWith(cvPrefix);

                if (isProcessoOnly) {
                    if (isProcKey || isPiccCvKey) {
                        keysToRemove.add(k);
                    } else if (val && typeof val === 'object') {
                        if (val.isProcesso || val.processId) keysToRemove.add(k);
                    }
                } else {
                    if (isProcKey || isPiccCvKey || isCvKey) {
                        keysToRemove.add(k);
                    } else if (val && typeof val === 'object') {
                        if (val.isProcesso || val.processId || val.lattesId || val.publications) keysToRemove.add(k);
                    }
                }
            });

            // A chave legada jcr_cv_database e do banco de CVs: propostas nunca foram
            // gravadas nela, entao limpar as propostas nao mexe nesse array.
            if (!isProcessoOnly && allItems[this.dbKey] && Array.isArray(allItems[this.dbKey])) {
                keysToRemove.add(this.dbKey);
            }

            const keysArray = Array.from(keysToRemove);
            if (keysArray.length > 0) {
                await new Promise(res => chrome.storage.local.remove(keysArray, res));
            }

            if (!silent) this.showToast(isProcessoOnly ? 'Banco de Propostas e CVs do piccTools limpo com sucesso!' : 'Banco de Dados de CVs e Propostas limpo com sucesso!');
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

    isCaMemberAuthValid: function () {
        return new Promise((resolve) => {
            if (typeof chrome === 'undefined' || !chrome.storage?.local) { resolve(false); return; }
            chrome.storage.local.get(['jcr_ca_member_auth'], (result) => {
                if (chrome.runtime?.lastError || !result || !result['jcr_ca_member_auth']) {
                    resolve(false);
                    return;
                }
                const auth = result['jcr_ca_member_auth'];
                if (auth && auth.isCaMember === true && auth.validUntil && Date.now() < auth.validUntil) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
        });
    },

    viewDB: async function (existingTab = null, options = null) {
        if (options !== null && options !== undefined) {
            if (typeof options === 'boolean') {
                options = { processOnly: options };
            }
            this._activeDbOptions = options;
        } else {
            options = this._activeDbOptions || {};
        }

        const isProcessoOnly = !!(options.processOnly || options.isProcesso);

        if (isProcessoOnly) {
            const isCaValid = await this.isCaMemberAuthValid();
            if (!isCaValid) {
                if (existingTab && !existingTab.closed && typeof existingTab.close === 'function') {
                    try { existingTab.close(); } catch (e) {}
                }
                return;
            }
        }

        // Fora da página da extensão (ou seja, chamado de um content script), abre a página
        // dedicada db.html em vez de um about:blank. Um about:blank aberto por content script
        // herda a origem do CNPq, que tem zoom próprio no Chrome — daí a tabela aparecer com
        // tamanho diferente conforme o caminho de abertura. Com origem única (chrome-extension://)
        // todas as aberturas ficam idênticas e há um só caminho de renderização.
        const isExtensionPage = typeof location !== 'undefined' && location.protocol === 'chrome-extension:';
        if (!existingTab && !isExtensionPage) {
            try {
                chrome.runtime.sendMessage({
                    action: 'open_db_page',
                    view: isProcessoOnly ? 'propostas' : 'cvs'
                }, (res) => {
                    const err = chrome.runtime.lastError ? chrome.runtime.lastError.message
                              : (res && res.success === false ? res.error : null);
                    if (err) {
                        console.warn('[JCRLattes] Não foi possível abrir a página do banco:', err);
                        this.showToast('Não foi possível abrir o banco de dados.', '#c62828');
                    }
                });
            } catch (e) {
                console.warn('[JCRLattes] Não foi possível abrir a página do banco:', e);
            }
            return;
        }

        let db = await this.getDB(isProcessoOnly);
        const piccCvRecords = isProcessoOnly ? await this.getPiccCVs() : [];
        const generalCvRecords = isProcessoOnly ? await this.getDB(false) : [];
        const allCvRecords = isProcessoOnly ? [...piccCvRecords, ...generalCvRecords] : [];

        // Sort data based on current configuration
        db.sort((a, b) => {
            let valA = this._valorColuna(a, this.sortConfig.key);
            let valB = this._valorColuna(b, this.sortConfig.key);
            
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

        // Filtro por faixa (so na tabela de propostas). As opcoes saem da lista completa,
        // para que qualquer faixa continue selecionavel depois de filtrar; daqui em diante
        // `db` e a lista visivel — selecao, exclusao e navegacao seguem o que esta na tela.
        const totalSemFiltro = db.length;
        let faixasDisponiveis = [];
        if (isProcessoOnly) {
            const contagem = new Map();
            db.forEach(cv => { const f = this._faixaDe(cv); contagem.set(f, (contagem.get(f) || 0) + 1); });
            faixasDisponiveis = Array.from(contagem.entries())
                .sort((a, b) => (a[0] === '-') - (b[0] === '-') || a[0].localeCompare(b[0], undefined, { numeric: true }));
            if (this.faixaFilter && !contagem.has(this.faixaFilter)) this.faixaFilter = '';   // faixa sumiu do banco
            if (this.faixaFilter) db = db.filter(cv => this._faixaDe(cv) === this.faixaFilter);
        } else {
            this.faixaFilter = '';
        }

        let newTab = existingTab;
        if (!newTab || newTab.closed) {
            newTab = window.open('', '_blank');
            if (!newTab) {
                alert("Por favor, permita pop-ups para abrir a visualização do banco de dados.");
                return;
            }
        }

        const titleText = isProcessoOnly ? 'piccTools - Banco de Propostas' : 'JCR Lattes - Banco de CVs';
        const headerTitle = isProcessoOnly ? `piccTools - Banco de Propostas (${db.length}${this.faixaFilter ? ' de ' + totalSemFiltro : ''})` : `JCR Lattes - Banco de CVs (${db.length})`;

        // Generate HTML for the table
        let tableHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>${this._esc(titleText)}</title>
                <meta charset="utf-8">
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; background-color: #f5f5f5; color: #333; }
                    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; background: #fff; padding: 15px 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); width: 100%; margin-left: auto; margin-right: auto; box-sizing: border-box; }
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
                    .group-summary { width: 100%; margin-left: auto; margin-right: auto; box-sizing: border-box; }
                    .table-container { background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow-x: auto; width: 100%; margin-left: auto; margin-right: auto; box-sizing: border-box; }
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
                    .bolsa-cell { min-width: 95px; white-space: nowrap; text-align: center; }
                    .executora-cell { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
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
                    <h1>${this._esc(headerTitle)}</h1>
                    <div>
                        ${isProcessoOnly ? '' : `<select id="print-orientation-select" title="Orientação da página na impressão" style="padding: 7px; margin-right: 10px; border-radius: 4px; border: 1px solid #ccc; background: white; cursor: pointer;">
                            <option value="landscape"${this.dbPrintOrientation === 'landscape' ? ' selected' : ''}>🖨️ Paisagem</option>
                            <option value="portrait"${this.dbPrintOrientation === 'portrait' ? ' selected' : ''}>🖨️ Retrato</option>
                        </select>`}
                        <button id="refreshBtn" class="btn btn-refresh">🔄 Atualizar Lista</button>
                        ${isProcessoOnly ? '' : `<button id="exportBtn" class="btn btn-export">📊 Exportar (CSV)</button>`}
                        <button id="exportJsonBtn" class="btn btn-export" style="background-color: #f39c12;">📥 Backup (JSON)</button>
                        <button id="importJsonBtn" class="btn btn-export" style="background-color: #8e44ad;">📤 Restaurar (JSON)</button>
                        <input type="file" id="importJsonInput" style="display:none" accept=".json">
                        <button id="clearBtn" class="btn btn-clear">🗑️ Apagar Banco de Dados</button>
                    </div>
                </div>
                <div class="table-container">
        `;

        if (totalSemFiltro === 0) {
            let emptyMsg = isProcessoOnly ? "Nenhuma Proposta/Processo (piccTools) salva no banco de dados." : "Nenhum CV salvo no banco de dados.";
            tableHtml += `<div class="empty-msg" style="padding: 20px; text-align: center; color: #777;">${this._esc(emptyMsg)}</div>`;
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

            if (!isProcessoOnly) {
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
            }

            let theadHtml = `<tr>`;
            theadHtml += `<th style="width: 30px; text-align: center;"><input type="checkbox" id="selectAllCheckbox" title="Selecionar Todos"></th>`;
            const proposalAllowedKeys = ['name', 'prioridade', 'faixa', 'fellowshipString', 'instituicaoExecutora', 'teamCount', 'reviewCount'];
            const processOnlyKeys = ['prioridade', 'faixa', 'instituicaoExecutora', 'teamCount', 'reviewCount'];
            const targetRank = (this.reportState && this.reportState.targetAuthorRank) ? parseInt(this.reportState.targetAuthorRank) : 1;
            this.METRICS_CONFIG.forEach(m => {
                if (isProcessoOnly && !proposalAllowedKeys.includes(m.key)) return;
                if (!isProcessoOnly && processOnlyKeys.includes(m.key)) return;
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
                if (m.key === 'fellowshipString') classes.push('bolsa-cell');
                if (m.key === 'instituicaoExecutora') classes.push('executora-cell');
                const classAttr = ` class="${classes.join(' ')}"`;
                
                if (m.key === 'faixa' && isProcessoOnly) {
                    const opcoes = [`<option value=""${this.faixaFilter === '' ? ' selected' : ''}>Todas (${totalSemFiltro})</option>`]
                        .concat(faixasDisponiveis.map(([f, n]) =>
                            `<option value="${this._esc(f)}"${this.faixaFilter === f ? ' selected' : ''}>${f === '-' ? 'Sem faixa' : 'Faixa ' + this._esc(f)} (${n})</option>`))
                        .join('');
                    const filtrando = this.faixaFilter !== '';
                    theadHtml += `<th${titleAttr} data-key="${m.key}"${classAttr}>
                        ${label}<span class="sort-indicator">${arrow}</span><br>
                        <select id="faixa-filter-select" title="Mostrar só as propostas de uma faixa"
                            style="margin-top: 4px; max-width: 100%; padding: 2px 4px; font-weight: ${filtrando ? 'bold' : 'normal'}; border: 1px solid ${filtrando ? '#E65100' : '#ccc'}; border-radius: 3px; background: ${filtrando ? '#FFF3E0' : 'white'}; color: ${filtrando ? '#E65100' : 'inherit'}; cursor: pointer;">${opcoes}</select>
                    </th>`;
                } else if (m.key === 'customId') {
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
                    ${isProcessoOnly ? '' : `<button id="bulk-btn-report" style="border:1px solid #ccc; border-radius:3px; cursor:pointer; background:#fff; padding:2px 4px;" title="Relatório dos Selecionados">📊</button>`}
                    ${isProcessoOnly ? '' : `<button id="bulk-btn-clear" style="border:1px solid #ccc; border-radius:3px; cursor:pointer; background:#fff; padding:2px 4px;" title="Limpar ID dos Selecionados">🧹</button>`}
                    ${isProcessoOnly ? `<button id="bulk-btn-proclist" style="border:1px solid #ccc; border-radius:3px; cursor:pointer; background:#fff; padding:2px 4px;" title="Lista dos números de processo para colar no campo &quot;Processos&quot; da planilha do piccTools (os selecionados ou, sem seleção, todos os da tabela)">📋</button>` : ''}
                    <button id="bulk-btn-delete" style="border:1px solid #ccc; border-radius:3px; cursor:pointer; background:#fff; padding:2px 4px;" title="${isProcessoOnly ? 'Excluir Propostas Selecionadas' : 'Excluir Selecionados'}">🗑️</button>
                    ${isProcessoOnly ? '' : `<button id="bulk-btn-open" style="border:1px solid #ccc; border-radius:3px; cursor:pointer; background:#fff; padding:2px 4px;" title="Abrir CVs selecionados no Lattes para atualizar">🔄</button>`}
                </div>
            </th></tr>`;

            let tbodyHtml = ``;
            if (db.length === 0 && this.faixaFilter) {
                const colunas = (theadHtml.match(/<th\b/g) || []).length;
                tbodyHtml += `<tr><td colspan="${colunas}" style="padding: 20px; text-align: center; color: #777;">
                    Nenhuma proposta ${this.faixaFilter === '-' ? 'sem faixa' : 'na faixa ' + this._esc(this.faixaFilter)}.
                </td></tr>`;
            }
            db.forEach(cv => {
                tbodyHtml += `<tr>`;
                tbodyHtml += `<td style="text-align: center;"><input type="checkbox" class="row-checkbox" data-name="${this._esc(cv.name || '')}" data-lattesid="${this._esc(cv.lattesId || '')}" data-processid="${this._esc(cv.processId || '')}" data-needs-update="${this.cvNeedsUpdate(cv) ? 'true' : 'false'}"></td>`;
                this.METRICS_CONFIG.forEach(m => {
                    if (isProcessoOnly && !proposalAllowedKeys.includes(m.key)) return;
                    if (!isProcessoOnly && processOnlyKeys.includes(m.key)) return;
                    const valBruto = this._valorColuna(cv, m.key);
                    const val = valBruto !== undefined ? valBruto : '';
                    let classes = [];
                    if (m.division) classes.push('division-left');
                    if (m.numeric) classes.push('numeric-cell');
                    if (m.key === 'name') classes.push('name-cell');
                    if (m.key === 'fellowshipString') classes.push('bolsa-cell');
                    if (m.key === 'instituicaoExecutora') classes.push('executora-cell');
                    const classAttr = classes.length > 0 ? ` class="${classes.join(' ')}"` : '';

                    if (m.key === 'name') {
                        let nameHtml = '';
                        if (isProcessoOnly || cv.isProcesso || cv.processId) {
                            const procId = cv.processId || 'Proposta';
                            nameHtml = `<strong><a href="javascript:void(0);" class="btn-process-report" data-name="${this._esc(cv.name || '')}" data-processid="${this._esc(cv.processId || '')}" data-lattesid="${this._esc(cv.lattesId || '')}" style="color: #1565C0; text-decoration: none;" title="Abrir Relatório da Proposta">📊 ${this._esc(cv.name || procId)}</a></strong>`;
                            if (cv.processId) {
                                nameHtml += ` <span style="background: #E3F2FD; color: #1565C0; border: 1px solid #90CAF9; font-size: 0.75em; padding: 1px 5px; border-radius: 3px; font-weight: normal;" title="Nº do Processo">📁 ${this._esc(cv.processId)}</span>`;
                            }
                            if (cv.edital) {
                                nameHtml += ` <span style="background: #E8F5E9; color: #2E7D32; border: 1px solid #A5D6A7; font-size: 0.75em; padding: 1px 5px; border-radius: 3px; font-weight: normal; margin-left: 3px;" title="Edital / Chamada">📜 ${this._esc(cv.edital)}</span>`;
                            }
                        } else {
                            const lattesLink = cv.lattesId ? `http://lattes.cnpq.br/${this._esc(cv.lattesId)}` : '#';
                            nameHtml = `<strong><a href="${lattesLink}" target="_blank" style="color: #1565C0; text-decoration: none;">${this._esc(String(val))}</a></strong>`;
                        }
                        tbodyHtml += `<td${classAttr}>${nameHtml}</td>`;
                    } else if (m.key === 'prioridade') {
                        const currentPrio = cv.prioridade !== undefined && cv.prioridade !== null && cv.prioridade !== '' ? String(cv.prioridade) : '-';
                        const prioOptions = ['-', '0', '1', '2', '3', '4'].map(opt =>
                            `<option value="${opt}"${opt === currentPrio ? ' selected' : ''}>${opt}</option>`
                        ).join('');
                        tbodyHtml += `<td${classAttr} style="text-align: center;">
                            <select class="priority-select" data-name="${this._esc(cv.name || '')}" data-lattesid="${this._esc(cv.lattesId || '')}" data-processid="${this._esc(cv.processId || '')}" style="padding: 2px 6px; border: 1px solid #ccc; border-radius: 3px; font-weight: bold; background: white; cursor: pointer;">
                                ${prioOptions}
                            </select>
                        </td>`;
                    } else if (m.key === 'faixa') {
                        const currentFaixa = cv.faixa !== undefined && cv.faixa !== null && cv.faixa !== '' ? String(cv.faixa).toUpperCase() : '-';
                        const badgeHtml = currentFaixa !== '-' 
                            ? `<span style="background: #FFF3E0; color: #E65100; border: 1px solid #FFE0B2; font-weight: bold; padding: 2px 8px; border-radius: 4px; font-size: 0.85em;">Faixa ${this._esc(currentFaixa)}</span>`
                            : `<span style="color: #888; font-weight: bold;">-</span>`;
                        tbodyHtml += `<td${classAttr} style="text-align: center;">${badgeHtml}</td>`;
                    } else if (m.key === 'fellowshipString') {
                        const isValid = (s) => s && typeof s === 'string' && s.trim() !== '' && s.trim() !== '-';
                        let bolsaVal = (cv.proponente && isValid(cv.proponente.bolsa)) ? cv.proponente.bolsa : (isValid(cv.fellowshipString) ? cv.fellowshipString : (isValid(cv.bolsa) ? cv.bolsa : ''));
                        
                        if (!isValid(bolsaVal)) {
                            const propName = cv.name || (cv.proponente && cv.proponente.name);
                            const propLattes = cv.lattesId || (cv.proponente && cv.proponente.lattesId);
                            const matchingCv = allCvRecords.find(c => !c.isProcesso && this.cvMatches(c, propName, propLattes));
                            if (matchingCv && isValid(matchingCv.fellowshipString)) {
                                bolsaVal = matchingCv.fellowshipString;
                            } else if (matchingCv && isValid(matchingCv.bolsa)) {
                                bolsaVal = matchingCv.bolsa;
                            }
                        }

                        if (!isValid(bolsaVal) && Array.isArray(cv.teamMembers)) {
                            const propName = cv.name || (cv.proponente && cv.proponente.name);
                            const propLattes = cv.lattesId || (cv.proponente && cv.proponente.lattesId);
                            const tmProp = cv.teamMembers.find(tm => this.cvMatches(tm, propName, propLattes));
                            if (tmProp && isValid(tmProp.bolsa)) {
                                bolsaVal = tmProp.bolsa;
                            } else if (cv.teamMembers.length > 0 && isValid(cv.teamMembers[0].bolsa)) {
                                const firstTmName = cv.teamMembers[0].name || '';
                                if (this.cvMatches({ name: firstTmName }, propName, '')) {
                                    bolsaVal = cv.teamMembers[0].bolsa;
                                }
                            }
                        }

                        const displayBolsa = isValid(bolsaVal) ? String(bolsaVal).replace('-', ' ').trim() : '-';
                        const badgeHtml = displayBolsa !== '-' 
                            ? `<span style="background: #E8F5E9; color: #2E7D32; border: 1px solid #A5D6A7; font-weight: bold; padding: 3px 10px; border-radius: 4px; font-size: 0.85em; display: inline-block; white-space: nowrap;">${this._esc(displayBolsa)}</span>`
                            : `<span style="color: #888; font-weight: bold;">-</span>`;
                        tbodyHtml += `<td${classAttr} style="text-align: center; white-space: nowrap; min-width: 95px;">${badgeHtml}</td>`;
                    } else if (m.key === 'instituicaoExecutora') {
                        // Abrevia apenas na exibição da tabela (o valor salvo continua completo,
                        // assim como o tooltip e o cabeçalho do relatório).
                        const execVal = val ? String(val) : '';
                        const execShort = execVal
                            .replace(/,\s*Brasil\.?\s*$/i, '')
                            .replace(/\bUniversidade\b/gi, 'Univ.')
                            .replace(/\bFederal\b/gi, 'Fed.')
                            .replace(/\bInstituto\b/gi, 'Inst.')
                            .trim();
                        tbodyHtml += `<td${classAttr}${execVal ? ` title="${this._esc(execVal)}"` : ''}>${execVal ? this._esc(execShort) : '<span style="color:#999;">-</span>'}</td>`;
                    } else if (m.key === 'teamCount' || m.key === 'reviewCount') {
                        const n = Number(val) || 0;
                        const corpo = n > 0
                            ? `<strong>${n}</strong>`
                            : '<span style="color:#999;">0</span>';
                        tbodyHtml += `<td${classAttr} style="text-align: center;">${corpo}</td>`;
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
                const isProc = isProcessoOnly || cv.isProcesso || cv.processId;
                tbodyHtml += `<td class="division-left" style="white-space: nowrap;${isProcessoOnly ? ' text-align: center;' : ''}">
                    <button class="btn btn-view-report" data-name="${this._esc(cv.name || '')}" data-lattesid="${this._esc(cv.lattesId || '')}" data-processid="${this._esc(cv.processId || '')}" title="${isProc ? 'Relatório da Proposta' : 'Relatório do CV'}">📊</button>
                    ${isProc ? '' : `<button class="btn btn-clear-id" data-name="${this._esc(cv.name || '')}" data-lattesid="${this._esc(cv.lattesId || '')}" title="Limpar ID">🧹</button>`}
                    <button class="btn btn-delete-row" data-name="${this._esc(cv.name || '')}" data-lattesid="${this._esc(cv.lattesId || '')}" data-processid="${this._esc(cv.processId || '')}" title="Excluir">🗑️</button>
                    ${cv.lattesId ? `<button class="btn btn-open-cv" data-lattesid="${this._esc(cv.lattesId || '')}" title="Abrir Lattes do Proponente">🔄</button>` : ''}
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
                this.exportCSV(newTab);
            });
        }

        const exportJsonBtn = newTab.document.getElementById('exportJsonBtn');
        if (exportJsonBtn) {
            exportJsonBtn.addEventListener('click', () => {
                this.exportJSON(newTab, isProcessoOnly);
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
                    this.importJSON(file, newTab, isProcessoOnly).then(() => {
                        this.viewDB(newTab, { processOnly: isProcessoOnly });
                    });
                }
            });
        }

        const refreshBtn = newTab.document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.viewDB(newTab, { processOnly: isProcessoOnly });
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
                this.clearDB(false, isProcessoOnly, newTab).then(() => {
                    this.viewDB(newTab, { processOnly: isProcessoOnly });
                });
            });
        }

        const deleteBtns = newTab.document.querySelectorAll('.btn-delete-row');
        deleteBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const name = e.currentTarget.getAttribute('data-name');
                const lattesId = e.currentTarget.getAttribute('data-lattesid');
                const confirmMsg = isProcessoOnly 
                    ? `Tem certeza que deseja apagar a proposta de ${name}?` 
                    : `Tem certeza que deseja apagar o CV de ${name}?`;
                if (newTab.confirm(confirmMsg)) {
                    this.deleteSingleCV(name, lattesId, isProcessoOnly).then(() => {
                        this.viewDB(newTab, { processOnly: isProcessoOnly });
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
            const freshDb = await this.getDB(isProcessoOnly);
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

        const prioritySelects = newTab.document.querySelectorAll('.priority-select');
        prioritySelects.forEach(select => {
            select.addEventListener('change', async (e) => {
                const newPrio = e.currentTarget.value;
                const name = e.currentTarget.getAttribute('data-name');
                const lattesId = e.currentTarget.getAttribute('data-lattesid');
                const procId = e.currentTarget.getAttribute('data-processid');

                const freshDb = await this.getDB(isProcessoOnly);
                const cvIndex = freshDb.findIndex(cv => this.cvMatches(cv, name, lattesId, procId));
                if (cvIndex >= 0) {
                    freshDb[cvIndex].prioridade = newPrio;
                    await this.saveCVs([freshDb[cvIndex]]);

                    const localIndex = db.findIndex(cv => this.cvMatches(cv, name, lattesId, procId));
                    if (localIndex >= 0) db[localIndex].prioridade = newPrio;

                    this.showToast(`Prioridade de "${name || procId}" alterada para "${newPrio}"`, '#2E7D32');
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
            .map(cb => ({
                name: cb.getAttribute('data-name'),
                lattesId: cb.getAttribute('data-lattesid'),
                processId: cb.getAttribute('data-processid')
            }));

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

            const freshDb = await this.getDB(isProcessoOnly);
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
                this.viewDB(newTab, { processOnly: isProcessoOnly });
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
                    const freshDb = await this.getDB(isProcessoOnly);
                    const modifiedCvs = [];
                    selected.forEach(({ name, lattesId }) => {
                        const cvIndex = findCvIndex(freshDb, name, lattesId);
                        if (cvIndex >= 0) {
                            freshDb[cvIndex].customId = '';
                            modifiedCvs.push(freshDb[cvIndex]);
                        }
                    });
                    await this.saveCVs(modifiedCvs);
                    this.viewDB(newTab, { processOnly: isProcessoOnly });
                }
            });
        }

        // Lista de processos para colar na planilha do piccTools. Com linhas marcadas,
        // leva so elas; sem marcacao, leva a tabela inteira — que ja e o resultado do
        // filtro de faixa, porque ele e aplicado antes da renderizacao (as linhas de fora
        // nao chegam a existir).
        const bulkBtnProcList = newTab.document.getElementById('bulk-btn-proclist');
        if (bulkBtnProcList) {
            bulkBtnProcList.addEventListener('click', () => {
                const selecionados = selectedCheckboxData();
                const usouSelecao = selecionados.length > 0;
                const fonte = usouSelecao
                    ? selecionados.map(s => s.processId)
                    : Array.from(rowCheckboxes).map(cb => cb.getAttribute('data-processid'));
                const processos = [...new Set(fonte.map(p => String(p || '').trim()).filter(Boolean))];
                if (processos.length === 0) {
                    newTab.alert('Nenhuma proposta com número de processo na tabela.');
                    return;
                }
                this.mostrarListaProcessos(newTab, processos, usouSelecao
                    ? 'apenas as propostas selecionadas'
                    : 'todas as propostas da tabela, já com o filtro atual');
            });
        }

        const bulkBtnDelete = newTab.document.getElementById('bulk-btn-delete');
        if (bulkBtnDelete) {
            bulkBtnDelete.addEventListener('click', async () => {
                const selected = selectedCheckboxData();
                if (selected.length === 0) return;

                if (newTab.confirm(`Tem certeza que deseja EXCLUIR ${selected.length} CV(s) do banco de dados? Esta ação não pode ser desfeita.`)) {
                    const freshDb = await this.getDB(isProcessoOnly);
                    const toRemove = freshDb.filter(cv => selected.some(s => this.cvMatches(cv, s.name, s.lattesId)));
                    await this.removeCVs(toRemove);
                    this.viewDB(newTab, { processOnly: isProcessoOnly });
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
                const freshDb = await this.getDB(isProcessoOnly);
                const cvIndex = findCvIndex(freshDb, name, lattesId);
                if (cvIndex >= 0) {
                    freshDb[cvIndex].customId = '';
                    await this.saveCVs([freshDb[cvIndex]]);
                    this.viewDB(newTab, { processOnly: isProcessoOnly });
                }
            });
        });

        const deleteRowBtns = newTab.document.querySelectorAll('.btn-delete-row');
        deleteRowBtns.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const name = e.currentTarget.getAttribute('data-name');
                const lattesId = e.currentTarget.getAttribute('data-lattesid');
                const processId = e.currentTarget.getAttribute('data-processid');
                const itemLabel = processId || name || 'este registro';

                if (newTab.confirm(`Tem certeza que deseja EXCLUIR "${itemLabel}" do banco de dados?`)) {
                    const freshDb = await this.getDB(isProcessoOnly);
                    const target = freshDb.find(cv => (processId && cv.processId === processId) || this.cvMatches(cv, name, lattesId, processId));
                    if (target) {
                        await this.removeCVs([target]);
                        this.viewDB(newTab, { processOnly: isProcessoOnly });
                    }
                }
            });
        });

        const handleOpenReport = (btn) => {
            const name = btn.getAttribute('data-name');
            const lattesId = btn.getAttribute('data-lattesid');
            const processId = btn.getAttribute('data-processid');
            
            const target = db.find(cv => 
                (processId && cv.processId === processId) || 
                this.cvMatches(cv, name, lattesId, processId)
            );

            if (target) {
                if (isProcessoOnly || target.isProcesso || target.processId) {
                    this.renderProcessReport(target, newTab, this._listaNavegacao(db, target, selectedCheckboxData()));
                } else {
                    this.renderCVReport(target, newTab, db);
                }
            }
        };

        const processReportBtns = newTab.document.querySelectorAll('.btn-process-report');
        processReportBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleOpenReport(e.currentTarget);
            });
        });

        const viewReportBtns = newTab.document.querySelectorAll('tbody .btn-view-report');
        viewReportBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleOpenReport(e.currentTarget);
            });
        });

        // Filtro por faixa
        const faixaSelect = newTab.document.getElementById('faixa-filter-select');
        if (faixaSelect) {
            faixaSelect.addEventListener('click', (e) => e.stopPropagation());   // o <th> em volta ordena ao clicar
            faixaSelect.addEventListener('change', (e) => {
                this.faixaFilter = e.target.value;
                this.viewDB(newTab, { processOnly: isProcessoOnly });
            });
        }

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
                this.viewDB(newTab, { processOnly: isProcessoOnly });
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
                }
            });
        }
    },

    // ---------------------------------------------------------------------------
    // Fonte do relatorio consolidado: os CVs da equipe ou a pagina "Producoes e
    // Orientacoes" do proponente. A pagina do efomento cobre apenas os ultimos 10
    // anos e nao traz citacoes por artigo, mas serve quando nenhum membro tem CV
    // no banco — que e o caso mais comum antes de abrir os curriculos no Lattes.
    // ---------------------------------------------------------------------------
    _cvDataDeProducoes: function (proc, htmlProducoes) {
        if (!htmlProducoes || !window.JCRProducoes || typeof window.JCRProducoes.parse !== 'function') return null;
        let lido;
        try {
            lido = window.JCRProducoes.parse(htmlProducoes);
        } catch (e) {
            console.warn('[dbTools] Falha ao ler a página de produções:', e);
            return null;
        }
        if (!lido || (lido.publications.length === 0 && lido.supervisions.raw.length === 0 && lido.patents.length === 0)) {
            return null;
        }

        const nome = lido.nome || (proc && proc.proponente && proc.proponente.name) || (proc && proc.name) || 'Proponente';
        return {
            name: nome,
            lattesId: (proc && proc.proponente && proc.proponente.lattesId) || '',
            dateAdded: new Date().toISOString(),
            publications: lido.publications,
            rawPatents: lido.patents,
            rawEvents: [],                       // trabalhos em eventos ficam de fora
            supervisions: lido.supervisions,
            declaredCitations: lido.declaredCitations,
            ridStats: null,
            researcherIdLink: null,
            highJcr: 7.0,
            lowJcr: 1.5,
            groupMembers: [],
            allTeamCvs: [],
            _fonte: 'producoes',
            _fonteNome: nome,
            _fonteAnos: { min: lido.anoMin, max: lido.anoMax },
            _fonteNivel: lido.nivel,
            _fonteDuplicatas: lido.duplicatasRemovidas || 0
        };
    },

    renderProcessReport: async function(processData, newTab, sortedDb = null) {
        if (!processData || !newTab) return;

        const prop = processData.proponente || {};
        const proponenteName = prop.name || processData.name || 'Proponente';

        const safeProcessId = (processData.processId || 'projeto').replace(/[\/\\?%*:|"<>]/g, '-').trim();

        const folderPath = this._projectFolderPath(processData);
        const uf = prop.uf || '-';
        const inst = prop.instituicao || '-';

        // Fetch all individual CV entries in general DB and dedicated piccTools DB
        const allDbCvs = await this.getDB(false);
        const piccCvs = await this.getPiccCVs();
        const combinedCvs = [...piccCvs, ...allDbCvs];

        // 1. Team Members Structure
        let teamMembers = [];
        teamMembers.push({
            name: proponenteName,
            role: 'Proponente / Coordenador',
            formacao: prop.formacao || '',
            bolsa: prop.bolsa || '-',
            instituicao: inst,
            lattesId: processData.lattesId || prop.lattesId || '',
            cvLink: prop.cvLink || ''
        });

        if (Array.isArray(processData.teamMembers)) {
            processData.teamMembers.forEach(tm => {
                if (tm && tm.name && !teamMembers.some(m => m.name.toLowerCase() === tm.name.toLowerCase())) {
                    teamMembers.push({
                        name: tm.name,
                        role: tm.categoria || tm.role || 'Membro da Equipe',
                        formacao: tm.formacao || '',
                        bolsa: tm.bolsa || '-',
                        instituicao: tm.instituicao || '-',
                        lattesId: tm.lattesId || '',
                        cvLink: tm.cvLink || ''
                    });
                }
            });
        }

        // Check which team members exist in the DB with full parsed CV data
        const excludedCvKeys = Array.isArray(processData.excludedCvKeys) ? processData.excludedCvKeys : [];
        let foundGroupCvs = [];

        // Apenas seleciona os CVs que entram no consolidado. A tabela da equipe é montada
        // em renderCVReport(); a versão que existia aqui era atribuída e nunca usada.
        teamMembers.forEach((member) => {
            const memberCv = combinedCvs.find(cv => !cv.isProcesso && this.cvMatches(cv, member.name, member.lattesId));
            const hasFullCvData = !!(memberCv && this.isFullCv(memberCv));
            
            const memberKey = member.lattesId || member.name;
            const isExcluded = excludedCvKeys.includes(memberKey) || excludedCvKeys.includes(member.name);
            const isIncluded = !isExcluded;

            if (hasFullCvData && memberCv && isIncluded) {
                foundGroupCvs.push(memberCv);
            }
        });


        // Build Group Statistics and full groupCvData for team members present in DB
        let uniquePubs = [];
        let uniquePatents = [];
        let uniqueEvents = [];
        let uniqueSupervisions = [];
        let groupConcluded = {};
        let groupInCourse = {};

        if (foundGroupCvs.length > 0) {
            foundGroupCvs.forEach(cv => {
                if (Array.isArray(cv.publications)) {
                    cv.publications.forEach(p => {
                        const pTitle = (p.paperTitle || p.title || '').trim().toLowerCase();
                        const pDoi = (p.doi || '').trim().toLowerCase();
                        const exists = uniquePubs.some(existing => {
                            const exDoi = (existing.doi || '').trim().toLowerCase();
                            if (exDoi && pDoi && exDoi === pDoi) return true;
                            const exTitle = (existing.paperTitle || existing.title || '').trim().toLowerCase();
                            return exTitle && pTitle && exTitle === pTitle;
                        });
                        if (!exists) uniquePubs.push(p);
                    });
                }
                if (Array.isArray(cv.rawPatents)) {
                    cv.rawPatents.forEach(pat => {
                        if (!uniquePatents.some(existing => existing.title && pat.title && existing.title.toLowerCase() === pat.title.toLowerCase())) {
                            uniquePatents.push(pat);
                        }
                    });
                }
                if (Array.isArray(cv.rawEvents)) {
                    cv.rawEvents.forEach(ev => {
                        if (!uniqueEvents.some(existing => existing.name && ev.name && existing.name.toLowerCase() === ev.name.toLowerCase())) {
                            uniqueEvents.push(ev);
                        }
                    });
                }
                if (cv.supervisions) {
                    const rawSup = Array.isArray(cv.supervisions.raw) ? cv.supervisions.raw : (Array.isArray(cv.supervisions) ? cv.supervisions : []);
                    rawSup.forEach(s => {
                        uniqueSupervisions.push(s);
                        const cat = s.category || 'Outras';
                        if (s.status === 'Concluída') {
                            if (!groupConcluded[cat]) groupConcluded[cat] = [];
                            if (s.year && !isNaN(s.year)) groupConcluded[cat].push(parseInt(s.year));
                        } else if (s.status === 'Em andamento') {
                            groupInCourse[cat] = (groupInCourse[cat] || 0) + 1;
                        }
                    });
                }
            });
        }

        const groupCvData = {
            name: `Equipe da Proposta ${processData.processId || ''} (${foundGroupCvs.length} membros)`,
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
            groupMembers: foundGroupCvs,
            allTeamCvs: combinedCvs
        };

        // ---- Fonte do relatorio ----
        // Preferencia gravada na proposta; sem ela, usa as producoes quando nenhum
        // membro da equipe tem CV no banco.
        let htmlProducoes = processData.producoesHtml || '';
        if (!htmlProducoes && processData.processId) {
            try {
                const blobs = await this.getProcBlobs(processData.processId);
                htmlProducoes = (blobs && blobs.producoes) || '';
            } catch (e) { /* segue sem as producoes */ }
        }
        const temProducoes = !!htmlProducoes;
        const temCvs = foundGroupCvs.length > 0;
        const escolha = processData.fonteRelatorio;      // 'cvs' | 'producoes' | undefined
        const usarProducoes = temProducoes && (escolha === 'producoes' || (!escolha && !temCvs));

        let dadosRelatorio = groupCvData;
        if (usarProducoes) {
            const deProducoes = this._cvDataDeProducoes(processData, htmlProducoes);
            if (deProducoes) {
                deProducoes.allTeamCvs = combinedCvs;
                dadosRelatorio = deProducoes;
            }
        }
        dadosRelatorio._temProducoes = temProducoes;
        dadosRelatorio._temCvs = temCvs;
        dadosRelatorio._totalCvs = foundGroupCvs.length;

        return this.renderCVReport(dadosRelatorio, newTab, sortedDb, processData);
    },

    renderCVReport: function(cvData, newTab, sortedDb = null, parentGroupData = null) {
        const publications = cvData.publications || [];
        const rawPatents = cvData.rawPatents || [];
        const rawEvents = cvData.rawEvents || [];
        const supervisions = cvData.supervisions || {};
        const declaredCitations = cvData.declaredCitations || null;

        // Process entry metadata if called from renderProcessReport
        let projectHeaderHtml = '';
        let reviewsHtml = '';
        let hasGroupCvs = true;
        if (parentGroupData && (parentGroupData.processId || parentGroupData.isProcesso)) {
            const proc = parentGroupData;
            const prop = proc.proponente || {};
            const proponenteName = prop.name || proc.name || 'Proponente';
            const safeProcessId = (proc.processId || 'projeto').replace(/[\/\\?%*:|"<>]/g, '-').trim();
            const folderPath = this._projectFolderPath(proc);
            const inst = prop.instituicao || '-';

            // Navigation buttons for projects
            // Anterior/Proxima percorrem a lista recebida em sortedDb: a ordem da tabela
            // de propostas ou, quando ha selecao por checkbox, apenas os selecionados.
            // A posicao vem da chave da proposta e nao do processId cru: propostas sem
            // processId casavam todas entre si (undefined === undefined).
            let procNavHTML = '';
            if (Array.isArray(sortedDb) && sortedDb.length > 1) {
                const chaveAtual = this._chaveProposta(proc);
                let curIdx = sortedDb.indexOf(proc);
                if (curIdx === -1 && chaveAtual) {
                    curIdx = sortedDb.findIndex(p => this._chaveProposta(p) === chaveAtual);
                }
                if (curIdx !== -1) {
                    const prevIdx = curIdx > 0 ? curIdx - 1 : sortedDb.length - 1;
                    const nextIdx = curIdx < sortedDb.length - 1 ? curIdx + 1 : 0;
                    const prevP = sortedDb[prevIdx];
                    const nextP = sortedDb[nextIdx];
                    const rotulo = (p) => (p && (p.name || p.processId)) || 'Proposta';
                    const ehSelecao = sortedDb.jcrSelecao === true;
                    const navStyle = 'padding: 8px 14px; background: #95a5a6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';
                    procNavHTML = `
                        <button id="btn-prev-proc" data-navidx="${prevIdx}" style="${navStyle}" title="Proposta anterior: ${this._esc(rotulo(prevP))}">⬅️ Anterior</button>
                        <span class="no-print" style="font-size: 0.85em; font-weight: bold; background: rgba(255,255,255,0.2); padding: 5px 10px; border-radius: 4px; white-space: nowrap;" title="${ehSelecao ? 'Navegando apenas pelas propostas selecionadas na tabela' : 'Navegando por todas as propostas da tabela'}">${curIdx + 1} / ${sortedDb.length}${ehSelecao ? ' ✔ seleção' : ''}</span>
                        <button id="btn-next-proc" data-navidx="${nextIdx}" style="${navStyle}" title="Próxima proposta: ${this._esc(rotulo(nextP))}">Próxima ➡️</button>
                    `;
                }
            }

            // Bloco "Pareceres Ad-Hoc": um recolhivel por parecer, com o resultado no
            // titulo e a justificativa no corpo. O botao de abrir apenas aciona o botao
            // ja existente no card de documentos, para nao duplicar a cadeia de decisao
            // on-line / copia no banco / pasta sincronizada / busca na origem.
            const pareceresAdHocHtml = (() => {
                const lista = Array.isArray(proc.reviews) ? proc.reviews : [];
                if (lista.length === 0) return '';

                const avaliacoes = lista.map(r => this._avaliacaoParecer(r));
                const nR = avaliacoes.filter(a => a.sigla === 'R').length;
                const nNR = avaliacoes.filter(a => a.sigla === 'NR').length;
                const nSem = avaliacoes.length - nR - nNR;
                const resumo = [
                    nR ? `${nR} recomendada${nR > 1 ? 's' : ''}` : '',
                    nNR ? `${nNR} não recomendada${nNR > 1 ? 's' : ''}` : '',
                    nSem ? `${nSem} sem resultado` : ''
                ].filter(Boolean).join(', ');

                const blocos = lista.map((rev, idx) => {
                    const av = avaliacoes[idx];
                    const titulo = av.resultado || 'sem resultado de ad hoc';
                    const justificativa = (rev && typeof rev === 'object' && rev.justificativa)
                        ? String(rev.justificativa).trim() : '';
                    const corpo = justificativa
                        ? `<div style="margin-top: 10px; font-size: 0.9em; line-height: 1.55; color: #333; white-space: pre-wrap; word-break: break-word;">${this._esc(justificativa)}</div>`
                        : `<div style="margin-top: 10px; font-size: 0.85em; color: #777; font-style: italic;">Sem justificativa registrada nesta leitura. Abra o parecer para ver o conteúdo completo.</div>`;
                    return `
                        <details data-collapse-key="parecer-ad-hoc-${idx + 1}" style="background: #fff; border: 1px solid ${av.corBorda}; border-left: 5px solid ${av.cor}; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px;">
                            <summary style="cursor: pointer; font-weight: bold; color: ${av.corTexto}; list-style: none; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
                                <span>Ad-Hoc #${idx + 1}: ${this._esc(titulo)}</span>
                                <button class="btn-abrir-parecer no-print" data-parecer-idx="${idx}" style="background: ${av.cor}; color: white; border: none; padding: 3px 10px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.8em;" title="Abrir o parecer completo">📄 abrir</button>
                            </summary>
                            ${corpo}
                        </details>`;
                }).join('');

                return `
                <details data-collapse-key="pareceres-ad-hoc" style="margin-bottom: 20px; background: #FFF8E1; border: 1px solid #FFE082; border-radius: 8px; padding: 15px;">
                    <summary style="cursor: pointer; font-weight: bold; color: #E65100; font-size: 1.1em; list-style: none;">
                        ⚖️ Pareceres Ad-Hoc <span style="font-weight: normal; font-size: 0.82em; color: #795548;">(${lista.length}${resumo ? ' — ' + resumo : ''})</span>
                    </summary>
                    <div style="margin-top: 12px;">${blocos}</div>
                </details>`;
            })();

            // Parecer tecnico lido da coluna homonima da planilha: vazio, "Pre-selecionado"
            // ou "Nao pre-selecionado". Etiqueta de fundo BRANCO, com texto e borda na cor
            // do estado. Texto vermelho direto sobre o azul #1565C0 do cabecalho nao serve
            // (1,02:1 de contraste, some), e fundo vermelho vivo tambem nao (1,15:1): as
            // duas cores tem luminancia parecida. O branco e o que salta do cabecalho
            // (5,75:1), e a borda vermelha da a leitura de alerta.
            const parecerTexto = String(proc.parecerTecnico || '').trim();
            const parecerNegativo = parecerTexto
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().startsWith('nao');
            const parecerEstilo = parecerNegativo
                ? 'background: #ffffff; color: #C62828; border: 2px solid #C62828;'
                : 'background: #ffffff; color: #1B5E20; border: 2px solid #2E7D32;';
            const parecerTecnicoHTML = parecerTexto
                ? `<div style="margin-top: 6px; font-size: 0.85em;">📋 <strong>Parecer técnico:</strong> <span style="${parecerEstilo} font-weight: bold; padding: 3px 10px; border-radius: 4px;">${parecerNegativo ? '⚠️ ' : ''}${this._esc(parecerTexto)}</span></div>`
                : '';

            // Prioridade editavel no proprio relatorio: mesmos valores e mesmo destino
            // da coluna Prioridade da tabela de propostas, para o revisor classificar
            // sem ter de voltar a tabela. Fica em linha propria (flex-basis 100%) no
            // rodape do bloco de acoes, abaixo de Imprimir / Voltar as Propostas.
            const prioridadeAtual = (proc.prioridade !== undefined && proc.prioridade !== null && String(proc.prioridade).trim() !== '')
                ? String(proc.prioridade).trim() : '-';
            const prioridadeOpcoes = ['-', '0', '1', '2', '3', '4']
                .map(o => `<option value="${o}"${o === prioridadeAtual ? ' selected' : ''}>${o}</option>`).join('');
            const prioridadeHTML = `
                <div style="flex: 1 0 100%; display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 2px;">
                    <label for="proc-priority-select" style="font-weight: bold; font-size: 0.9em;" title="Prioridade da Proposta (-, 0, 1, 2, 3, 4)">🎯 Prioridade:</label>
                    <select id="proc-priority-select" style="padding: 4px 10px; border: 1px solid #ccc; border-radius: 3px; font-weight: bold; background: white; cursor: pointer;">${prioridadeOpcoes}</select>
                    <span id="proc-priority-status" style="font-size: 0.8em; color: #1B5E20; font-weight: bold; display: none; background: #E8F5E9; padding: 2px 8px; border-radius: 10px; border: 1px solid #A5D6A7;">✓ Salvo</span>
                </div>`;

            // Documents Card
            let filesHtml = `
                <div style="background: #E8F5E9; border: 1px solid #C8E6C9; border-radius: 8px; padding: 15px; margin-bottom: 20px;">
                    <h3 style="margin-top: 0; color: #2E7D32; font-size: 1.1em; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                        <span>📁 Documentos e Arquivos da Proposta</span>
                        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                            <div style="display: flex; align-items: center; gap: 8px; background: #ffffff; border: 1px solid #A5D6A7; padding: 4px 12px; border-radius: 20px; font-size: 0.85em; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                                <span style="font-weight: bold; color: #1B5E20;">Modo de Leitura:</span>
                                <label style="cursor: pointer; display: flex; align-items: center; gap: 4px; font-weight: bold; color: #2E7D32;" title="Abrir usando os links diretos da Web / CNPq">
                                    <input type="radio" name="doc-source-mode" value="online" checked style="cursor: pointer; accent-color: #2E7D32;"> 🌐 On-line
                                </label>
                                <label style="cursor: pointer; display: flex; align-items: center; gap: 4px; font-weight: bold; color: #1565C0;" title="Abrir usando as cópias salvas no backup local">
                                    <input type="radio" name="doc-source-mode" value="offline" style="cursor: pointer; accent-color: #1565C0;"> 📂 Backup Local
                                </label>
                                <button id="btn-pasta-local" class="no-print" style="display: none; background: #ECEFF1; border: 1px solid #B0BEC5; color: #37474F; padding: 3px 10px; border-radius: 12px; cursor: pointer; font-size: 0.95em; font-weight: bold; white-space: nowrap;" title="Aponte a pasta piccData sincronizada para ler daqui os pareceres e CVs em HTML">📁 Pasta…</button>
                            </div>
                            <span style="font-size: 0.85em; font-weight: normal; background: #C8E6C9; color: #1B5E20; padding: 4px 10px; border-radius: 4px;">
                                📂 Pasta Local: <button id="btn-open-project-folder" data-folder="${this._esc(folderPath)}" style="background: none; border: none; color: #1B5E20; font-weight: bold; text-decoration: underline; cursor: pointer; padding: 0; font-size: 1em;" title="Clique para abrir esta pasta no Gerenciador de Arquivos">Downloads/${this._esc(folderPath)}/</button>
                            </span>
                        </div>
                    </h3>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px;">
                        ${(() => {
                            const pdfOnlineUrl = proc.pdfLink || '';
                            const onlineLabel = '📄 Proposta';
                            const offlineLabel = `📄 proposta_${safeProcessId}.pdf`;
                            return `<button id="btn-doc-proposta" class="btn-doc-item" data-online-label="${this._esc(onlineLabel)}" data-offline-label="${this._esc(offlineLabel)}" data-online-url="${this._esc(pdfOnlineUrl)}" style="background: #37474F; color: white; border: none; padding: 8px 14px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.85em; display: inline-flex; align-items: center; gap: 5px;" title="${this._esc(onlineLabel)}">${this._esc(onlineLabel)}</button>`;
                        })()}

                        ${(() => {
                            const congeladoUrl = prop.cvCongelado || proc.cvCongelado || (prop.cvLink && !prop.cvLink.includes('lattes.cnpq.br') ? prop.cvLink : '');
                            const safeLattesId = (prop.lattesId || proc.lattesId || 'proponente');
                            if (proc.cvHtml || congeladoUrl) {
                                const onlineLabel = '❄️ CV Lattes (Congelado)';
                                const offlineLabel = `❄️ curriculo_${safeLattesId}.html`;
                                return `<button id="btn-doc-cv-congelado" class="btn-doc-item" data-online-label="${this._esc(onlineLabel)}" data-offline-label="${this._esc(offlineLabel)}" data-online-url="${this._esc(congeladoUrl)}" style="background: #1976D2; color: white; border: none; padding: 8px 14px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.85em; display: inline-flex; align-items: center; gap: 5px;" title="${this._esc(onlineLabel)}">${this._esc(onlineLabel)}</button>`;
                            }
                            return '';
                        })()}

                        ${(() => {
                            let html = '';
                            const reviewsList = Array.isArray(proc.reviews) ? proc.reviews : [];

                            if (reviewsList.length > 0) {
                                reviewsList.forEach((rev, idx) => {
                                    const onlineUrl = (typeof rev === 'string') ? rev : (rev.link || '');
                                    // A sigla entra no lugar do icone e a cor acompanha, para dar
                                    // para varrer os pareceres de relance. Vai no proprio texto do
                                    // rotulo (e nao como marcacao) porque updateDocButtonsUI troca
                                    // os rotulos por textContent ao alternar on-line/backup.
                                    const av = this._avaliacaoParecer(rev);
                                    const marca = av.sigla ? `[${av.sigla}] ` : '📝 ';
                                    const onlineLabel = reviewsList.length > 1 ? `${marca}Parecer Ad-Hoc #${idx + 1}` : `${marca}Parecer Ad-Hoc`;
                                    const offlineLabel = `${marca}parecer_${idx + 1}.html`;
                                    const titulo = av.resultado
                                        ? `${onlineLabel} — ${av.resultado}`
                                        : onlineLabel;
                                    html += `<button id="btn-doc-parecer-${idx + 1}" class="btn-doc-item btn-doc-parecer-item" data-idx="${idx}" data-online-label="${this._esc(onlineLabel)}" data-offline-label="${this._esc(offlineLabel)}" data-online-url="${this._esc(onlineUrl)}" style="background: ${av.cor}; color: white; border: none; padding: 8px 14px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.85em; display: inline-flex; align-items: center; gap: 5px;" title="${this._esc(titulo)}">${this._esc(onlineLabel)}</button>`;
                                });
                            }
                            return html;
                        })()}

                        ${(() => {
                            if (!proc.producoesLink && !proc.producoesHtml) return '';
                            const onlineLabel = '📚 Produções e Orientações';
                            const offlineLabel = `📚 producoes_${safeProcessId}.html`;
                            return `<button id="btn-doc-producoes" class="btn-doc-item" data-online-label="${this._esc(onlineLabel)}" data-offline-label="${this._esc(offlineLabel)}" data-online-url="${this._esc(proc.producoesLink || '')}" style="background: #00838F; color: white; border: none; padding: 8px 14px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.85em; display: inline-flex; align-items: center; gap: 5px;" title="${this._esc(onlineLabel)}">${this._esc(onlineLabel)}</button>`;
                        })()}

                        ${(() => {
                            let html = '';
                            const rawAttList = (Array.isArray(proc.attachments) && proc.attachments.length > 0)
                                ? proc.attachments
                                : (proc.supplementaryLink ? [{ type: 'Anexo', url: proc.supplementaryLink }] : []);

                            const attList = [...rawAttList].sort((a, b) => {
                                const aType = (a.type || a.name || '').toLowerCase();
                                const bType = (b.type || b.name || '').toLowerCase();
                                const aIsCv = aType.includes('currículo') || aType.includes('curriculo') || aType.includes('cv');
                                const bIsCv = bType.includes('currículo') || bType.includes('curriculo') || bType.includes('cv');
                                if (aIsCv && !bIsCv) return 1;
                                if (!aIsCv && bIsCv) return -1;
                                return 0;
                            });

                            if (attList.length > 0) {
                                attList.forEach((att, idx) => {
                                    let typeName = (att.type || 'Anexo')
                                        .replace(/Curr[íi]culo\s+Lattes/gi, 'CV Lattes')
                                        .replace(/Curr[íi]culo/gi, 'CV')
                                        .replace(/Curriculum\s+Vitae/gi, 'CV');
                                    const onlineLabel = `📦 ${typeName}`;
                                    const safeType = String(att.type || 'anexo').toLowerCase().replace(/[^\w]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'anexo';
                                    const countSuffix = attList.length > 1 ? `_${idx + 1}` : '';
                                    let ext = 'pdf';
                                    if (att.url && att.url.toLowerCase().includes('.zip')) ext = 'zip';
                                    else if (att.url && att.url.toLowerCase().includes('.doc')) ext = 'doc';
                                    const offlineLabel = `📦 anexo_${safeType}${countSuffix}_${safeProcessId}.${ext}`;
                                    const onlineUrl = att.url || '';
                                    html += `<button id="btn-doc-anexo-${idx + 1}" class="btn-doc-item btn-doc-anexo-item" data-idx="${idx}" data-online-label="${this._esc(onlineLabel)}" data-offline-label="${this._esc(offlineLabel)}" data-online-url="${this._esc(onlineUrl)}" style="background: #7B1FA2; color: white; border: none; padding: 8px 14px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.85em; display: inline-flex; align-items: center; gap: 5px;" title="${this._esc(onlineLabel)}">${this._esc(onlineLabel)}</button>`;
                                });
                            }
                            return html;
                        })()}
                    </div>
                </div>
            `;

            // Team Members Structure
            // srcIdx liga cada linha da tabela ao dado de origem: -1 e o proponente
            // (proc.proponente), >= 0 e a posicao em proc.teamMembers. A tabela filtra
            // duplicatas, entao o indice da linha nao serve para editar/remover.
            let teamMembers = [];
            teamMembers.push({
                name: proponenteName,
                role: 'Proponente / Coordenador',
                formacao: prop.formacao || '',
                bolsa: prop.bolsa || '-',
                instituicao: inst,
                lattesId: proc.lattesId || prop.lattesId || '',
                cvLink: prop.cvLink || '',
                srcIdx: -1
            });

            if (Array.isArray(proc.teamMembers)) {
                proc.teamMembers.forEach((tm, srcIdx) => {
                    if (tm && tm.name && !teamMembers.some(m => m.name.toLowerCase() === tm.name.toLowerCase())) {
                        teamMembers.push({
                            name: tm.name,
                            role: tm.categoria || tm.role || 'Membro da Equipe',
                            formacao: tm.formacao || '',
                            bolsa: tm.bolsa || '-',
                            instituicao: tm.instituicao || '-',
                            lattesId: tm.lattesId || '',
                            cvLink: tm.cvLink || '',
                            srcIdx: srcIdx
                        });
                    }
                });
            }

            const excludedCvKeys = Array.isArray(proc.excludedCvKeys) ? proc.excludedCvKeys : [];
            let teamRows = '';
            teamMembers.forEach((member, idx) => {
                const memberCv = (cvData.allTeamCvs || cvData.groupMembers || []).find(cv => this.cvMatches(cv, member.name, member.lattesId));
                const hasFullCvData = !!(memberCv && this.isFullCv(memberCv));
                
                const memberKey = member.lattesId || member.name;
                const isExcluded = excludedCvKeys.includes(memberKey) || excludedCvKeys.includes(member.name);
                const isIncluded = !isExcluded;

                const memberLattes = member.lattesId ? `http://lattes.cnpq.br/${this._esc(member.lattesId)}` : (member.cvLink || '#');
                // No modo "Backup Local" o clique abre a cópia salva do CV em vez do lattes.cnpq.br
                const cvLinkAttrs = `class="cv-lattes-link" data-cv-key="${this._esc(this._memberCvBlobKey(member.lattesId, member.name))}" data-proc-id="${this._esc(proc.processId || '')}"`;
                const cvBolsa = memberCv ? (memberCv.fellowshipString || memberCv.bolsa) : '';
                const displayBolsa = (cvBolsa && cvBolsa !== '-') ? cvBolsa : (member.bolsa || '-');
                const roleAndFormacao = member.formacao ? `${member.role} - ${member.formacao}` : member.role;

                const cellStyle = hasFullCvData
                    ? (isIncluded
                        ? 'background: #E8F5E9; border: 1px solid #A5D6A7; color: #1B5E20; font-weight: bold; text-align: center;'
                        : 'background: #FFF3E0; border: 1px solid #FFE082; color: #E65100; font-weight: bold; text-align: center;')
                    : 'background: #FFEBEE; border: 1px solid #EF9A9A; color: #C62828; font-weight: bold; text-align: center;';

                const statusIconHtml = hasFullCvData
                    ? (memberLattes !== '#' ? `<a href="${memberLattes}" ${cvLinkAttrs} target="_blank" style="color: ${isIncluded ? '#2E7D32' : '#E65100'}; text-decoration: none; font-size: 1.1em; font-weight: bold;" title="CV Completo no Banco de Dados (Clique para abrir)">✔ <span class="cv-link-icon">🔗</span></a>` : '✔')
                    : (memberLattes !== '#' ? `<a href="${memberLattes}" ${cvLinkAttrs} target="_blank" style="color: #C62828; text-decoration: none; font-size: 1.1em; font-weight: bold;" title="CV Pendente na DB / Sem dados completos (Clique para abrir no Lattes)">✖ <span class="cv-link-icon">🔗</span></a>` : '✖');

                const cellStatusHtml = hasFullCvData
                    ? `<label style="cursor: pointer; display: inline-flex; align-items: center; gap: 6px;" title="${isIncluded ? 'Incluído no consolidado (Desmarque para desconsiderar do relatório)' : 'Desconsiderado do consolidado (Marque para incluir no relatório)'}">
                         <input type="checkbox" class="chk-include-cv" data-member-key="${this._esc(memberKey)}" data-member-name="${this._esc(member.name)}" ${isIncluded ? 'checked' : ''} style="cursor: pointer; width: 15px; height: 15px; accent-color: #2E7D32;">
                         <span>${statusIconHtml}</span>
                       </label>`
                    : statusIconHtml;

                // Editar/remover: os dados vao nos data-* do botao porque os handlers sao
                // ligados fora deste escopo (o relatorio e remontado a cada re-render).
                const isProponente = member.srcIdx === -1;
                const memberDataAttrs = `data-src-idx="${member.srcIdx}" data-name="${this._esc(member.name)}"`
                    + ` data-role="${this._esc(member.role || '')}" data-formacao="${this._esc(member.formacao || '')}"`
                    + ` data-bolsa="${this._esc(member.bolsa || '')}" data-inst="${this._esc(member.instituicao || '')}"`
                    + ` data-lattes="${this._esc(member.lattesId || '')}"`;
                const btnAcaoStyle = 'background: none; border: none; cursor: pointer; font-size: 1.05em; padding: 2px 4px; line-height: 1;';
                const acoesHtml = `
                    <button class="btn-edit-member" ${memberDataAttrs} style="${btnAcaoStyle}" title="Editar os dados deste membro">✏️</button>
                    ${isProponente
                        ? '<span style="opacity: 0.25; font-size: 1.05em; padding: 2px 4px;" title="O proponente não pode ser removido da proposta">🗑️</span>'
                        : `<button class="btn-del-member" ${memberDataAttrs} style="${btnAcaoStyle}" title="Remover este membro da equipe">🗑️</button>`}
                `;

                teamRows += `
                    <tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 8px; text-align: center;">${idx + 1}</td>
                        <td style="padding: 8px; text-align: left; font-weight: bold;">
                            ${this._esc(member.name)}
                            <br><span style="font-size: 0.8em; color: #1565C0; font-weight: normal;">${this._esc(roleAndFormacao)}</span>
                        </td>
                        <td style="padding: 8px; text-align: center; white-space: nowrap;">
                            <span style="background: #E8F5E9; color: #2E7D32; border: 1px solid #A5D6A7; padding: 3px 8px; border-radius: 4px; font-size: 0.85em; font-weight: bold; display: inline-block;">${this._esc(displayBolsa)}</span>
                        </td>
                        <td style="padding: 8px; text-align: left;">${this._esc(member.instituicao)}</td>
                        <td style="padding: 8px; ${cellStyle}">
                            ${cellStatusHtml}
                        </td>
                        <td class="no-print" style="padding: 8px; text-align: center; white-space: nowrap;">${acoesHtml}</td>
                    </tr>
                `;
            });

            const teamTableHtml = `
                <details open data-collapse-key="equipe-da-proposta" style="margin-bottom: 25px; background: white; border: 1px solid #BBDEFB; border-radius: 8px; padding: 15px;">
                    <summary style="color: #1565C0; margin-top: 0; border-bottom: 2px solid #1565C0; padding-bottom: 8px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; font-weight: bold; font-size: 1.1em; list-style: none;">
                        <span>👥 Equipe da Proposta (${teamMembers.length} participante(s), ${(cvData.groupMembers || []).length} CV(s) incluído(s) no consolidado) <span style="font-size: 0.8em; color: #666; font-weight: normal;">(Clique para colapsar / expandir)</span></span>
                        <button id="btn-add-member" class="no-print" style="background: #2E7D32; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.8em; font-weight: bold; display: inline-flex; align-items: center; gap: 5px;" title="Adicionar um membro que não foi extraído do PDF">
                            ➕ Adicionar Membro
                        </button>
                        <button id="btn-refresh-proc-report" style="background: #1976D2; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.8em; font-weight: bold; display: inline-flex; align-items: center; gap: 5px;" title="Atualizar dados após abrir CVs no Lattes">
                            🔄 Atualizar Relatório
                        </button>
                    </summary>
                    <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 0.9em;">
                        <thead>
                            <tr style="background: #E3F2FD; color: #0D47A1;">
                                <th style="padding: 8px; width: 40px; text-align: center;">#</th>
                                <th style="padding: 8px; text-align: left;">Nome / Categoria</th>
                                <th style="padding: 8px; width: 100px; min-width: 90px; text-align: center; white-space: nowrap;">Bolsa</th>
                                <th style="padding: 8px; text-align: left;">Instituição</th>
                                <th style="padding: 8px; width: 110px; text-align: center;" title="DB / Usar: Marque para incluir o CV no relatório consolidado ou desmarque para desconsiderar">DB / Usar</th>
                                <th class="no-print" style="padding: 8px; width: 80px; text-align: center;" title="Editar ou remover um membro extraído de forma incorreta do PDF">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${teamRows}
                        </tbody>
                    </table>
                </details>

                <div id="member-editor-backdrop" class="no-print" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 9999; align-items: center; justify-content: center;">
                    <div style="background: #fff; border-radius: 8px; padding: 22px; width: min(520px, 92vw); max-height: 90vh; overflow: auto; box-shadow: 0 8px 30px rgba(0,0,0,0.35);">
                        <h3 id="member-editor-title" style="margin: 0 0 4px 0; color: #1565C0;">Editar membro</h3>
                        <p id="member-editor-hint" style="margin: 0 0 16px 0; font-size: 0.8em; color: #666;">Campos como aparecem na tabela de equipe do PDF da proposta.</p>
                        <div style="display: flex; flex-direction: column; gap: 12px;">
                            <label style="display: block; font-size: 0.85em; font-weight: bold; color: #37474F;">Nome<input id="member-editor-name" type="text" placeholder="Nome completo do membro" style="width: 100%; box-sizing: border-box; margin-top: 4px; padding: 7px 9px; border: 1px solid #B0BEC5; border-radius: 4px; font-size: 1em; font-weight: normal;"></label>
                            <label style="display: block; font-size: 0.85em; font-weight: bold; color: #37474F;">Categoria<input id="member-editor-role" type="text" placeholder="Pesquisador, Colaborador, Aluno..." list="member-editor-categorias" style="width: 100%; box-sizing: border-box; margin-top: 4px; padding: 7px 9px; border: 1px solid #B0BEC5; border-radius: 4px; font-size: 1em; font-weight: normal;"></label>
                            <label style="display: block; font-size: 0.85em; font-weight: bold; color: #37474F;">Formação / Titulação<input id="member-editor-formacao" type="text" placeholder="Doutorado, Mestrado..." style="width: 100%; box-sizing: border-box; margin-top: 4px; padding: 7px 9px; border: 1px solid #B0BEC5; border-radius: 4px; font-size: 1em; font-weight: normal;"></label>
                            <label style="display: block; font-size: 0.85em; font-weight: bold; color: #37474F;">Bolsa<input id="member-editor-bolsa" type="text" placeholder="PQ 1D, sem bolsa..." style="width: 100%; box-sizing: border-box; margin-top: 4px; padding: 7px 9px; border: 1px solid #B0BEC5; border-radius: 4px; font-size: 1em; font-weight: normal;"></label>
                            <label style="display: block; font-size: 0.85em; font-weight: bold; color: #37474F;">Instituição / Departamento<input id="member-editor-inst" type="text" placeholder="Instituição do membro" style="width: 100%; box-sizing: border-box; margin-top: 4px; padding: 7px 9px; border: 1px solid #B0BEC5; border-radius: 4px; font-size: 1em; font-weight: normal;"></label>
                            <label style="display: block; font-size: 0.85em; font-weight: bold; color: #37474F;">ID Lattes<input id="member-editor-lattes" type="text" placeholder="16 dígitos (opcional)" style="width: 100%; box-sizing: border-box; margin-top: 4px; padding: 7px 9px; border: 1px solid #B0BEC5; border-radius: 4px; font-size: 1em; font-weight: normal;"></label>
                        </div>
                        <p id="member-editor-error" style="display: none; margin: 12px 0 0 0; color: #C62828; font-size: 0.85em; font-weight: bold;"></p>
                        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
                            <button id="member-editor-cancel" style="padding: 8px 16px; border: 1px solid #B0BEC5; background: #fff; border-radius: 4px; cursor: pointer; font-weight: bold;">Cancelar</button>
                            <button id="member-editor-save" style="padding: 8px 16px; border: none; background: #2E7D32; color: #fff; border-radius: 4px; cursor: pointer; font-weight: bold;">💾 Salvar</button>
                        </div>
                    </div>
                </div>

                <datalist id="member-editor-categorias">
                    <option value="Pesquisador"></option>
                    <option value="Pesquisador Estrangeiro"></option>
                    <option value="Colaborador"></option>
                    <option value="Técnico"></option>
                    <option value="Aluno"></option>
                </datalist>
            `;

            const foundCount = (cvData.groupMembers || []).length;
            const totalCount = teamMembers.length;
            hasGroupCvs = foundCount > 0 || cvData._fonte === 'producoes';

            // ---- Quadro Geral: totais por categoria ----
            // Usa o quadro do proprio PDF da proposta (contagem oficial do CNPq). Se ele
            // nao tiver sido capturado, calcula a partir das categorias dos membros extraidos.
            let quadroLinhas = Array.isArray(proc.quadroGeral) ? proc.quadroGeral.filter(q => q && q.categoria) : [];
            let quadroOrigem = 'PDF da proposta';
            if (quadroLinhas.length === 0 && Array.isArray(teamMembers) && teamMembers.length > 0) {
                const contagem = {};
                teamMembers.forEach(m => {
                    // nesta lista a categoria vem em "role" (o proponente entra como
                    // "Proponente / Coordenador"); "categoria" fica como alternativa
                    const bruto = m && (m.role || m.categoria);
                    const cat = bruto ? String(bruto).trim() : 'Sem categoria';
                    contagem[cat] = (contagem[cat] || 0) + 1;
                });
                quadroLinhas = Object.keys(contagem).sort().map(c => ({ categoria: c, quantidade: contagem[c] }));
                quadroOrigem = 'calculado a partir da equipe extraída';
            }

            // Ordem fixa das colunas: proponente, pesquisador, colaborador, pesquisador
            // estrangeiro, tecnico, [categorias nao previstas] e Aluno sempre por ultimo.
            const semAcento = (c) => String(c || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
            const ordemCategoria = (cat) => {
                const c = semAcento(cat);
                if (c.startsWith('proponente') || c.startsWith('coordenador')) return 0;
                if (c.includes('estrangeir')) return 3;        // pesquisador estrangeiro
                if (c.startsWith('tecnic')) return 4;
                if (c.startsWith('aluno')) return 6;           // sempre no fim
                if (c.startsWith('colaborador')) return 2;
                if (c.startsWith('pesquisador')) return 1;
                return 5;                                      // demais, antes de Aluno
            };
            // O Quadro Geral do PDF conta so a equipe: o coordenador nao aparece como
            // categoria e a soma ficava uma pessoa abaixo do total de participantes.
            // Acrescentamos a coluna do coordenador, a menos que o quadro ja o inclua
            // (categoria propria, ou soma que ja bate com o total da equipe).
            const totalEquipe = Array.isArray(teamMembers) ? teamMembers.length : 0;
            if (quadroLinhas.length > 0 && proponenteName) {
                const temCoordenador = quadroLinhas.some(q => ordemCategoria(q.categoria) === 0);
                const somaQuadro = quadroLinhas.reduce((soma, q) => soma + (Number(q.quantidade) || 0), 0);
                if (!temCoordenador && somaQuadro !== totalEquipe) {
                    quadroLinhas = quadroLinhas.concat([{ categoria: 'Coordenador', quantidade: 1 }]);
                }
            }

            quadroLinhas = quadroLinhas.slice().sort((a, b) => {
                const d = ordemCategoria(a.categoria) - ordemCategoria(b.categoria);
                return d !== 0 ? d : String(a.categoria).localeCompare(String(b.categoria), 'pt-BR');
            });


            let quadroGeralHtml = '';
            if (quadroLinhas.length > 0) {
                const totalParticipantes = quadroLinhas.reduce((soma, q) => soma + (Number(q.quantidade) || 0), 0);
                const colunas = quadroLinhas.map(q => `
                    <th style="padding: 8px 12px; text-align: center; border-left: 1px solid #BBDEFB; font-weight: bold; white-space: nowrap;">${this._esc(q.categoria)}</th>`).join('');
                const valores = quadroLinhas.map(q => `
                    <td style="padding: 10px 12px; text-align: center; border-left: 1px solid #E3F2FD; font-size: 1.25em; font-weight: bold; color: #0D47A1;">${this._esc(String(q.quantidade))}</td>`).join('');

                // ---- Distribuição por instituição ----
                // Agrupa por cadeia EXATA: os nomes chegam do PDF em grafias diversas
                // (com e sem departamento, sigla, acentuação irregular) e casá-las
                // automaticamente erra mais do que acerta. Para unir duas grafias, o
                // revisor corrige o nome pelo ✏️ da tabela de equipe acima — assim a
                // ligação entre membro e instituição nunca se perde.
                const chaveCat = (c) => semAcento(c);
                const colunasInfo = quadroLinhas.map((q, i) => ({ i, chave: chaveCat(q.categoria), bucket: ordemCategoria(q.categoria) }));
                // casa a categoria do membro com uma coluna: primeiro pelo nome, depois
                // pela familia (Pesquisador/Pesquisadores caem na mesma), e só quando ela
                // identifica uma coluna sozinha
                const colunaDoMembro = (m) => {
                    const bruto = (m && (m.role || m.categoria)) || '';
                    const exata = colunasInfo.find(x => x.chave === chaveCat(bruto));
                    if (exata) return exata.i;
                    const mesmos = colunasInfo.filter(x => x.bucket === ordemCategoria(bruto));
                    return mesmos.length === 1 ? mesmos[0].i : -1;
                };

                // A sede e a instituicao do coordenador, e nao o campo instituicaoExecutora
                // da proposta. Os dois saem de blocos diferentes do PDF, com formatos
                // diferentes ("Nome - SIGLA, UF, Brasil" no bloco INSTITUICOES ENVOLVIDAS
                // contra "Nome / Departamento-SIGLA-UF-Brasil-" na tabela de equipe): em
                // 11 propostas de amostra, nenhuma casava por cadeia exata. Pelo
                // coordenador a marcacao e exata por construcao, porque e a mesma cadeia
                // que agrupou a linha dele.
                const membroCoord = teamMembers.find(m => m && m.srcIdx === -1);
                const executora = membroCoord ? (String(membroCoord.instituicao || '').trim() || '-') : '';
                const porInstituicao = new Map();
                teamMembers.forEach(m => {
                    const nome = String(m.instituicao || '').trim() || '-';
                    if (!porInstituicao.has(nome)) {
                        porInstituicao.set(nome, { total: 0, cols: new Array(quadroLinhas.length).fill(0) });
                    }
                    const reg = porInstituicao.get(nome);
                    reg.total++;
                    const ci = colunaDoMembro(m);
                    if (ci >= 0) reg.cols[ci]++;
                });

                const linhasInst = [...porInstituicao.entries()].sort((a, b) => {
                    const ea = !!executora && a[0] === executora;
                    const eb = !!executora && b[0] === executora;
                    if (ea !== eb) return ea ? -1 : 1;              // a do coordenador no topo
                    if (b[1].total !== a[1].total) return b[1].total - a[1].total;
                    return String(a[0]).localeCompare(String(b[0]), 'pt-BR');
                });

                const corpoInst = linhasInst.map(([nome, reg], pos) => {
                    const ehExecutora = !!executora && nome === executora;
                    // a primeira linha carrega o separador que a destaca dos totais
                    const separador = pos === 0 ? ' border-top: 3px double #90CAF9;' : '';
                    const celulas = reg.cols.map(n => `
                        <td style="padding: 6px 12px; text-align: center; border-left: 1px solid #E3F2FD; color: ${n ? '#0D47A1' : '#CFD8DC'};${separador}">${n || '–'}</td>`).join('');
                    return `
                        <tr style="border-bottom: 1px solid #f0f0f0;${ehExecutora ? ' background: #F1F8E9;' : ''}">
                            <td style="padding: 6px 12px; text-align: left; font-size: 0.95em;${separador}" title="${this._esc(nome)}">
                                ${ehExecutora ? '<span style="background: #C8E6C9; color: #1B5E20; border: 1px solid #A5D6A7; font-weight: bold; padding: 0 6px; border-radius: 10px; font-size: 0.75em; margin-right: 6px;" title="Instituição do coordenador — sede da proposta">🏛️ sede</span>' : ''}${this._esc(nome)}
                            </td>
                            ${celulas}
                            <td style="padding: 6px 12px; text-align: center; border-left: 2px solid #90CAF9; font-weight: bold; color: #1B5E20;${separador}">${reg.total}</td>
                        </tr>`;
                }).join('');

                quadroGeralHtml = `
                <details open data-collapse-key="quadro-geral-da-equipe" style="margin-bottom: 25px; background: white; border: 1px solid #BBDEFB; border-radius: 8px; padding: 15px;">
                    <summary style="color: #1565C0; font-weight: bold; font-size: 1.05em; cursor: pointer; list-style: none; user-select: none;">
                        👥 Quadro Geral da Equipe
                        <span style="font-size: 0.8em; color: #666; font-weight: normal;">(${this._esc(quadroOrigem)})</span>
                        ${(totalEquipe > 0 && totalParticipantes !== totalEquipe) ? `
                        <div style="margin-top: 6px; font-size: 0.8em; font-weight: normal; color: #E65100;" title="A extração do PDF pode ter perdido ou duplicado membros da equipe">
                            ⚠️ A soma (${totalParticipantes}) não confere com os ${totalEquipe} participantes listados na tabela de equipe.
                        </div>` : ''}
                    </summary>
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.9em; margin-top: 10px;">
                        <thead>
                            <tr style="background: #E3F2FD; color: #0D47A1;">
                                <th style="padding: 8px 12px; text-align: left; white-space: nowrap;">Instituição</th>
                                ${colunas}
                                <th style="padding: 8px 12px; text-align: center; border-left: 2px solid #90CAF9; white-space: nowrap;">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr style="background: #FAFCFF;">
                                <td style="padding: 10px 12px; text-align: left; color: #0D47A1; font-weight: bold;">Nº de participantes</td>
                                ${valores}
                                <td style="padding: 10px 12px; text-align: center; border-left: 2px solid #90CAF9; font-size: 1.25em; font-weight: bold; color: #1B5E20; background: #E8F5E9;">${totalParticipantes}</td>
                            </tr>
                            ${corpoInst}
                        </tbody>
                    </table>
                </details>`;
            }

            // ---- Cabecalho do relatorio consolidado + escolha da fonte ----
            const fonteProducoes = cvData._fonte === 'producoes';
            const temProducoes = cvData._temProducoes === true;
            const anosFonte = cvData._fonteAnos || {};
            const seletorFonte = temProducoes ? `
                <div class="no-print" style="display: flex; align-items: center; gap: 8px; background: #ffffff; border: 1px solid #90CAF9; padding: 5px 12px; border-radius: 20px; font-size: 0.85em; white-space: nowrap;">
                    <span style="font-weight: bold; color: #0D47A1;">Fonte:</span>
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 4px; font-weight: bold; color: ${cvData._temCvs ? '#1565C0' : '#9e9e9e'};" title="${cvData._temCvs ? 'Usar os currículos Lattes da equipe salvos no banco' : 'Nenhum CV da equipe está salvo no banco'}">
                        <input type="radio" name="fonte-relatorio" value="cvs" ${fonteProducoes ? '' : 'checked'} ${cvData._temCvs ? '' : 'disabled'} style="cursor: pointer; accent-color: #1565C0;"> 👥 CVs da equipe
                    </label>
                    <label style="cursor: pointer; display: flex; align-items: center; gap: 4px; font-weight: bold; color: #00838F;" title="Usar a página &quot;Produções e Orientações&quot; do proponente (últimos 10 anos)">
                        <input type="radio" name="fonte-relatorio" value="producoes" ${fonteProducoes ? 'checked' : ''} style="cursor: pointer; accent-color: #00838F;"> 📚 Produções
                    </label>
                </div>` : '';

            let integratedReportTitleHtml;
            if (fonteProducoes) {
                const faixaAnos = (anosFonte.min && anosFonte.max) ? `${anosFonte.min}–${anosFonte.max}` : '';
                integratedReportTitleHtml = `
                <div style="background: #E0F7FA; border: 1px solid #80DEEA; border-radius: 8px; padding: 15px 20px; margin: 25px 0 20px 0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                    <div>
                        <h2 style="margin: 0; color: #006064; font-size: 1.3em; display: flex; align-items: center; gap: 8px;">
                            <span>📚 Relatório de Produção do Proponente</span>
                        </h2>
                        <div style="margin-top: 5px; color: #00838F; font-size: 0.95em;">
                            Gerado a partir da página <strong>Produções e Orientações</strong> de
                            <strong>${this._esc(cvData._fonteNome || proponenteName)}</strong>${faixaAnos ? ` — produção de <strong>${faixaAnos}</strong>` : ''}.
                            ${cvData._temCvs ? '' : 'Nenhum integrante tem currículo no banco; para o consolidado da equipe, abra os CVs pelos links 🔗 da tabela acima.'}
                        </div>
                        <div style="margin-top: 4px; color: #00838F; font-size: 0.82em; opacity: 0.9;">
                            Esta fonte não traz citações por artigo, Scopus, orientações em andamento nem trabalhos em eventos.${cvData._fonteDuplicatas > 0 ? ` <span style="color: #c62828; font-weight: 700;">${cvData._fonteDuplicatas} linha(s) repetida(s) da página (mesmo artigo com o nome do periódico por extenso e abreviado) foram unificadas.</span>` : ''}
                        </div>
                    </div>
                    ${seletorFonte}
                </div>`;
            } else if (foundCount > 0) {
                integratedReportTitleHtml = `
                <div style="background: #E3F2FD; border: 1px solid #90CAF9; border-radius: 8px; padding: 15px 20px; margin: 25px 0 20px 0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                    <div>
                        <h2 style="margin: 0; color: #0D47A1; font-size: 1.3em; display: flex; align-items: center; gap: 8px;">
                            <span>📊 Relatório Integrado de Produção Científica da Equipe</span>
                        </h2>
                        <div style="margin-top: 5px; color: #1565C0; font-size: 0.95em;">
                            Estatísticas agregadas considerando <strong>${foundCount} de ${totalCount} membro(s)</strong> da equipe com Currículo Lattes cadastrado no Banco de Dados.
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                        ${seletorFonte}
                        <span style="background: #1565C0; color: white; padding: 6px 14px; border-radius: 20px; font-weight: bold; font-size: 0.9em;">
                            ${foundCount} CV(s) na DB
                        </span>
                    </div>
                </div>`;
            } else {
                integratedReportTitleHtml = `
                <div style="background: #FFF3E0; border: 1px solid #FFE0B2; border-radius: 8px; padding: 18px 22px; margin: 25px 0 20px 0; display: flex; align-items: center; gap: 15px; flex-wrap: wrap;">
                    <div style="font-size: 2.2em; line-height: 1;">⚠️</div>
                    <div style="flex: 1 1 320px; min-width: 0;">
                        <h3 style="margin: 0; color: #E65100; font-size: 1.15em;">Nenhum Currículo Lattes Cadastrado no Banco de Dados</h3>
                        <div style="margin-top: 5px; color: #D84315; font-size: 0.95em;">
                            Nenhum dos <strong>${totalCount} integrante(s)</strong> da proposta possui currículo no Banco de Dados. Clique nos links 🔗 da tabela acima para abrir os CVs e salvar seus dados na DB.
                        </div>
                    </div>
                    ${seletorFonte}
                </div>`;
            }

            const reviewerNotesHtml = `
                <details ${(proc.reviewerNotes || '').trim() ? 'open' : ''} data-collapse-key="anotacoes-do-parecerista" style="margin-bottom: 25px; background: #FFFDE7; border: 1px solid #FFE082; border-radius: 8px; padding: 15px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <summary style="color: #F57F17; margin-top: 0; padding-bottom: 4px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-weight: bold; font-size: 1.1em; list-style: none; user-select: none;">
                        <span>📝 Anotações do Revisor <span style="font-size: 0.8em; color: #795548; font-weight: normal;">(Campo de texto livre - Clique para colapsar/expandir)</span></span>
                        <span id="reviewer-notes-status" style="font-size: 0.8em; color: #2E7D32; font-weight: bold; display: none; background: #E8F5E9; padding: 2px 8px; border-radius: 10px; border: 1px solid #A5D6A7;">✓ Salvo</span>
                    </summary>
                    <div style="margin-top: 12px;">
                        <textarea id="reviewer-notes-textarea" placeholder="Digite aqui suas anotações livres, parecer prévio, notas técnicas ou observações sobre este projeto..." style="width: 100%; height: 120px; padding: 10px; border: 1px solid #FFCA28; border-radius: 6px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 14px; outline: none; resize: vertical; box-sizing: border-box; background: #ffffff; color: #333; line-height: 1.4;"></textarea>
                    </div>
                </details>
            `;

            projectHeaderHtml = `
                <div style="background: #1565C0; color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: nowrap; gap: 20px;">
                    <div style="flex: 1 1 auto; min-width: 0; overflow-wrap: break-word;">
                        <h1 style="margin: 0; font-size: 1.6em;">📁 Relatório da Proposta: ${this._esc(proc.processId || 'Proposta')}</h1>
                        <div style="margin-top: 8px; font-size: 1em; opacity: 0.95;">
                            <strong>Proponente:</strong> ${this._esc(proponenteName)} ${prop.bolsa && prop.bolsa !== '-' ? `<span style="background: #E8F5E9; color: #1B5E20; padding: 2px 6px; border-radius: 4px; font-size: 0.85em; font-weight: bold; margin-left: 4px;">🎖️ Bolsa: ${this._esc(prop.bolsa)}</span>` : ''} &nbsp;|&nbsp; <strong>Instituição:</strong> ${this._esc(inst)}
                        </div>
                        ${proc.instituicaoExecutora ? `<div style="margin-top: 4px; font-size: 0.9em; opacity: 0.95;">🏛️ <strong>Instituição Executora/Sede:</strong> ${this._esc(proc.instituicaoExecutora)}</div>` : ''}
                        ${(proc.edital || (proc.faixa && proc.faixa !== '-')) ? `<div style="margin-top: 4px; font-size: 0.85em; opacity: 0.85;">${proc.edital ? `📜 <strong>Edital:</strong> ${this._esc(proc.edital)}` : ''}${(proc.edital && proc.faixa && proc.faixa !== '-') ? ' &nbsp;|&nbsp; ' : ''}${(proc.faixa && proc.faixa !== '-') ? `🎯 <strong>Faixa:</strong> ${this._esc(proc.faixa)}` : ''}</div>` : ''}
                        ${parecerTecnicoHTML}
                    </div>
                    <div id="proc-header-actions" class="no-print" style="flex: 0 0 320px; width: 320px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; justify-content: flex-end;">
                        ${procNavHTML}
                        <button id="btn-print-report" style="padding: 8px 15px; background: #7f8c8d; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">🖨️ Imprimir</button>
                        <button id="btn-back-proc-db" style="padding: 8px 15px; background: #ffffff; color: #1565C0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">⬅️ Voltar às Propostas</button>
                        ${prioridadeHTML}
                    </div>
                </div>
                ${filesHtml}
                ${pareceresAdHocHtml}
                ${reviewerNotesHtml}
                ${teamTableHtml}
                ${quadroGeralHtml}
                ${integratedReportTitleHtml}
            `;

            // Pareceres Ad-Hoc - accessed via top documents card buttons (${filesHtml})
            reviewsHtml = '';
        }

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

        // A pagina de producoes cobre uma janela curta (uns 10 anos). Os campos de
        // periodo das listas vem com 5 anos, o que esconderia metade dos dados: para
        // esta fonte eles passam a cobrir toda a extensao disponivel. Uma vez que o
        // usuario mexa no campo, a escolha dele e mantida.
        if (cvData._fonte === 'producoes' && !this._periodoProducoesAjustado) {
            const anos = cvData._fonteAnos || {};
            if (anos.min && anos.max && anos.max >= anos.min) {
                const extensao = anos.max - anos.min + 1;
                if (state.pubListYears === 5) state.pubListYears = extensao;
                if (state.journalYears === 5) state.journalYears = extensao;
            }
            this._periodoProducoesAjustado = true;
        }
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
        const ehRelatorioDeProposta = !!(parentGroupData && (parentGroupData.processId || parentGroupData.isProcesso));
        if (sortedDb && sortedDb.length > 1 && !cvData.name.startsWith('Grupo:') && !ehRelatorioDeProposta) {
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

        // Renderiza ja com o estado salvo para nao haver salto de layout; o passe geral
        // logo apos o render confirma o mesmo valor.
        const filtersCollapsed = (this.reportCollapsed || {})[this._chaveColapso('Limiares e Filtros')] === true;

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
                            ${(cvData.name.startsWith('Grupo:') || !cvData.lattesId) ? '' : `ID Lattes: <a href="http://lattes.cnpq.br/${this._esc(cvData.lattesId)}" target="_blank" style="color: #1565C0; text-decoration: none;">${this._esc(cvData.lattesId)}</a> &nbsp;&middot;&nbsp; `}Sincronizado em: ${new Date(cvData.dateAdded).toLocaleDateString()}
                        </div>
                    </div>
                    <div>
                        ${navButtonsHTML}
                        <button id="btn-print-report" style="padding: 8px 15px; background: #7f8c8d; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; margin-right: 10px;" title="Imprime as seções abertas, com tabelas e listas em toda a extensão">🖨️ Imprimir</button>
                        <button id="btn-back-db" style="padding: 8px 15px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">⬅️ Voltar</button>
                    </div>
                </div>
            </div>
        `;

        const reportFiltersHTML = `
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
                if (['prioridade', 'faixa', 'instituicaoExecutora', 'teamCount', 'reviewCount', 'ridPublications', 'customId', 'researcherIdLink', 'firstAuthorCount', 'lastAuthorCount', 'gcCount'].includes(m.key)) return;
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
                    if (['prioridade', 'faixa', 'instituicaoExecutora', 'teamCount', 'reviewCount', 'ridPublications', 'customId', 'researcherIdLink', 'firstAuthorCount', 'lastAuthorCount', 'gcCount'].includes(m.key)) return;
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

        // ---- Matriz de coautoria ----
        // Aqui vai so o esqueleto da secao: a tabela e montada sob demanda pelo listener,
        // como a Lista de Publicacoes, para o filtro de anos refazer a conta sem remontar
        // o relatorio inteiro. O calculo mora em _matrizCoautoria.
        const temEquipeParaCoautoria = Array.isArray(cvData.groupMembers) && cvData.groupMembers.length > 1;
        const matrizCoautoriaHTML = !temEquipeParaCoautoria ? '' : `
                    <div class="collapsible-section" id="sec-coautoria">
                        <div class="collapsible-header" id="header-coautoria" data-collapse-key="matriz-de-coautoria">
                            <div style="display: flex; align-items: center; gap: 15px;">
                                <h3 style="margin: 0;">Matriz de Coautoria</h3>
                                <div class="jcr-stop-propagation" style="font-size: 0.9em; font-weight: normal; margin-top: 2px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                                    <span>Período (anos): <input type="number" id="inp-coautoria-anos" value="${state.coautoriaAnos !== undefined ? state.coautoriaAnos : 0}" min="0" style="width: 50px; padding: 2px;" title="0 considera toda a carreira"></span>
                                    <button id="btn-coautoria-update" class="no-print" style="padding: 2px 8px; cursor: pointer; border-radius: 3px; border: 1px solid #ccc; background: #fff;">Atualizar</button>
                                </div>
                            </div>
                            <span class="toggle-icon">[+]</span>
                        </div>
                        <div class="collapsible-content" style="display: none;" id="content-coautoria">
                            <div id="coautoria-container" style="padding: 15px; border: 1px solid #eee; background: #fafafa; border-radius: 4px; overflow-x: auto;">
                                <div style="color: #777; text-align: center;">Carregando...</div>
                            </div>
                        </div>
                    </div>`;

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
                        #btn-back-proc-db, #btn-prev-proc, #btn-next-proc, #proc-header-actions,
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
                    ${projectHeaderHtml ? projectHeaderHtml : headerHTML}
                    ${(!projectHeaderHtml || hasGroupCvs) ? reportFiltersHTML : ''}
                    
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
                    
                    ${(hasGroupCvs && (ridTableHTML !== '' || citationTableHTML !== '')) ? `
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
                    
                    ${(hasGroupCvs && supervisionTableHTML !== '') ? `
                    <div class="collapsible-section" id="sec-supervisions">
                        <div class="collapsible-header">
                            <h3>Orientações</h3>
                            <span class="toggle-icon">[-]</span>
                        </div>
                        <div class="collapsible-content">
                            ${supervisionTableHTML}
                        </div>
                    </div>` : ''}
                    
                    ${(hasGroupCvs && patentTableHTML !== '') ? `
                    <div class="collapsible-section" id="sec-patents">
                        <div class="collapsible-header">
                            <h3>Patentes</h3>
                            <span class="toggle-icon">[-]</span>
                        </div>
                        <div class="collapsible-content">
                            ${patentTableHTML}
                        </div>
                    </div>` : ''}

                    ${(hasGroupCvs && eventTableHTML !== '') ? `
                    <div class="collapsible-section" id="sec-events">
                        <div class="collapsible-header">
                            <h3>Participação em Eventos</h3>
                            <span class="toggle-icon">[-]</span>
                        </div>
                        <div class="collapsible-content">
                            ${eventTableHTML}
                        </div>
                    </div>` : ''}

                    ${reviewsHtml}

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
                                <div class="jcr-stop-propagation" style="font-size: 0.9em; font-weight: normal; margin-top: 2px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
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
                                <div class="jcr-stop-propagation" style="font-size: 0.9em; font-weight: normal; margin-top: 2px;">
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

                    ${matrizCoautoriaHTML}

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

        const btnBackProc = doc.getElementById('btn-back-proc-db');
        if (btnBackProc) {
            btnBackProc.addEventListener('click', () => {
                this.viewDB(newTab, { processOnly: true });
            });
        }

        const btnOpenFolder = doc.getElementById('btn-open-project-folder');
        if (btnOpenFolder) {
            btnOpenFolder.addEventListener('click', (e) => {
                e.preventDefault();
                const folder = btnOpenFolder.getAttribute('data-folder');
                if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                    chrome.runtime.sendMessage({ action: 'open_folder', folder });
                }
            });
        }

        const refreshProcBtn = doc.getElementById('btn-refresh-proc-report');
        if (refreshProcBtn && parentGroupData) {
            refreshProcBtn.addEventListener('click', async () => {
                const freshDb = await this.getDB(true);
                const freshProc = freshDb.find(p => p.processId === parentGroupData.processId) || parentGroupData;
                this.renderProcessReport(freshProc, newTab, sortedDb);
            });
        }

        const notesTextarea = doc.getElementById('reviewer-notes-textarea');
        const notesStatus = doc.getElementById('reviewer-notes-status');
        if (notesTextarea && parentGroupData) {
            notesTextarea.value = parentGroupData.reviewerNotes || '';
            
            let saveTimeout = null;
            notesTextarea.addEventListener('input', () => {
                if (saveTimeout) clearTimeout(saveTimeout);
                saveTimeout = setTimeout(async () => {
                    parentGroupData.reviewerNotes = notesTextarea.value;
                    if (typeof window !== 'undefined' && window.JCRDBTools && typeof window.JCRDBTools.saveCVs === 'function') {
                        await window.JCRDBTools.saveCVs([parentGroupData]);
                    }
                    if (notesStatus) {
                        notesStatus.style.display = 'inline-block';
                        setTimeout(() => { notesStatus.style.display = 'none'; }, 2000);
                    }
                }, 400);
            });
        }

        // Reading Mode helper (Online vs Backup Local)
        const getDocSourceMode = () => {
            const checkedRadio = doc.querySelector('input[name="doc-source-mode"]:checked');
            return checkedRadio ? checkedRadio.value : 'online';
        };

        // Dynamic Mode Switcher for Document Buttons Labels
        const modeRadios = doc.querySelectorAll('input[name="doc-source-mode"]');
        const updateDocButtonsUI = () => {
            const currentMode = getDocSourceMode();
            const docButtons = doc.querySelectorAll('.btn-doc-item');
            docButtons.forEach(btn => {
                const onlineLabel = btn.getAttribute('data-online-label');
                const offlineLabel = btn.getAttribute('data-offline-label');
                if (currentMode === 'offline' && offlineLabel) {
                    btn.textContent = offlineLabel;
                    btn.style.opacity = '0.95';
                    btn.setAttribute('title', `Modo Backup Local: Lendo cópia local (${offlineLabel.replace(/^[^\s]+\s*/, '')})`);
                } else if (onlineLabel) {
                    btn.textContent = onlineLabel;
                    btn.style.opacity = '1';
                    btn.setAttribute('title', 'Modo On-line: Abrindo link direto da Web');
                }
            });
        };

        modeRadios.forEach(radio => {
            radio.addEventListener('change', updateDocButtonsUI);
        });

        // Modo "Backup Local": se houver cópia salva do CV, o link abre a cópia local;
        // se não houver, o link segue normalmente para o lattes.cnpq.br — apenas o ícone
        // avisa que não existe cópia local. As cópias são pré-carregadas aqui para que o
        // clique seja síncrono (abrir uma aba depois de um await pode ser bloqueado).
        const cvLinks = Array.from(doc.querySelectorAll('.cv-lattes-link'));
        const localCvs = new Map();   // data-cv-key -> HTML salvo
        const DBSelf = this;

        // Mesmo nome gerado em saveCvToMatchingProposals: curriculo_lattes_<id ou nome>.html
        const nomeArquivoCvMembro = (link) => {
            const chave = link.getAttribute('data-cv-key') || '';
            const bruto = chave.indexOf('memberCv_id:') === 0
                ? chave.slice('memberCv_id:'.length)
                : chave.slice('memberCv_nm:'.length);
            const safeId = String(bruto || 'cv').replace(/[\/\?%*:|"<>\s]/g, '_');
            return `curriculo_lattes_${safeId}.html`;
        };

        const updateCvLinkIcons = () => {
            const offline = getDocSourceMode() === 'offline';
            cvLinks.forEach(link => {
                const icon = link.querySelector('.cv-link-icon');
                if (!icon) return;
                const temCopia = localCvs.has(link.getAttribute('data-cv-key'));
                if (!offline) {
                    icon.textContent = '🔗';
                    link.setAttribute('title', 'Abrir o currículo no Lattes');
                } else if (temCopia) {
                    icon.textContent = '💾';
                    link.setAttribute('title', 'Abrir a cópia local do CV salva na pasta desta proposta');
                } else {
                    icon.textContent = '⚠';
                    link.setAttribute('title', 'Sem cópia local deste CV — o link abrirá o currículo on-line. Abra o CV uma vez na Plataforma Lattes para guardar uma cópia.');
                }
            });
        };

        if (cvLinks.length > 0) {
            const procIdCv = cvLinks[0].getAttribute('data-proc-id');
            if (procIdCv) {
                this.getProcBlobs(procIdCv).then(blobs => {
                    Object.keys(blobs || {}).forEach(k => {
                        if (k.indexOf('memberCv_') === 0) localCvs.set(k, blobs[k]);
                    });
                    updateCvLinkIcons();
                }).catch(() => {});
            }

            cvLinks.forEach(link => {
                link.addEventListener('click', async (e) => {
                    if (getDocSourceMode() !== 'offline') return;   // on-line: segue para o Lattes
                    const html = localCvs.get(link.getAttribute('data-cv-key'));
                    if (html) {
                        e.preventDefault();
                        try {
                            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
                            const url = newTab.URL ? newTab.URL.createObjectURL(blob) : URL.createObjectURL(blob);
                            newTab.open(url, '_blank');
                        } catch (err) {
                            console.warn('[dbTools] Erro ao abrir a cópia local do CV:', err);
                        }
                        return;
                    }
                    // Sem cópia no banco: procura o arquivo na pasta sincronizada e, não
                    // achando, segue para o Lattes como antes.
                    if (!DBSelf.pastaLocalDisponivel()) return;
                    e.preventDefault();
                    const destino = link.getAttribute('href');
                    const arq = await lerDaPasta(nomeArquivoCvMembro(link));
                    if (arq) {
                        pintarBotaoPasta(true);
                        try {
                            localCvs.set(link.getAttribute('data-cv-key'), await arq.text());
                            updateCvLinkIcons();
                        } catch (err) { /* abrir o arquivo nao depende disto */ }
                        abrirArquivoLocal(arq);
                    } else if (destino && destino !== '#') {
                        newTab.open(destino, '_blank');
                    }
                });
            });

            modeRadios.forEach(radio => radio.addEventListener('change', updateCvLinkIcons));
            updateCvLinkIcons();
        }

        updateDocButtonsUI();

        // ---- Pasta sincronizada (piccData) -------------------------------------
        // Passo 2 da cascata do modo "Backup Local": banco -> pasta -> origem on-line.
        // A leitura pede permissao ao Chrome, que so a concede dentro de um clique: por
        // isso lerDaPasta e chamada de dentro dos handlers dos botoes.
        const btnPasta = doc.getElementById('btn-pasta-local');
        const pintarBotaoPasta = (ligada) => {
            if (!btnPasta) return;
            btnPasta.textContent = ligada ? '📁 Pasta ligada' : '📁 Apontar pasta…';
            btnPasta.title = ligada
                ? 'Pareceres e CVs em HTML são lidos da pasta piccData sincronizada. Clique para trocar a pasta.'
                : 'Aponte a pasta piccData sincronizada para ler daqui os pareceres e CVs em HTML';
            btnPasta.style.background = ligada ? '#E8F5E9' : '#ECEFF1';
            btnPasta.style.borderColor = ligada ? '#A5D6A7' : '#B0BEC5';
            btnPasta.style.color = ligada ? '#1B5E20' : '#37474F';
        };
        if (btnPasta && this.pastaLocalDisponivel()) {
            btnPasta.style.display = '';
            this.pastaLocalHandle(false).then(h => pintarBotaoPasta(!!h)).catch(() => pintarBotaoPasta(false));
            btnPasta.addEventListener('click', async (e) => {
                e.preventDefault();
                const h = await this.escolherPastaLocal();
                pintarBotaoPasta(!!h);
                if (h) this.showToast('Pasta local conectada. Os documentos em HTML serão lidos dela.');
            });
        }

        const lerDaPasta = async (arquivo) => {
            if (!parentGroupData || !arquivo) return null;
            try {
                const f = await this.lerArquivoDaProposta(parentGroupData, arquivo, true);
                if (f) pintarBotaoPasta(true);
                return f;
            } catch (err) {
                console.warn('[dbTools] Falha ao ler da pasta sincronizada:', err);
                return null;
            }
        };

        const abrirArquivoLocal = (file) => {
            const url = newTab.URL ? newTab.URL.createObjectURL(file) : URL.createObjectURL(file);
            newTab.open(url, '_blank');
        };

        const safeProcId = parentGroupData ? String(parentGroupData.processId || 'projeto').replace(/[\/\\?%*:|"<>]/g, '-').trim() : 'projeto';
        // Mesma funcao usada na gravacao, para a mensagem apontar a pasta correta
        const localFolder = parentGroupData ? this._projectFolderPath(parentGroupData) : 'piccData/projeto';

        const base64ToBlob = (base64, mimeType = 'application/pdf') => {
            const binaryString = atob(base64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return new Blob([bytes], { type: mimeType });
        };

        // Hidrata sob demanda os conteúdos pesados guardados em jcr_proc_blob:<processId>.
        // Só preenche o que estiver faltando: o relatório é remontado a cada filtro e o
        // objeto da proposta sobrevive entre renders já hidratado.
        let blobsHydrated = false;
        const hydrateProcBlobs = async () => {
            if (blobsHydrated || !parentGroupData || !parentGroupData.processId) return;
            blobsHydrated = true;
            try {
                const blobs = await this.getProcBlobs(parentGroupData.processId);
                if (!blobs || Object.keys(blobs).length === 0) return;
                if (blobs.pdfData && !parentGroupData.pdfData) parentGroupData.pdfData = blobs.pdfData;
                if (blobs.cvHtml && !parentGroupData.cvHtml) parentGroupData.cvHtml = blobs.cvHtml;
                if (blobs.producoes && !parentGroupData.producoesHtml) parentGroupData.producoesHtml = blobs.producoes;
                if (Array.isArray(parentGroupData.reviews)) {
                    parentGroupData.reviews.forEach((rev, i) => {
                        if (rev && typeof rev === 'object' && !rev.html && blobs['review_' + i]) {
                            rev.html = blobs['review_' + i];
                        }
                    });
                }
                if (Array.isArray(parentGroupData.attachments)) {
                    parentGroupData.attachments.forEach((att, i) => {
                        if (att && !att.data && blobs['att_' + i]) att.data = blobs['att_' + i];
                    });
                }
            } catch (e) {
                console.warn('[dbTools] Falha ao carregar conteúdos salvos da proposta:', e);
            }
        };

        // 1. Proposta PDF Button
        const btnDocProposta = doc.getElementById('btn-doc-proposta');
        if (btnDocProposta && parentGroupData) {
            btnDocProposta.addEventListener('click', async (e) => {
                e.preventDefault();
                await hydrateProcBlobs();
                const mode = getDocSourceMode();
                const onlineUrl = btnDocProposta.getAttribute('data-online-url');
                const offlineFilename = btnDocProposta.getAttribute('data-offline-label')?.replace(/^[^\s]+\s*/, '') || `proposta_${safeProcId}.pdf`;

                if (mode === 'online' && onlineUrl) {
                    newTab.open(onlineUrl, '_blank');
                } else {
                    // Backup local mode: 1. Try saved base64 pdfData in IndexedDB
                    if (parentGroupData.pdfData) {
                        try {
                            const blob = base64ToBlob(parentGroupData.pdfData, 'application/pdf');
                            const blobUrl = newTab.URL ? newTab.URL.createObjectURL(blob) : URL.createObjectURL(blob);
                            newTab.open(blobUrl, '_blank');
                            return;
                        } catch (err) {
                            console.warn("[dbTools] Erro ao abrir pdfData:", err);
                        }
                    }

                    // 2. Pasta piccData sincronizada
                    const arqPdf = await lerDaPasta(offlineFilename);
                    if (arqPdf) { abrirArquivoLocal(arqPdf); return; }

                    // 3. Try fetching ArrayBuffer on-the-fly via background worker
                    if (onlineUrl && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                        try {
                            btnDocProposta.textContent = '⏳ Carregando PDF...';
                            const res = await new Promise((resolve) => {
                                chrome.runtime.sendMessage({ action: 'fetch_arraybuffer', url: onlineUrl }, (r) => resolve(r));
                            });
                            btnDocProposta.textContent = (mode === 'offline') ? btnDocProposta.getAttribute('data-offline-label') : btnDocProposta.getAttribute('data-online-label');

                            if (res && res.success && res.base64) {
                                parentGroupData.pdfData = res.base64;
                                if (typeof window !== 'undefined' && window.JCRDBTools && typeof window.JCRDBTools.saveCVs === 'function') {
                                    await window.JCRDBTools.saveCVs([parentGroupData]);
                                }
                                const blob = base64ToBlob(res.base64, 'application/pdf');
                                const blobUrl = newTab.URL ? newTab.URL.createObjectURL(blob) : URL.createObjectURL(blob);
                                newTab.open(blobUrl, '_blank');
                                return;
                            }
                        } catch (fetchErr) {
                            console.warn("[dbTools] Falha no fetch on-the-fly do PDF:", fetchErr);
                        }
                    }

                    // 3. Fallback: Display complete local folder path notice
                    this.showAlert(`📂 O arquivo PDF local desta proposta está salvo na sua pasta de Downloads:\n\nDownloads/${localFolder}/${offlineFilename}`, newTab);
                }
            });
        }

        // 2. CV Congelado Button
        const btnDocCvCongelado = doc.getElementById('btn-doc-cv-congelado');
        if (btnDocCvCongelado && parentGroupData) {
            btnDocCvCongelado.addEventListener('click', async (e) => {
                e.preventDefault();
                await hydrateProcBlobs();
                const mode = getDocSourceMode();
                const onlineUrl = btnDocCvCongelado.getAttribute('data-online-url');
                const safeLattesId = (parentGroupData.proponente && parentGroupData.proponente.lattesId) ? parentGroupData.proponente.lattesId : (parentGroupData.lattesId || 'proponente');
                const offlineFilename = `curriculo_${safeLattesId}.html`;

                if (mode === 'online' && onlineUrl) {
                    newTab.open(onlineUrl, '_blank');
                } else {
                    // Backup local mode
                    let cvHtmlText = parentGroupData.cvHtml || parentGroupData.cvContent || (parentGroupData.proponente && (parentGroupData.proponente.cvHtml || parentGroupData.proponente.cvContent));

                    // 1. If not directly in parentGroupData, check dedicated piccTools CV storage
                    if (!cvHtmlText && safeLattesId && typeof chrome !== 'undefined' && chrome.storage?.local) {
                        try {
                            const keys = [`jcr_picc_cv:id:${safeLattesId}`, `jcr_cv:${safeLattesId}`, `jcr_cv:proc:${safeLattesId}`];
                            const storageRes = await new Promise(resolve => chrome.storage.local.get(keys, resolve));
                            for (const k of keys) {
                                if (storageRes && storageRes[k]) {
                                    const entry = storageRes[k];
                                    cvHtmlText = entry.cvHtml || entry.cvContent || entry.htmlContent;
                                    if (cvHtmlText) break;
                                }
                            }
                        } catch (stErr) {
                            console.warn("[dbTools] Erro ao buscar CV no storage:", stErr);
                        }
                    }

                    // 2. Open Blob URL if HTML is available
                    if (cvHtmlText) {
                        const fnFormat = window.JCRReportUtils?.makeSelfContainedHtml || window.makeSelfContainedHtml;
                        const formattedHtml = fnFormat ? fnFormat(cvHtmlText, onlineUrl || 'http://plsql1.cnpq.br/curriculostg/') : cvHtmlText;
                        const blob = new Blob([formattedHtml], { type: 'text/html;charset=utf-8' });
                        const blobUrl = newTab.URL ? newTab.URL.createObjectURL(blob) : URL.createObjectURL(blob);
                        newTab.open(blobUrl, '_blank');
                        return;
                    }

                    // 3. Pasta piccData sincronizada
                    const arqCv = await lerDaPasta(offlineFilename);
                    if (arqCv) { abrirArquivoLocal(arqCv); return; }

                    // 4. Try fetching on-the-fly via background worker
                    if (onlineUrl && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                        try {
                            btnDocCvCongelado.textContent = '⏳ Carregando CV...';
                            const res = await new Promise((resolve) => {
                                chrome.runtime.sendMessage({ action: 'fetch_url', url: onlineUrl }, (r) => resolve(r));
                            });
                            btnDocCvCongelado.textContent = (mode === 'offline') ? btnDocCvCongelado.getAttribute('data-offline-label') : btnDocCvCongelado.getAttribute('data-online-label');

                            if (res && res.success && res.text) {
                                const fnFormat = window.JCRReportUtils?.makeSelfContainedHtml || window.makeSelfContainedHtml;
                                const formattedHtml = fnFormat ? fnFormat(res.text, onlineUrl) : res.text;
                                parentGroupData.cvHtml = formattedHtml;
                                if (typeof window !== 'undefined' && window.JCRDBTools && typeof window.JCRDBTools.saveCVs === 'function') {
                                    await window.JCRDBTools.saveCVs([parentGroupData]);
                                }
                                const blob = new Blob([formattedHtml], { type: 'text/html;charset=utf-8' });
                                const blobUrl = newTab.URL ? newTab.URL.createObjectURL(blob) : URL.createObjectURL(blob);
                                newTab.open(blobUrl, '_blank');
                                return;
                            }
                        } catch (fetchErr) {
                            console.warn("[dbTools] Falha no fetch on-the-fly do CV:", fetchErr);
                        }
                    }

                    // 4. Fallback: Display complete local folder path notice
                    this.showAlert(`📂 Cópia do CV Lattes Congelado salva na pasta de backup local:\n\nDownloads/${localFolder}/${offlineFilename}`, newTab);
                }
            });
        }

        // Troca da fonte do relatorio consolidado (CVs da equipe x pagina de producoes).
        // A escolha fica na propria proposta: cada uma pode ter a sua.
        const radiosFonte = doc.querySelectorAll('input[name="fonte-relatorio"]');
        if (radiosFonte.length > 0 && parentGroupData) {
            radiosFonte.forEach(radio => {
                radio.addEventListener('change', async () => {
                    if (!radio.checked) return;
                    parentGroupData.fonteRelatorio = radio.value;
                    if (typeof window !== 'undefined' && window.JCRDBTools
                        && typeof window.JCRDBTools.saveCVs === 'function') {
                        await window.JCRDBTools.saveCVs([parentGroupData]);
                    }
                    this.renderProcessReport(parentGroupData, newTab, sortedDb);
                });
            });
        }

        // 2b. Produções e Orientações
        const btnDocProducoes = doc.getElementById('btn-doc-producoes');
        if (btnDocProducoes && parentGroupData) {
            btnDocProducoes.addEventListener('click', async (e) => {
                e.preventDefault();
                await hydrateProcBlobs();
                const mode = getDocSourceMode();
                const onlineUrl = btnDocProducoes.getAttribute('data-online-url');
                const offlineFilename = `producoes_${safeProcId}.html`;

                const abrirHtml = (htmlText) => {
                    const fnFormat = window.JCRReportUtils?.makeSelfContainedHtml || window.makeSelfContainedHtml;
                    const formatado = fnFormat ? fnFormat(htmlText, onlineUrl || 'http://efomento.cnpq.br/efomento/') : htmlText;
                    const blob = new Blob([formatado], { type: 'text/html;charset=utf-8' });
                    const blobUrl = newTab.URL ? newTab.URL.createObjectURL(blob) : URL.createObjectURL(blob);
                    newTab.open(blobUrl, '_blank');
                };

                if (mode === 'online' && onlineUrl) {
                    newTab.open(onlineUrl, '_blank');
                    return;
                }

                // 1. cópia no banco
                if (parentGroupData.producoesHtml) { abrirHtml(parentGroupData.producoesHtml); return; }

                // 2. pasta piccData sincronizada
                const arq = await lerDaPasta(offlineFilename);
                if (arq) { abrirArquivoLocal(arq); return; }

                // 3. origem no efomento, guardando para as próximas aberturas
                if (onlineUrl && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                    const rotulo = btnDocProducoes.textContent;
                    btnDocProducoes.textContent = '⏳ Carregando produções...';
                    let res = null;
                    try {
                        res = await new Promise((resolve) => {
                            chrome.runtime.sendMessage({ action: 'fetch_url', url: onlineUrl }, (r) => resolve(r));
                        });
                    } catch (err) {
                        console.warn('[dbTools] Falha no fetch on-the-fly das produções:', err);
                    }
                    btnDocProducoes.textContent = rotulo;

                    if (res && res.success && res.text) {
                        const fnFormat = window.JCRReportUtils?.makeSelfContainedHtml || window.makeSelfContainedHtml;
                        const formatado = fnFormat ? fnFormat(res.text, onlineUrl) : res.text;
                        parentGroupData.producoesHtml = formatado;
                        try {
                            await this.saveProcBlobs(parentGroupData.processId, { producoes: formatado });
                        } catch (saveErr) {
                            console.warn('[dbTools] Falha ao guardar as produções:', saveErr);
                        }
                        abrirHtml(formatado);
                        return;
                    }
                }

                this.showAlert(`📂 Não há cópia das Produções e Orientações no banco e não foi possível buscá-las na origem.\n\nO arquivo salvo está em:\nDownloads/${localFolder}/${offlineFilename}`, newTab);
            });
        }

        // 3. Pareceres Ad-Hoc Buttons
        if (parentGroupData && Array.isArray(parentGroupData.reviews)) {
            parentGroupData.reviews.forEach((rev, idx) => {
                const btn = doc.getElementById(`btn-doc-parecer-${idx + 1}`);
                if (btn) {
                    btn.addEventListener('click', async (e) => {
                        e.preventDefault();
                        await hydrateProcBlobs();
                        const mode = getDocSourceMode();
                        const onlineUrl = (typeof rev === 'string') ? rev : (rev.link || '');
                        const offlineFilename = `parecer_${idx + 1}.html`;

                        const abrirHtml = (htmlText) => {
                            const fnFormat = window.JCRReportUtils?.makeSelfContainedHtml || window.makeSelfContainedHtml;
                            const formattedHtml = fnFormat ? fnFormat(htmlText, onlineUrl || 'https://chagas.cnpq.br/chagas/') : htmlText;
                            const blob = new Blob([formattedHtml], { type: 'text/html;charset=utf-8' });
                            const blobUrl = newTab.URL ? newTab.URL.createObjectURL(blob) : URL.createObjectURL(blob);
                            newTab.open(blobUrl, '_blank');
                        };

                        // pasta sincronizada: uma leitura so, antes da cadeia de decisao
                        const arqParecer = (mode !== 'online' && !(rev.html || rev.htmlContent))
                            ? await lerDaPasta(offlineFilename) : null;

                        if (mode === 'online' && onlineUrl) {
                            newTab.open(onlineUrl, '_blank');
                        } else if (rev.html || rev.htmlContent) {
                            abrirHtml(rev.html || rev.htmlContent);
                        } else if (arqParecer) {
                            abrirArquivoLocal(arqParecer);
                        } else if (onlineUrl && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                            // Mesmo plano B do CV congelado: sem cópia local, busca na origem
                            // e guarda, para as próximas aberturas funcionarem offline.
                            const rotulo = btn.textContent;
                            btn.textContent = '⏳ Carregando parecer...';
                            let res = null;
                            try {
                                res = await new Promise((resolve) => {
                                    chrome.runtime.sendMessage({ action: 'fetch_url', url: onlineUrl }, (r) => resolve(r));
                                });
                            } catch (fetchErr) {
                                console.warn('[dbTools] Falha no fetch on-the-fly do parecer:', fetchErr);
                            }
                            btn.textContent = rotulo;

                            if (res && res.success && res.text) {
                                rev.html = res.text;
                                try {
                                    await this.saveProcBlobs(parentGroupData.processId, { ['review_' + idx]: res.text });
                                } catch (saveErr) {
                                    console.warn('[dbTools] Falha ao guardar o parecer:', saveErr);
                                }
                                abrirHtml(res.text);
                            } else {
                                this.showAlert(`📂 Não há cópia deste Parecer Ad-Hoc no banco e não foi possível buscá-lo na origem.\n\nO arquivo salvo está em:\nDownloads/${localFolder}/${offlineFilename}`, newTab);
                            }
                        } else {
                            this.showAlert(`📂 Cópia do Parecer Ad-Hoc salvo na pasta de backup local:\nDownloads/${localFolder}/${offlineFilename}`, newTab);
                        }
                    });
                }
            });
        }

        // 4. Attachments Buttons
        if (parentGroupData && Array.isArray(parentGroupData.attachments)) {
            parentGroupData.attachments.forEach((att, idx) => {
                const btn = doc.getElementById(`btn-doc-anexo-${idx + 1}`);
                if (btn) {
                    btn.addEventListener('click', async (e) => {
                        e.preventDefault();
                        await hydrateProcBlobs();
                        const mode = getDocSourceMode();
                        const onlineUrl = att.url || '';
                        const offlineFilename = btn.getAttribute('data-offline-label')?.replace(/^[^\s]+\s*/, '') || `anexo_${idx + 1}.pdf`;

                        if (mode === 'online' && onlineUrl) {
                            newTab.open(onlineUrl, '_blank');
                        } else {
                            // Backup local mode
                            let mimeType = 'application/pdf';
                            const lowerUrl = (onlineUrl || offlineFilename).toLowerCase();
                            if (lowerUrl.includes('.zip')) mimeType = 'application/zip';
                            else if (lowerUrl.includes('.doc')) mimeType = 'application/msword';
                            else if (lowerUrl.includes('.docx')) mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                            else if (lowerUrl.includes('.png')) mimeType = 'image/png';
                            else if (lowerUrl.includes('.jpg') || lowerUrl.includes('.jpeg')) mimeType = 'image/jpeg';

                            // 1. Try saved base64 in att.data or att.base64
                            const b64Data = att.data || att.base64;
                            if (b64Data) {
                                try {
                                    const blob = base64ToBlob(b64Data, mimeType);
                                    const blobUrl = newTab.URL ? newTab.URL.createObjectURL(blob) : URL.createObjectURL(blob);
                                    newTab.open(blobUrl, '_blank');
                                    return;
                                } catch (err) {
                                    console.warn("[dbTools] Erro ao abrir anexo base64:", err);
                                }
                            }

                            // 2. Try saved HTML content if att is HTML
                            if (att.htmlContent || att.content) {
                                const htmlText = att.htmlContent || att.content;
                                const blob = new Blob([htmlText], { type: 'text/html;charset=utf-8' });
                                const blobUrl = newTab.URL ? newTab.URL.createObjectURL(blob) : URL.createObjectURL(blob);
                                newTab.open(blobUrl, '_blank');
                                return;
                            }

                            // 3. Pasta piccData sincronizada
                            const arqAnexo = await lerDaPasta(offlineFilename);
                            if (arqAnexo) { abrirArquivoLocal(arqAnexo); return; }

                            // 4. Try fetching ArrayBuffer on-the-fly via background worker
                            if (onlineUrl && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                                try {
                                    btn.textContent = '⏳ Carregando Anexo...';
                                    const res = await new Promise((resolve) => {
                                        chrome.runtime.sendMessage({ action: 'fetch_arraybuffer', url: onlineUrl }, (r) => resolve(r));
                                    });
                                    btn.textContent = (mode === 'offline') ? btn.getAttribute('data-offline-label') : btn.getAttribute('data-online-label');

                                    if (res && res.success && res.base64) {
                                        att.data = res.base64;
                                        if (typeof window !== 'undefined' && window.JCRDBTools && typeof window.JCRDBTools.saveCVs === 'function') {
                                            await window.JCRDBTools.saveCVs([parentGroupData]);
                                        }
                                        const blob = base64ToBlob(res.base64, mimeType);
                                        const blobUrl = newTab.URL ? newTab.URL.createObjectURL(blob) : URL.createObjectURL(blob);
                                        newTab.open(blobUrl, '_blank');
                                        return;
                                    }
                                } catch (fetchErr) {
                                    console.warn("[dbTools] Falha no fetch on-the-fly do anexo:", fetchErr);
                                }
                            }

                            // 4. Fallback: Display complete local folder path notice
                            this.showAlert(`📂 O arquivo de anexo local está salvo na sua pasta de Downloads:\n\nDownloads/${localFolder}/${offlineFilename}`, newTab);
                        }
                    });
                }
            });
        }

        const btnBack = doc.getElementById('btn-back-db');
        if (btnBack) {
            btnBack.addEventListener('click', () => {
                if (parentGroupData && (parentGroupData.processId || parentGroupData.isProcesso)) {
                    this.renderProcessReport(parentGroupData, newTab, sortedDb);
                } else if (parentGroupData) {
                    this.renderCVReport(parentGroupData, newTab);
                } else {
                    this.viewDB(newTab);
                }
            });
        }

        // Anterior/Proxima do relatorio de proposta. Navega pela mesma lista que gerou
        // os botoes (tabela completa ou selecao), preservando-a nas telas seguintes.
        const navegarProposta = (btn) => {
            if (!btn || !Array.isArray(sortedDb)) return;
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.getAttribute('data-navidx'), 10);
                const destino = isNaN(idx) ? null : sortedDb[idx];
                if (destino) this.renderProcessReport(destino, newTab, sortedDb);
            });
        };
        navegarProposta(doc.getElementById('btn-prev-proc'));
        navegarProposta(doc.getElementById('btn-next-proc'));

        // Prioridade escolhida no cabecalho do relatorio. Grava no mesmo campo que a
        // coluna Prioridade da tabela; como parentGroupData e o proprio objeto da
        // lista, a tabela ja volta com o valor novo sem precisar reler o banco.
        // Botao "abrir" dentro do bloco Pareceres Ad-Hoc: aciona o botao correspondente
        // do card de documentos, herdando dele toda a cadeia de decisao (on-line, copia
        // no banco, pasta sincronizada, busca na origem). preventDefault/stopPropagation
        // porque o botao mora dentro do <summary> e o clique colapsaria a secao.
        doc.querySelectorAll('.btn-abrir-parecer').forEach(btnAbrir => {
            btnAbrir.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const i = parseInt(btnAbrir.getAttribute('data-parecer-idx'), 10);
                const alvo = isNaN(i) ? null : doc.getElementById('btn-doc-parecer-' + (i + 1));
                if (alvo) alvo.click();
            });
        });

        // Pareceres importados antes desta leitura existir ficam sem resultado. Em vez
        // de obrigar a reimportar a carteira inteira, completa na abertura do relatorio
        // a partir do que ja esta a mao: a copia guardada no banco ou o arquivo na pasta
        // piccData. A leitura da pasta NAO pede permissao — apenas aproveita a que ja
        // foi concedida —, porque isso roda sozinho, sem clique do usuario.
        const completarPareceresSalvos = async () => {
            const lista = (parentGroupData && Array.isArray(parentGroupData.reviews)) ? parentGroupData.reviews : [];
            const pendente = (r) => r && typeof r === 'object' && !r.resultado && !r.avaliacaoLida;
            if (!lista.some(pendente)) return;

            await hydrateProcBlobs();

            let ganhouDados = false, mudouAlgo = false;
            for (let i = 0; i < lista.length; i++) {
                const rev = lista[i];
                if (!pendente(rev)) continue;

                let html = rev.html || rev.htmlContent || '';
                if (!html) {
                    try {
                        const arq = await this.lerArquivoDaProposta(parentGroupData, `parecer_${i + 1}.html`, false);
                        if (arq) html = await arq.text();
                    } catch (e) { /* sem pasta ou sem permissao: fica para a reimportacao */ }
                }
                if (!html) continue;

                const av = this._lerAvaliacaoParecer(html);
                rev.avaliacaoLida = true;   // ja tentamos: nao reler o arquivo a cada abertura
                mudouAlgo = true;
                if (av.resultado || av.justificativa) {
                    rev.resultado = av.resultado;
                    rev.justificativa = av.justificativa;
                    ganhouDados = true;
                }
            }

            if (!mudouAlgo) return;
            try {
                await this.saveCVs([parentGroupData]);
            } catch (e) {
                console.warn('[dbTools] Falha ao guardar a avaliação dos pareceres:', e);
            }
            // remonta so quando ha o que mostrar; na volta nenhum parecer fica pendente,
            // entao nao ha como isto se repetir
            if (ganhouDados) this.renderProcessReport(parentGroupData, newTab, sortedDb);
        };
        completarPareceresSalvos();


        const prioSelect = doc.getElementById('proc-priority-select');
        const prioStatus = doc.getElementById('proc-priority-status');
        if (prioSelect && parentGroupData) {
            prioSelect.addEventListener('change', async () => {
                parentGroupData.prioridade = prioSelect.value;
                if (typeof window !== 'undefined' && window.JCRDBTools && typeof window.JCRDBTools.saveCVs === 'function') {
                    await window.JCRDBTools.saveCVs([parentGroupData]);
                }
                if (prioStatus) {
                    prioStatus.style.display = 'inline-block';
                    setTimeout(() => { prioStatus.style.display = 'none'; }, 2000);
                }
            });
        }

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

        // Checkboxes to include/exclude CVs from consolidated proposal report
        const chkIncludeCvs = doc.querySelectorAll('.chk-include-cv');
        if (chkIncludeCvs.length > 0 && parentGroupData) {
            chkIncludeCvs.forEach(chk => {
                chk.addEventListener('change', async (e) => {
                    const memberKey = e.target.getAttribute('data-member-key');
                    const memberName = e.target.getAttribute('data-member-name');

                    if (!Array.isArray(parentGroupData.excludedCvKeys)) {
                        parentGroupData.excludedCvKeys = [];
                    }

                    if (!e.target.checked) {
                        if (memberKey && !parentGroupData.excludedCvKeys.includes(memberKey)) {
                            parentGroupData.excludedCvKeys.push(memberKey);
                        }
                        if (memberName && !parentGroupData.excludedCvKeys.includes(memberName)) {
                            parentGroupData.excludedCvKeys.push(memberName);
                        }
                    } else {
                        parentGroupData.excludedCvKeys = parentGroupData.excludedCvKeys.filter(k => k !== memberKey && k !== memberName);
                    }

                    if (typeof window !== 'undefined' && window.JCRDBTools && typeof window.JCRDBTools.saveCVs === 'function') {
                        await window.JCRDBTools.saveCVs([parentGroupData]);
                    }

                    this.renderProcessReport(parentGroupData, newTab, sortedDb);
                });
            });
        }

        // ---- Edicao manual da equipe da proposta -----------------------------------
        // O PDF vem em formatos diferentes e a extracao as vezes junta, perde ou inventa
        // membros. Estes controles corrigem a lista sem precisar reprocessar a proposta.
        const memberEditor = doc.getElementById('member-editor-backdrop');
        if (memberEditor && parentGroupData) {
            const campo = (nome) => doc.getElementById('member-editor-' + nome);
            const tituloEl = doc.getElementById('member-editor-title');
            const dicaEl = doc.getElementById('member-editor-hint');
            const erroEl = doc.getElementById('member-editor-error');

            // srcIdx: -1 proponente, >= 0 posicao em teamMembers, null inclusao
            let srcIdxAtual = null;

            const fecharEditor = () => {
                memberEditor.style.display = 'none';
                srcIdxAtual = null;
            };

            const abrirEditor = (dados, srcIdx) => {
                srcIdxAtual = srcIdx;
                const ehProponente = srcIdx === -1;
                tituloEl.textContent = srcIdx === null ? 'Adicionar membro' : 'Editar membro';
                dicaEl.textContent = ehProponente
                    ? 'Este é o proponente: mudar o nome também muda o nome da pasta local da proposta.'
                    : 'Os campos correspondem às colunas da tabela de equipe do PDF da proposta.';
                campo('name').value = dados.name || '';
                campo('role').value = ehProponente ? 'Proponente / Coordenador' : (dados.role || '');
                campo('role').disabled = ehProponente;
                campo('formacao').value = dados.formacao || '';
                campo('bolsa').value = (dados.bolsa && dados.bolsa !== '-') ? dados.bolsa : '';
                campo('inst').value = (dados.inst && dados.inst !== '-') ? dados.inst : '';
                campo('lattes').value = dados.lattes || '';
                erroEl.style.display = 'none';
                memberEditor.style.display = 'flex';
                campo('name').focus();
            };

            const persistir = async () => {
                if (typeof window !== 'undefined' && window.JCRDBTools && typeof window.JCRDBTools.saveCVs === 'function') {
                    await window.JCRDBTools.saveCVs([parentGroupData]);
                }
                fecharEditor();
                this.renderProcessReport(parentGroupData, newTab, sortedDb);
            };

            const salvar = async () => {
                const nome = campo('name').value.trim();
                if (!nome) {
                    erroEl.textContent = 'Informe o nome do membro.';
                    erroEl.style.display = 'block';
                    return;
                }
                const lattes = campo('lattes').value.replace(/[^0-9]/g, '');
                if (lattes && lattes.length !== 16) {
                    erroEl.textContent = 'O ID Lattes deve ter 16 dígitos (ou ficar vazio).';
                    erroEl.style.display = 'block';
                    return;
                }
                const jaExiste = (alvo) => {
                    const chave = alvo.toLowerCase();
                    const prop = parentGroupData.proponente || {};
                    if ((prop.name || parentGroupData.name || '').toLowerCase() === chave) return true;
                    return (parentGroupData.teamMembers || []).some((m, i) =>
                        i !== srcIdxAtual && m && (m.name || '').toLowerCase() === chave);
                };
                if (srcIdxAtual !== -1 && jaExiste(nome)) {
                    erroEl.textContent = 'Já existe um membro com esse nome nesta proposta.';
                    erroEl.style.display = 'block';
                    return;
                }

                const formacao = campo('formacao').value.trim();
                const bolsa = campo('bolsa').value.trim() || '-';
                const instituicao = campo('inst').value.trim() || '-';
                const cvLink = lattes ? ('http://lattes.cnpq.br/' + lattes) : '';

                if (srcIdxAtual === -1) {
                    if (!parentGroupData.proponente) parentGroupData.proponente = {};
                    const propAtual = parentGroupData.proponente;
                    propAtual.name = nome;
                    propAtual.formacao = formacao;
                    propAtual.bolsa = bolsa;
                    propAtual.instituicao = instituicao;
                    propAtual.lattesId = lattes;
                    propAtual.cvLink = cvLink;
                    propAtual.editado = true;   // reimportar nao sobrescreve
                    parentGroupData.lattesId = lattes;
                } else {
                    if (!Array.isArray(parentGroupData.teamMembers)) parentGroupData.teamMembers = [];
                    const dados = {
                        name: nome,
                        categoria: campo('role').value.trim() || 'Membro da Equipe',
                        formacao: formacao,
                        bolsa: bolsa,
                        instituicao: instituicao,
                        lattesId: lattes,
                        cvLink: cvLink
                    };
                    if (srcIdxAtual === null) {
                        // manual: true marca o que foi inserido a mao, para diferenciar
                        // do que veio da extracao do PDF
                        parentGroupData.teamMembers.push(Object.assign({ manual: true }, dados));
                    } else if (parentGroupData.teamMembers[srcIdxAtual]) {
                        // editado: true faz esta versao vencer numa reimportacao
                        parentGroupData.teamMembers[srcIdxAtual] =
                            Object.assign({}, parentGroupData.teamMembers[srcIdxAtual], dados, { editado: true });
                    }
                }
                await persistir();
            };

            doc.getElementById('member-editor-save').addEventListener('click', salvar);
            doc.getElementById('member-editor-cancel').addEventListener('click', fecharEditor);
            memberEditor.addEventListener('click', (e) => { if (e.target === memberEditor) fecharEditor(); });
            memberEditor.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') fecharEditor();
                else if (e.key === 'Enter' && e.target.tagName === 'INPUT') salvar();
            });

            const btnAddMember = doc.getElementById('btn-add-member');
            if (btnAddMember) {
                btnAddMember.addEventListener('click', (e) => {
                    // o botao mora no <summary>: sem isto o clique colapsaria a secao
                    e.preventDefault();
                    e.stopPropagation();
                    abrirEditor({}, null);
                });
            }

            doc.querySelectorAll('.btn-edit-member').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const b = e.currentTarget;
                    abrirEditor({
                        name: b.getAttribute('data-name'),
                        role: b.getAttribute('data-role'),
                        formacao: b.getAttribute('data-formacao'),
                        bolsa: b.getAttribute('data-bolsa'),
                        inst: b.getAttribute('data-inst'),
                        lattes: b.getAttribute('data-lattes')
                    }, parseInt(b.getAttribute('data-src-idx'), 10));
                });
            });

            doc.querySelectorAll('.btn-del-member').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const b = e.currentTarget;
                    const srcIdx = parseInt(b.getAttribute('data-src-idx'), 10);
                    const nome = b.getAttribute('data-name') || '';
                    if (isNaN(srcIdx) || srcIdx < 0) return;
                    if (!Array.isArray(parentGroupData.teamMembers) || !parentGroupData.teamMembers[srcIdx]) return;
                    if (!newTab.confirm('Remover "' + nome + '" da equipe desta proposta?')) return;

                    const removido = parentGroupData.teamMembers.splice(srcIdx, 1)[0] || {};
                    // guarda o nome apagado: sem isto, reimportar a proposta o traria de volta
                    if (!removido.manual && removido.name) {
                        if (!Array.isArray(parentGroupData.removedMembers)) parentGroupData.removedMembers = [];
                        if (!parentGroupData.removedMembers.some(n => this._chaveMembro(n) === this._chaveMembro(removido.name))) {
                            parentGroupData.removedMembers.push(removido.name);
                        }
                    }
                    // limpa a marca de "desconsiderado no consolidado" do membro removido
                    if (Array.isArray(parentGroupData.excludedCvKeys)) {
                        const chaves = [removido.lattesId, removido.name].filter(Boolean);
                        parentGroupData.excludedCvKeys =
                            parentGroupData.excludedCvKeys.filter(k => chaves.indexOf(k) === -1);
                    }
                    await persistir();
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
            const chkEl = doc.getElementById(id);
            if (chkEl) chkEl.addEventListener('change', reRender);
        });

        // Impede que cliques nos controles dentro do cabeçalho colapsável o abram/fechem
        // (antes era onclick="event.stopPropagation()" inline, bloqueado pela CSP em db.html)
        doc.querySelectorAll('.jcr-stop-propagation').forEach(el => {
            el.addEventListener('click', (e) => e.stopPropagation());
        });

        // Árvore de Orientações: expandir/recolher tipo e instituição.
        // Substitui os handlers inline gerados em report_utils.generateSupervisionTableHTML.
        doc.querySelectorAll('tr[data-sup-type]').forEach(row => {
            row.addEventListener('click', () => {
                const typeId = row.getAttribute('data-sup-type');
                const icon = row.querySelector('.type-icon');
                const isExpanding = icon && icon.textContent === '▶';
                if (isExpanding) {
                    doc.querySelectorAll(`.child-of-${typeId}`).forEach(el => el.style.display = 'table-row');
                } else {
                    doc.querySelectorAll(`.child-of-${typeId}, .child-of-${typeId}-all`).forEach(el => el.style.display = 'none');
                    doc.querySelectorAll(`.child-of-${typeId} .inst-icon`).forEach(ic => ic.textContent = '▶');
                }
                if (icon) icon.textContent = isExpanding ? '▼' : '▶';
            });
        });

        doc.querySelectorAll('tr[data-sup-inst]').forEach(row => {
            row.addEventListener('click', () => {
                const instId = row.getAttribute('data-sup-inst');
                doc.querySelectorAll(`.child-of-${instId}`).forEach(el => {
                    el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
                });
                const icon = row.querySelector('.inst-icon');
                if (icon) icon.textContent = icon.textContent === '▶' ? '▼' : '▶';
            });
        });

        // Add collapsible functionality
        // Cada bloco recebe uma chave derivada do seu titulo e grava o estado ao alternar.
        // O estado e global (nao por proposta/CV): o proximo relatorio abre igual.
        if (!this.reportCollapsed) this.reportCollapsed = {};
        doc.querySelectorAll('.collapsible-header').forEach(header => {
            const tituloEl = header.querySelector('h3');
            const chave = this._chaveColapso(tituloEl ? tituloEl.textContent : '');
            if (chave) header.setAttribute('data-collapse-key', chave);

            header.addEventListener('click', () => {
                const content = header.nextElementSibling;
                const icon = header.querySelector('.toggle-icon');
                const isHidden = content.style.display === 'none';
                
                content.style.display = isHidden ? '' : 'none';
                icon.innerText = isHidden ? '[-]' : '[+]';

                if (chave) {
                    this.reportCollapsed[chave] = !isHidden;   // acabou de recolher?
                    if (chave === this._chaveColapso('Limiares e Filtros')) {
                        this.reportFiltersCollapsed = !isHidden;   // compatibilidade
                    }
                    this.saveSettings();
                }

                // If it's a section with tables/graphs, this might help with layout if needed
                if (isHidden) {
                    // Trigger a resize if there were any dynamic layout elements
                    newTab.dispatchEvent(new Event('resize'));
                }
            });
        });

        // Blocos em <details> (Equipe da Proposta, Anotacoes) seguem a mesma memoria.
        doc.querySelectorAll('details[data-collapse-key]').forEach(det => {
            const chave = det.getAttribute('data-collapse-key');
            const salvo = this.reportCollapsed[chave];
            // aplica ANTES de ouvir o toggle: mudar det.open dispara o proprio evento
            if (salvo !== undefined) det.open = (salvo !== true);
            det.addEventListener('toggle', () => {
                const recolhido = !det.open;
                // o toggle e assincrono: o det.open acima tambem cai aqui. Sem esta
                // comparacao, cada render gravaria de novo o mesmo estado.
                if (this.reportCollapsed[chave] === recolhido) return;
                this.reportCollapsed[chave] = recolhido;
                this.saveSettings();
            });
        });

        // Matriz de coautoria: montada sob demanda, como a Lista de Publicacoes, para o
        // filtro de anos refazer a conta sem remontar o relatorio.
        const headerCoautoria = doc.getElementById('header-coautoria');
        const contentCoautoria = doc.getElementById('content-coautoria');
        const coautoriaContainer = doc.getElementById('coautoria-container');
        const inpCoautoriaAnos = doc.getElementById('inp-coautoria-anos');
        const btnCoautoriaUpdate = doc.getElementById('btn-coautoria-update');
        let coautoriaGerada = false;

        const gerarMatrizCoautoria = () => {
            if (!coautoriaContainer) return;
            const anos = parseInt(inpCoautoriaAnos && inpCoautoriaAnos.value, 10) || 0;
            state.coautoriaAnos = anos;

            // categoria e titulacao so existem quando o relatorio e de uma proposta
            const fichas = [];
            if (parentGroupData) {
                const prop = parentGroupData.proponente;
                if (prop && prop.name) {
                    fichas.push({ name: prop.name, lattesId: parentGroupData.lattesId || prop.lattesId || '', role: 'Proponente', formacao: prop.formacao || '', instituicao: prop.instituicao || '' });
                }
                (Array.isArray(parentGroupData.teamMembers) ? parentGroupData.teamMembers : []).forEach(tm => {
                    if (tm && tm.name) fichas.push({ name: tm.name, lattesId: tm.lattesId || '', role: tm.categoria || tm.role || '', formacao: tm.formacao || '', instituicao: tm.instituicao || '' });
                });
            }

            const r = this._matrizCoautoria(cvData.groupMembers, fichas, anos, currentYear);
            const gente = r.gente, m = r.m, n = gente.length;

            if (n < 2) {
                coautoriaContainer.innerHTML = '<div style="color: #777; text-align: center; padding: 10px;">São necessários ao menos dois currículos no consolidado (fora técnicos e alunos) para montar a matriz.</div>';
                coautoriaGerada = true;
                return;
            }

            const periodo = anos > 0 ? `últimos ${anos} anos` : 'toda a carreira';
            const totalPares = (n * (n - 1)) / 2;

            // realce do coordenador: linha e coluna dele, para o cruzamento ficar obvio
            const FUNDO_COORD = '#FFF8E1';
            const cabecalho = gente.map((g, i) => `
                <th style="padding: 4px 6px; text-align: center; font-size: 0.8em; border-left: 1px solid #E3F2FD; color: #0D47A1;${g.coordenador ? ` background: ${FUNDO_COORD};` : ''}" title="${this._esc(g.nome)}${g.coordenador ? ' (coordenador)' : ''}">${i + 1}</th>`).join('');

            const linhas = gente.map((g, i) => {
                const total = m[i].reduce((s, v) => s + v, 0);
                const celulas = gente.map((outro, j) => {
                    // linha vertical em toda celula: sem ela o olho perde a coluna no meio
                    // da matriz e deixa de associar o valor ao numero do cabecalho
                    const grade = 'border-left: 1px solid #E3F2FD;';
                    // a coluna do coordenador so recebe o fundo quando a celula esta vazia:
                    // com valor, a intensidade da cor e que precisa ser lida
                    const fundoColuna = (outro.coordenador && !m[i][j]) ? ` background: ${FUNDO_COORD};` : '';
                    if (i === j) return `<td style="padding: 4px 6px; text-align: center; ${grade} background: #FAFAFA; color: #BDBDBD;">—</td>`;
                    const v = m[i][j];
                    if (!v) return `<td style="padding: 4px 6px; text-align: center; ${grade} color: #E0E0E0;${fundoColuna}">·</td>`;
                    const alpha = (0.15 + 0.6 * (v / (r.maior || 1))).toFixed(2);
                    return `<td style="padding: 4px 6px; text-align: center; ${grade} font-weight: bold; color: #0D47A1; background: rgba(21,101,192,${alpha});" title="${this._esc(g.nome)} e ${this._esc(outro.nome)}: ${v} artigo(s) em comum">${v}</td>`;
                }).join('');
                const selo = g.coordenador
                    ? '<span style="background: #FFE082; color: #E65100; border: 1px solid #FFCC80; font-weight: bold; padding: 0 6px; border-radius: 10px; font-size: 0.72em; margin-right: 6px;" title="Proponente / coordenador da proposta">coord.</span>'
                    : '';
                // traco grosso onde comeca outro grupo de colaboracao
                const separaGrupo = g.primeiroDoGrupo ? ' border-top: 2px solid #90CAF9;' : '';
                return `
                    <tr style="border-bottom: 1px solid #f0f0f0;${separaGrupo}${g.coordenador ? ` background: ${FUNDO_COORD};` : ''}">
                        <td style="padding: 4px 8px; text-align: right; color: #0D47A1; font-weight: bold;">${i + 1}</td>
                        <td style="padding: 4px 8px; white-space: nowrap;${g.coordenador ? ' font-weight: bold;' : ''}">${selo}${this._esc(g.nome)}</td>
                        <td style="padding: 4px 8px; text-align: center; color: #666; font-size: 0.85em;" title="Artigos identificados no período">${g.artigos.size}</td>
                        ${celulas}
                        <td style="padding: 4px 8px; text-align: center; border-left: 2px solid #90CAF9; font-weight: bold; color: #1B5E20;">${total}</td>
                        <td style="padding: 4px 10px; border-left: 1px solid #E3F2FD; color: #555; font-size: 0.85em; max-width: 0; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${this._esc(g.instituicao || 'Instituição não registrada na equipe')}">${g.instituicao ? this._esc(g.instituicao) : '<span style="color:#BDBDBD;">—</span>'}</td>
                    </tr>`;
            }).join('');

            coautoriaContainer.innerHTML = `
                <div style="font-size: 0.85em; color: #777; margin-bottom: 10px;">
                    ${n} pesquisadores — ${r.pares} de ${totalPares} pares com artigo em comum (${periodo})${r.grupos > 1 ? `, em <strong>${r.grupos}</strong> grupos de colaboração` : ''}.
                    As linhas estão agrupadas por colaboração, começando pelo coordenador; o traço horizontal separa um grupo do seguinte.
                    Contados por DOI e, na falta dele, por título e ano. Técnicos e alunos ficam de fora.
                    ${r.pares === 0 ? '<strong style="color:#E65100;">Nenhuma coautoria encontrada entre os currículos disponíveis.</strong>' : ''}
                </div>
                <table style="border-collapse: collapse; font-size: 0.9em; width: 100%; table-layout: auto;">
                    <thead>
                        <tr style="background: #E3F2FD; color: #0D47A1;">
                            <th style="padding: 4px 8px;">#</th>
                            <th style="padding: 4px 8px; text-align: left;">Pesquisador</th>
                            <th style="padding: 4px 8px;" title="Artigos identificados no período">Artigos</th>
                            ${cabecalho}
                            <th style="padding: 4px 8px; border-left: 2px solid #90CAF9;" title="Soma dos artigos em comum com os demais">Σ</th>
                            <th style="padding: 4px 10px; text-align: left; border-left: 1px solid #E3F2FD;">Instituição</th>
                        </tr>
                    </thead>
                    <tbody>${linhas}</tbody>
                </table>`;
            coautoriaGerada = true;
        };

        if (headerCoautoria) {
            headerCoautoria.addEventListener('click', () => {
                if (!coautoriaGerada) gerarMatrizCoautoria();
            });
        }
        if (btnCoautoriaUpdate) {
            btnCoautoriaUpdate.addEventListener('click', (e) => {
                e.stopPropagation();
                gerarMatrizCoautoria();
                contentCoautoria.style.display = 'block';
                headerCoautoria.querySelector('.toggle-icon').textContent = '[-]';
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
                        <div class="pub-year-header" style="background: #e0e0e0; padding: 6px 12px; cursor: pointer; font-weight: bold; border-radius: 4px; display: flex; justify-content: space-between; border: 1px solid #ccc;">
                            <span>Ano: ${pYear}</span>
                            <span class="y-icon">[-]</span>
                        </div>
                        <div class="pub-year-content" style="padding: 12px; border: 1px solid #ccc; border-top: none; background: #fff; display: block; border-radius: 0 0 4px 4px;">
                    `;
                }

                let cleanRef = pub.reference || [pub.paperTitle || pub.title, pub.journalName, pub.year].filter(Boolean).join('. ') || 'Referência indisponível';
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
            // Listeners dos cabeçalhos de ano (antes onclick inline, bloqueado pela CSP em db.html)
            pubContainer.querySelectorAll('.pub-year-header').forEach(header => {
                header.addEventListener('click', () => {
                    const content = header.nextElementSibling;
                    if (!content) return;
                    const isHidden = content.style.display === 'none';
                    content.style.display = isHidden ? 'block' : 'none';
                    const icon = header.querySelector('.y-icon');
                    if (icon) icon.textContent = isHidden ? '[-]' : '[+]';
                });
            });
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
            if (!chk || typeof chk.addEventListener !== 'function') return;
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
            if (!table || typeof table.querySelectorAll !== 'function') return;
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
        if (newTab && typeof newTab.addEventListener === 'function') {
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
        }

        // Aplica o estado lembrado a todos os blocos recolhiveis. Roda aqui, e nao junto
        // dos listeners, porque "Lista de Publicacoes" e "Publicacoes por Periodico" so
        // sao geradas sob demanda: reabri-las sem gerar mostraria a secao vazia.
        doc.querySelectorAll('.collapsible-header[data-collapse-key]').forEach(header => {
            const salvo = this.reportCollapsed[header.getAttribute('data-collapse-key')];
            if (salvo === undefined) return;               // sem memoria: mantem o padrao do relatorio

            const content = header.nextElementSibling;
            if (!content) return;
            const recolhido = salvo === true;
            if ((content.style.display === 'none') === recolhido) return;   // ja esta assim

            if (!recolhido) {
                if (header === headerPubList && !isPubListGenerated) generatePubList();
                if (header === headerJournalList && !isJournalGenerated) generateJournalList();
                if (header === headerCoautoria && !coautoriaGerada) gerarMatrizCoautoria();
            }
            content.style.display = recolhido ? 'none' : '';
            const icon = header.querySelector('.toggle-icon');
            if (icon) icon.innerText = recolhido ? '[+]' : '[-]';
        });

        const backBtn = doc.getElementById('btn-back-db');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                if (parentGroupData && (parentGroupData.processId || parentGroupData.isProcesso)) {
                    this.renderProcessReport(parentGroupData, newTab, sortedDb);
                } else {
                    this.viewDB(newTab);
                }
            });
        }
    },

    exportCSV: async function (targetTab = null) {
        const db = await this.getDB();
        if (db.length === 0) {
            this.showAlert("O banco de dados está vazio.", targetTab);
            return;
        }

        // Using semicolon for Excel compatibility in Brazil
        let csvContent = "\uFEFF"; // BOM for UTF-8 Excel
        
        // getDB() aqui devolve apenas CVs, então colunas exclusivas de Proposta
        // (prioridade, faixa, executora) sairiam sempre vazias — são omitidas.
        const csvColumns = this.METRICS_CONFIG.filter(m =>
            !['prioridade', 'faixa', 'instituicaoExecutora'].includes(m.key));

        // CSV Header
        csvContent += csvColumns.map(m => m.label.replace(/(\r\n|\n|\r)/gm, " ")).join(';') + "\r\n";

        // CSV Rows
        db.forEach(cv => {
            let row = csvColumns.map(m => {
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

    // Campo em que o backup carrega os conteudos que moram fora do registro
    // (jcr_proc_blob:<processId>). Existe apenas dentro do JSON: e retirado do registro
    // na importacao, antes de gravar.
    blobsBackupField: '__blobs',

    // Quais conteudos viajam no backup: so os textos (HTML de pareceres, do CV congelado
    // e dos CVs dos membros). PDFs e anexos em base64 ficam de fora — sao a maior parte
    // do peso, ja estao como arquivos na pasta piccData e o visualizador sabe rebaixa-los
    // da origem quando faltam.
    _blobEhTexto: function (chave, valor) {
        if (typeof valor !== 'string') return false;
        return chave === 'cvHtml' || chave === 'producoes'
            || chave.indexOf('review_') === 0 || chave.indexOf('memberCv_') === 0;
    },

    exportJSON: async function (targetTab = null, isProcessoOnly = false) {
        if (isProcessoOnly) {
            const propostas = await this.getDB(true);
            const piccCvs = await this.getPiccCVs();

            // Os HTMLs (pareceres, CV congelado, CVs dos membros) moram fora do registro.
            // Incluir tudo deixa o backup autossuficiente, mas pesado — cada CV e uma
            // pagina com CSS e imagens embutidos. Quem sincroniza a pasta piccData pode
            // dispensa-los: o modo "Backup Local" le os mesmos arquivos de la.
            const escolha = await this.perguntarOpcoesBackup(targetTab);
            if (!escolha.ok) return;

            for (const proc of (escolha.comHtml ? propostas : [])) {
                if (!proc || !proc.processId) continue;
                const blobs = await this.getProcBlobs(proc.processId);
                const textos = {};
                Object.keys(blobs || {}).forEach(k => {
                    if (this._blobEhTexto(k, blobs[k])) textos[k] = blobs[k];
                });
                if (Object.keys(textos).length > 0) proc[this.blobsBackupField] = textos;
            }

            const chamadas = await this.getPiccChamadas();
            const combined = [...propostas, ...piccCvs];
            // registro de configuracao: a importacao o reconhece pelo marcador e o
            // codigo antigo simplesmente o ignora (nao tem processId nem name)
            if (Object.keys(chamadas).length > 0) {
                combined.push({ __piccConfig: true, chamadas: chamadas });
            }
            if (combined.length === 0) {
                this.showAlert("A base de dados do piccTools (propostas e CVs) está vazia.", targetTab);
                return;
            }

            const jsonContent = JSON.stringify(combined, null, 2);
            const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = (targetTab && targetTab.document) ? targetTab.document.createElement("a") : document.createElement("a");
            const dateStr = new Date().toISOString().split('T')[0];
            const fileName = `jcr_lattes_picc_backup_${dateStr}.json`;
            link.setAttribute("href", url);
            link.setAttribute("download", fileName);
            const container = (targetTab && targetTab.document && targetTab.document.body) ? targetTab.document.body : document.body;
            container.appendChild(link);
            link.click();
            container.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 100);
            return;
        }

        const db = await this.getDB(false);
        if (db.length === 0) {
            this.showAlert("O banco de dados de CVs está vazio.", targetTab);
            return;
        }

        const jsonContent = JSON.stringify(db, null, 2);
        const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = (targetTab && targetTab.document) ? targetTab.document.createElement("a") : document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "jcr_lattes_database_backup.json");
        const container = (targetTab && targetTab.document && targetTab.document.body) ? targetTab.document.body : document.body;
        container.appendChild(link);
        link.click();
        container.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 100);
    },

    importJSON: function (file, targetTab = null, isProcessoOnly = false) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const importedDB = JSON.parse(e.target.result);
                    if (!Array.isArray(importedDB)) {
                        this.showAlert("Erro: O arquivo JSON não contém um banco de dados válido (esperado um array).", targetTab);
                        resolve();
                        return;
                    }

                    let addedPropostas = 0;
                    let addedCvs = 0;
                    const toSet = {};
                    const blobsARestaurar = [];

                    let chamadasImportadas = null;
                    for (const item of importedDB) {
                        if (!item) continue;
                        if (item.__piccConfig) {
                            if (item.chamadas && typeof item.chamadas === 'object') chamadasImportadas = item.chamadas;
                            continue;
                        }
                        const isProc = !!(item.isProcesso || item.processId);
                        if (isProc) {
                            // Os HTMLs voltam para jcr_proc_blob:<processId> e saem do
                            // registro: e o mesmo arranjo usado na gravacao normal.
                            const blobs = item[this.blobsBackupField];
                            delete item[this.blobsBackupField];
                            if (blobs && typeof blobs === 'object' && item.processId) {
                                blobsARestaurar.push({ processId: item.processId, blobs });
                            }
                            const key = this._cvStorageKey(item);
                            toSet[key] = item;
                            addedPropostas++;
                        } else if (item.name || item.lattesId) {
                            const key = isProcessoOnly ? this._piccCvStorageKey(item) : this._cvStorageKey(item);
                            toSet[key] = item;
                            addedCvs++;
                        }
                    }

                    if (Object.keys(toSet).length > 0) {
                        await new Promise((res, rej) => {
                            chrome.storage.local.set(toSet, () => {
                                if (chrome.runtime.lastError) rej(chrome.runtime.lastError);
                                else res();
                            });
                        });
                    }

                    if (chamadasImportadas) {
                        // o que ja existe aqui tem precedencia: o usuario pode ter
                        // corrigido o prefixo nesta maquina
                        const atuais = await this.getPiccChamadas();
                        await this.savePiccChamadas(Object.assign({}, chamadasImportadas, atuais));
                    }

                    // saveProcBlobs mescla: nao apaga PDFs/anexos ja baixados nesta maquina
                    let restaurados = 0;
                    for (const item of blobsARestaurar) {
                        try {
                            await this.saveProcBlobs(item.processId, item.blobs);
                            restaurados += Object.keys(item.blobs).length;
                        } catch (e) {
                            console.warn('[dbTools] Falha ao restaurar conteúdos da proposta', item.processId, e);
                        }
                    }
                    const linhaBlobs = restaurados > 0 ? `\nDocumentos em HTML restaurados: ${restaurados}` : '';

                    if (isProcessoOnly || addedPropostas > 0) {
                        this.showAlert(`Importação do backup do piccTools concluída com sucesso!\n\nPropostas restauradas: ${addedPropostas}\nCVs restaurados: ${addedCvs}${linhaBlobs}`, targetTab);
                    } else {
                        this.showAlert(`Importação do backup de CVs concluída com sucesso!\n\nCVs restaurados: ${addedCvs}`, targetTab);
                    }
                    resolve();
                } catch (error) {
                    this.showAlert("Erro ao ler o arquivo JSON: " + error.message, targetTab);
                    resolve();
                }
            };
            reader.onerror = () => {
                this.showAlert("Erro ao ler o arquivo.", targetTab);
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
