/**
 * Leitura da página "Produções e Orientações" do efomento (publicacao.do).
 *
 * A página traz, para UM pesquisador, a produção dos últimos 10 anos em tabelas:
 * artigos, trabalhos em eventos, livros, capítulos, patentes e orientações.
 * Aqui ela é convertida para o MESMO formato que o relatório já consome dos
 * currículos Lattes, de modo que gráficos e tabelas funcionem sem alteração.
 *
 * O que a página NÃO tem (e por isso fica zerado): citações por artigo, Scopus,
 * orientações em andamento e a marca de "et al" das grandes colaborações. Em
 * compensação ela traz o número exato de autores e a ordem de autoria, o que
 * permite deduzir primeiro/último autor com precisão.
 */
(function (raiz) {
    'use strict';

    // ---------------------------------------------------------------------
    // DOI
    // ---------------------------------------------------------------------
    // Os links vêm como onclick="abrirDOI('HTTP:\\DX.DOI.ORG\10.1093/mnras/x')"
    // — com barras INVERTIDAS na maioria dos casos e normais em alguns. O que
    // interessa é o identificador a partir do "10.".
    function doiDeChamada(valor) {
        const t = String(valor || '').replace(/\\/g, '/');
        const m = t.match(/10\.\d{4,9}\/[^\s"'<>)]+/);
        return m ? m[0] : '';
    }

    function urlDoi(doi) {
        return doi ? 'https://doi.org/' + doi : '';
    }

    // Troca os <a onclick="abrirDOI(...)"> por links normais para doi.org.
    // Usado na cópia salva junto com a proposta: sem os scripts, o onclick não
    // levaria a lugar nenhum e o DOI se perderia.
    function converterLinksDoi(htmlText) {
        return String(htmlText || '').replace(
            /<a\b([^>]*?)onclick\s*=\s*(["'])\s*abrirDOI\(\s*(["'])([\s\S]*?)\3\s*\)\s*;?\s*\2([^>]*)>/gi,
            function (inteiro, antes, aspaHtml, aspaJs, arg, depois) {
                const doi = doiDeChamada(arg);
                if (!doi) return inteiro;
                const limpo = (antes + depois)
                    .replace(/\bhref\s*=\s*(["'])[\s\S]*?\1/gi, '')
                    .replace(/\bon\w+\s*=\s*(["'])[\s\S]*?\1/gi, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                return '<a href="' + urlDoi(doi) + '" target="_blank" rel="noopener noreferrer"'
                     + ' title="DOI: ' + doi + '"' + (limpo ? ' ' + limpo : '') + '>';
            });
    }

    // ---------------------------------------------------------------------
    // Leitura das tabelas
    // ---------------------------------------------------------------------
    const semAcento = (t) => String(t || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

    const texto = (el) => el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
    const inteiro = (v) => {
        const m = String(v || '').match(/-?\d+/);
        return m ? parseInt(m[0], 10) : 0;
    };
    const decimal = (v) => {
        const m = String(v || '').replace(',', '.').match(/-?\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : 0;
    };

    // As tabelas são aninhadas e o título de cada seção é apenas o texto que vem
    // logo antes do <thead>. Percorremos o documento em ordem guardando o último
    // texto visto: ao chegar num <thead>, ele é o título daquela tabela.
    function secoes(doc) {
        const encontradas = [];
        const andarilho = doc.createTreeWalker(doc.body || doc, 1 | 4 /* ELEMENT | TEXT */);
        let ultimoTexto = '';
        let no = andarilho.currentNode;
        while (no) {
            if (no.nodeType === 3) {
                const t = String(no.nodeValue || '').replace(/\s+/g, ' ').trim();
                if (t) ultimoTexto = t;
            } else if (no.tagName === 'THEAD') {
                const tabela = no.parentNode;
                encontradas.push({ titulo: ultimoTexto, thead: no, tabela: tabela });
            }
            no = andarilho.nextNode();
        }
        return encontradas;
    }

    function colunas(thead) {
        return Array.prototype.map.call(thead.querySelectorAll('th'), texto);
    }

    // Cada célula vira { txt, doi }: o DOI só existe na célula do título do artigo.
    function linhas(tabela, thead) {
        const corpo = tabela.querySelector('tbody');
        const trs = corpo ? corpo.querySelectorAll('tr') : [];
        const fora = [];
        Array.prototype.forEach.call(trs, function (tr) {
            if (thead.contains(tr)) return;
            const tds = tr.querySelectorAll('td');
            if (!tds.length) return;
            const celulas = Array.prototype.map.call(tds, function (td) {
                let doi = '';
                const a = td.querySelector('a[onclick*="abrirDOI"], a[href*="doi.org"]');
                if (a) {
                    const onclick = a.getAttribute('onclick') || '';
                    doi = doiDeChamada(onclick) || doiDeChamada(a.getAttribute('href') || '');
                }
                return { txt: texto(td), doi: doi };
            });
            // "Nenhum registro encontrado" ocupa a linha inteira
            if (celulas.length === 1 && /nenhum registro/i.test(celulas[0].txt)) return;
            fora.push(celulas);
        });
        return fora;
    }

    // ---------------------------------------------------------------------
    // Identificação das seções
    // ---------------------------------------------------------------------
    const ARTIGOS = 'artigos';
    const PATENTES = 'patentes';
    const ORIENTACOES = 'orientacoes';

    // Devolve { tipo, categoria } ou null quando a seção não interessa ao relatório
    // (trabalhos em eventos, livros e capítulos ficam de fora: o relatório
    // individual de hoje não tem onde mostrá-los).
    function classificar(titulo) {
        const t = semAcento(titulo);
        if (!t) return null;
        if (t.indexOf('artigos completos') === 0) return { tipo: ARTIGOS };
        if (t === 'patentes') return { tipo: PATENTES };

        if (t.indexOf('orientacoes concluidas') === 0 || t.indexOf('co-orientacoes concluidas') === 0
            || t.indexOf('coorientacoes concluidas') === 0) {
            const co = t.indexOf('co') === 0;
            let categoria;
            if (t.indexOf('iniciacao cientifica') >= 0) categoria = 'Iniciação científica';
            else if (t.indexOf('mestrado') >= 0) categoria = 'Dissertação de mestrado';
            else if (t.indexOf('doutorado') >= 0 && t.indexOf('pos-doutorado') < 0 && t.indexOf('pos doutorado') < 0) categoria = 'Tese de doutorado';
            else if (t.indexOf('pos-doutorado') >= 0 || t.indexOf('pos doutorado') >= 0) categoria = 'Supervisão de pós-doutorado';
            else categoria = 'Outras';
            if (co) categoria += ' (Coorientador)';
            return { tipo: ORIENTACOES, categoria: categoria };
        }
        return null;
    }

    // ---------------------------------------------------------------------
    // Conversões
    // ---------------------------------------------------------------------
    // "MONTHLY NOTICES... (ISSN:0035-8711)" -> nome + issn
    function periodico(valor) {
        const t = String(valor || '').trim();
        const m = t.match(/\(\s*IS[SB]N\s*:?\s*([^)]*)\)\s*$/i);
        if (!m) return { nome: t, issn: '' };
        return {
            nome: t.slice(0, m.index).trim(),
            issn: String(m[1] || '').replace(/\s+/g, '').trim()
        };
    }

    // "5.2 (2025)" -> { jif: 5.2, ano: 2025 }
    function fatorImpacto(valor) {
        const t = String(valor || '').trim();
        if (!t || t === '-') return { jif: 0, ano: 0 };
        const ano = t.match(/\((\d{4})\)/);
        return { jif: decimal(t), ano: ano ? parseInt(ano[1], 10) : 0 };
    }

    function indice(colunasLista, ...nomes) {
        for (let i = 0; i < colunasLista.length; i++) {
            const c = semAcento(colunasLista[i]);
            for (const n of nomes) {
                if (c === semAcento(n)) return i;
            }
        }
        return -1;
    }

    function artigos(cols, dados) {
        // A tabela tem DUAS colunas chamadas "Título": a primeira é o artigo, a
        // segunda o periódico. Por isso a posição é resolvida na ordem conhecida.
        const iAno = 0, iTitulo = 1, iPeriodico = 2;
        const iQualis = indice(cols, 'Estrato Qualis');
        const iJcr = indice(cols, 'JCR (Ano)', 'JCR');
        const iVolume = indice(cols, 'Volume');
        const iPagIni = indice(cols, 'Página Inicial');
        const iPagFim = indice(cols, 'Página Final');
        const iFasc = indice(cols, 'Fascículo');
        const iAutores = indice(cols, 'Autores');
        const iOrdem = indice(cols, 'Ordem Autoria');
        const iClasse = indice(cols, 'Classificação Revista');

        const pega = (linha, i) => (i >= 0 && i < linha.length) ? linha[i].txt : '';

        return dados.map(function (linha) {
            const rev = periodico(pega(linha, iPeriodico));
            const fi = fatorImpacto(pega(linha, iJcr));
            const nAutores = inteiro(pega(linha, iAutores));
            const ordem = inteiro(pega(linha, iOrdem));
            const paginaIni = pega(linha, iPagIni);
            const paginaFim = pega(linha, iPagFim);
            const volume = pega(linha, iVolume);
            const titulo = pega(linha, iTitulo);
            const doi = (iTitulo < linha.length && linha[iTitulo].doi) ? linha[iTitulo].doi : '';
            const ano = inteiro(pega(linha, iAno));

            const partes = [titulo, rev.nome, ano ? String(ano) : ''].filter(Boolean);
            if (volume) partes.push('v. ' + volume);
            if (paginaIni) partes.push('p. ' + paginaIni + (paginaFim ? '-' + paginaFim : ''));

            return {
                year: ano,
                issn: rev.issn,
                journalName: rev.nome,
                paperTitle: titulo,
                jif: fi.jif,
                jcrYear: fi.ano,
                authorCount: nAutores,
                authorRank: ordem > 0 ? ordem : -1,
                // A página não marca "et al"; em troca dá a contagem exata de autores,
                // que já define primeiro/último autor com precisão.
                hasEtAl: false,
                isFirstAuthor: ordem === 1,
                isLastAuthor: nAutores > 0 && ordem === nAutores,
                wosCitations: 0,
                scopusCitations: 0,
                doi: doi,
                qualis: pega(linha, iQualis),
                classificacaoRevista: pega(linha, iClasse),
                volume: volume,
                pages: paginaIni + (paginaFim ? '-' + paginaFim : ''),
                fasciculo: pega(linha, iFasc),
                reference: partes.join('. ')
            };
        }).filter(p => p.paperTitle || p.journalName);
    }

    function patentes(cols, dados) {
        const iAno = 0;
        const iTitulo = indice(cols, 'Título');
        const iCodigo = indice(cols, 'Código');
        const pega = (linha, i) => (i >= 0 && i < linha.length) ? linha[i].txt : '';
        return dados.map(function (linha) {
            return {
                year: inteiro(pega(linha, iAno)),
                title: pega(linha, iTitulo >= 0 ? iTitulo : 1),
                code: pega(linha, iCodigo),
                // a página não informa a situação do pedido
                currentStatus: 'Não informado'
            };
        }).filter(p => p.title || p.code);
    }

    function orientacoes(categoria, cols, dados) {
        const iAno = 0;
        const iOrientado = indice(cols, 'Orientado');
        const iTitulo = indice(cols, 'Título');
        const iInst = indice(cols, 'Instituição');
        const iCurso = indice(cols, 'Curso');
        const pega = (linha, i) => (i >= 0 && i < linha.length) ? linha[i].txt : '';
        return dados.map(function (linha) {
            const ano = inteiro(pega(linha, iAno));
            const partes = [
                pega(linha, iOrientado),
                pega(linha, iTitulo),
                pega(linha, iInst),
                pega(linha, iCurso),
                ano ? String(ano) : ''
            ].filter(Boolean);
            return {
                category: categoria,
                // Só há orientações CONCLUÍDAS nesta página.
                status: 'Concluída',
                year: ano,
                student: pega(linha, iOrientado),
                title: pega(linha, iTitulo),
                institution: pega(linha, iInst),
                course: pega(linha, iCurso),
                reference: partes.join('. ')
            };
        }).filter(o => o.student || o.title);
    }

    // ---------------------------------------------------------------------
    // Cabeçalho
    // ---------------------------------------------------------------------
    function cabecalho(doc) {
        const t = String((doc.body || doc).textContent || '').replace(/\s+/g, ' ');
        const acha = (re) => { const m = t.match(re); return m ? m[1].trim() : ''; };
        const numero = (re) => {
            const v = acha(re);
            return v ? inteiro(v.replace(/[.\s]/g, '')) : null;
        };
        return {
            nome: acha(/Nome:\s*([^:]*?)\s*(?:N[íi]vel:|Per[íi]odo|Cita[çc][õo]es|$)/i),
            nivel: acha(/N[íi]vel:\s*([^:]*?)\s*(?:Per[íi]odo|Cita[çc][õo]es|Nome:|$)/i),
            totalTrabalhos: numero(/Total de Trabalhos:\s*([\d.,]+)/i),
            totalCitacoes: numero(/Total de Cita[çc][õo]es:\s*([\d.,]+)/i),
            fatorH: numero(/Fator H:\s*([\d.,]+)/i)
        };
    }

    // ---------------------------------------------------------------------
    // API
    // ---------------------------------------------------------------------
    function parse(htmlText) {
        const vazio = {
            nome: '', nivel: '', publications: [], patents: [],
            supervisions: { raw: [], concluded: {}, inCourse: {} },
            declaredCitations: null, anoMin: 0, anoMax: 0, secoesIgnoradas: []
        };
        if (!htmlText || typeof DOMParser === 'undefined') return vazio;

        let doc;
        try {
            doc = new DOMParser().parseFromString(String(htmlText), 'text/html');
        } catch (e) {
            return vazio;
        }
        if (!doc || !doc.body) return vazio;

        const cab = cabecalho(doc);
        const publications = [];
        const patents = [];
        const raw = [];
        const ignoradas = [];

        secoes(doc).forEach(function (sec) {
            const alvo = classificar(sec.titulo);
            const cols = colunas(sec.thead);
            const dados = linhas(sec.tabela, sec.thead);
            if (!alvo) {
                if (sec.titulo) ignoradas.push(sec.titulo);
                return;
            }
            if (dados.length === 0) return;
            if (alvo.tipo === ARTIGOS) publications.push(...artigos(cols, dados));
            else if (alvo.tipo === PATENTES) patents.push(...patentes(cols, dados));
            else if (alvo.tipo === ORIENTACOES) raw.push(...orientacoes(alvo.categoria, cols, dados));
        });

        // concluded/inCourse no formato que o relatório já usa para os totais
        const concluded = {};
        raw.forEach(function (o) {
            const chave = o.category.replace(/\s*\(Coorientador\)\s*$/i, '').trim();
            if (!concluded[chave]) concluded[chave] = [];
            concluded[chave].push(o);
        });

        const anos = publications.map(p => p.year)
            .concat(patents.map(p => p.year))
            .concat(raw.map(o => o.year))
            .filter(a => a > 1900);

        return {
            nome: cab.nome,
            nivel: cab.nivel,
            publications: publications,
            patents: patents,
            supervisions: { raw: raw, concluded: concluded, inCourse: {} },
            // a página traz os números do Web of Science declarados pelo CNPq
            declaredCitations: (cab.totalCitacoes !== null || cab.fatorH !== null) ? {
                wosCitations: cab.totalCitacoes !== null ? cab.totalCitacoes : '',
                wosHIndex: cab.fatorH !== null ? cab.fatorH : '',
                scopusCitations: '',
                scopusHIndex: ''
            } : null,
            totalTrabalhosWos: cab.totalTrabalhos,
            anoMin: anos.length ? Math.min(...anos) : 0,
            anoMax: anos.length ? Math.max(...anos) : 0,
            secoesIgnoradas: ignoradas
        };
    }

    raiz.JCRProducoes = {
        parse: parse,
        converterLinksDoi: converterLinksDoi,
        doiDeChamada: doiDeChamada,
        urlDoi: urlDoi,
        _periodico: periodico,
        _fatorImpacto: fatorImpacto,
        _classificar: classificar
    };
})(typeof window !== 'undefined' ? window : globalThis);
