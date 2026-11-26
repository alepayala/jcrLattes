/**
 * Leitura do Currículo Lattes NOVO (https://busca-cv-lattes.cnpq.br/curriculo/<id>).
 *
 * Mesma interface e mesmo formato de saída de lattes_parser.js, que continua lendo
 * o formato antigo (buscatextual.cnpq.br/.../visualizacv.do): quem escolhe entre os
 * dois é o endereço da página. Também só LÊ — não anota, não guarda nada.
 *
 * O site novo é uma aplicação Angular, e duas coisas mudam a leitura:
 *   - cada seção é um acordeão e só tem conteúdo no DOM depois de aberta;
 *   - a lista de artigos chega em lotes, conforme se rola a página.
 * prepararPagina() abre as seções e rola até a lista ficar completa; as funções ler*
 * supõem que isso já foi feito e leem o que estiver no DOM.
 *
 * As regras de texto (autores, grande colaboração, titulação, etapas de patente) são as de lattes_parser.js, reaproveitadas daqui: se mudarem lá, mudam
 * para os dois formatos. As funções com prefixo _ são puras e têm teste em Node.
 */
(function (raiz) {
    'use strict';

    // lattes_parser.js vem antes no manifest; aqui só se usam as suas funções puras.
    const antigo = () => raiz.JCRLattesParser;
    const limpo = (t) => String(t || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

    // "Journal of Physical Chemistry C (19327447) Fator de impacto (JCR 2025): 3.4"
    // é o texto do balão do JCR. O ISSN vem sem hífen.
    function _jcrDoBalao(texto) {
        const t = limpo(texto);
        const fora = { journalName: '', issn: '', jcrYear: null, impactFactor: null };
        if (!t) return fora;
        const cabeca = t.split(/Fator de impacto/i)[0].trim();
        const issn = cabeca.match(/\(([0-9]{4})-?([0-9]{3}[0-9Xx])\)\s*$/);
        if (issn) fora.issn = `${issn[1]}-${issn[2].toUpperCase()}`;
        fora.journalName = cabeca.replace(/\s*\([0-9Xx-]{8,9}\)\s*$/, '').trim();
        const jcr = t.match(/Fator de impacto \(JCR (\d{4})\):\s*([\d.]+)/i);
        if (jcr) { fora.jcrYear = jcr[1]; fora.impactFactor = jcr[2]; }
        return fora;
    }

    // O ano do artigo é o trecho ", 2026." que fecha a referência.
    function _anoDaReferencia(texto) {
        const anos = limpo(texto).match(/,\s*((?:19|20)\d{2})\s*\./g);
        if (!anos || anos.length === 0) return NaN;
        return parseInt(anos[anos.length - 1].replace(/\D/g, ''), 10);
    }

    // Posição do pesquisador na lista de autores, pelos apelidos. Compara sem pontos
    // nem diferença de caixa ou de espaços: o site novo escreve "AYALA, A" onde o
    // apelido declarado é "AYALA, A.". Primeiro o nome inteiro igual; só depois a
    // regra do formato antigo (apelido contido no nome), que é mais frouxa.
    function _ordemPelosApelidos(autores, apelidos) {
        const norm = (t) => limpo(String(t || '').replace(/\./g, ' ')).toUpperCase();
        const lista = (Array.isArray(autores) ? autores : []).map(norm);
        const nomes = (Array.isArray(apelidos) ? apelidos : []).map(norm).filter(Boolean);
        if (nomes.length === 0) return -1;
        let i = lista.findIndex(a => nomes.includes(a));
        if (i === -1) i = lista.findIndex(a => nomes.some(n => a.includes(n)));
        return i === -1 ? -1 : i + 1;
    }

    // "Fulano. Título. 2026. Dissertação (Mestrado em Física). – Universidade X, Agência."
    // No site novo a instituição vem depois de um travessão, e não de " - " colado ao
    // parêntese como no antigo. Sem esse desenho, vale a regra antiga.
    function _areaEInstituicao(texto) {
        const t = limpo(texto);
        const m = t.match(/\(([^()]+)\)\s*\.?\s*[–—-]\s*([^,.]+)/);
        if (m) return { area: m[1].trim(), institution: m[2].trim() };
        // Sem parênteses (pós-doutorado): "Fulano. 2026. Supervisão de pós-doutorado –
        // Universidade X, Agência." A instituição é o que vem depois do travessão.
        const semArea = t.match(/[–—]\s*([^,.]+)/);
        if (semArea) return { area: '', institution: semArea[1].trim() };
        return antigo()._areaEInstituicao(t);
    }

    // DOIs antigos com "<" e ">" vêm do site novo com as entidades escritas por
    // extenso no próprio endereço ("...32:1&lt;27::AID...").
    function _doiDoEndereco(href) {
        const m = String(href || '').match(/doi\.org\/(.+)$/i);
        if (!m) return '';
        let d = m[1];
        try { d = decodeURIComponent(d); } catch (e) { /* fica como veio */ }
        return antigo().decodificarEntidades(d).trim();
    }

    // O site novo (página e API) devolve os autores ordenados pela posição lida como
    // TEXTO: 1, 10, 11, ..., 19, 2, 3, ... Com 10 autores ou mais, portanto, a lista
    // sai embaralhada (num artigo de 19 autores o 15º aparece em 7º). Conferido no
    // CV de teste contra o formato antigo: 57 de 57 artigos com 10+ autores fora de
    // ordem, e a posição do pesquisador recuperada em todos ao desfazer isto.
    //
    // Só vale para lista INTEIRA: numa lista cortada ("et.al") não se sabe o total,
    // e sem o total não há como desfazer. Se o CNPq corrigir a ordenação, esta
    // função passa a embaralhar — basta desligar DESFAZER_ORDEM_DE_TEXTO.
    const DESFAZER_ORDEM_DE_TEXTO = true;
    function _desfazerOrdemDeTexto(nomes) {
        const lista = Array.isArray(nomes) ? nomes : [];
        const n = lista.length;
        if (n < 10) return lista.slice();
        const comoTexto = Array.from({ length: n }, (_, i) => i + 1).sort((a, b) => (String(a) < String(b) ? -1 : 1));
        const real = new Array(n);
        comoTexto.forEach((posicao, i) => { real[posicao - 1] = lista[i]; });
        return real;
    }

    /**
     * Monta a publicação a partir das partes já separadas do item — é aqui que moram as
     * regras; lerPublicacao só tira as partes do DOM.
     *
     * partes: { autores, titulo, periodico, balao, anoTexto, doiHref, wos, scopus, referencia }
     * opcoes.apelidos: nomes pelos quais o pesquisador assina. O site novo não destaca
     * o nome do dono do currículo, então a posição de autoria depende só deles.
     *
     * "et.al" NÃO é grande colaboração aqui. O site novo corta a lista de autores de
     * muitos artigos antigos (ficam 2 a 11 nomes e "et.al"), artigos que o formato
     * antigo mostra com a lista inteira. Tratar isso como grande colaboração marcaria
     * dezenas de artigos comuns. Então: authorsTruncated avisa que a lista está
     * cortada, authorCount é só o que foi listado (um mínimo) e "último autor" fica
     * desconhecido. Grande colaboração, só com a palavra COLLABORATION ou com a lista
     * chegando ao tamanho que a define.
     *
     * Posição nas listas com "et.al": só "é o 1º autor" vale. Conferido pelo DOI no
     * Crossref em 2026-11-24 (71 artigos): o site tira autores do meio da lista
     * (real 4º de 6, mostrado 3º de 3) e põe "et.al" até quando não falta ninguém; o
     * 1º autor estava certo em todos, a posição errada em 19. Por isso, fora do 1º
     * lugar, authorRank fica -1 (indeterminada), que é o valor que o resto da
     * extensão já trata como "posição desconhecida".
     */
    function _publicacaoDasPartes(partes, opcoes) {
        const p = partes || {};
        const op = opcoes || {};
        const A = antigo();
        const doBalao = _jcrDoBalao(p.balao);
        let autoresTexto = limpo(p.autores).replace(/\s*\.\s*$/, '').trim();
        let referencia = limpo(p.referencia);
        const cortada = /et\.\s?al/i.test(autoresTexto);

        // devolve os autores à ordem real (ver _desfazerOrdemDeTexto), na contagem e
        // no texto da referência, que é o que os relatórios mostram
        let ordemRefeita = false;
        if (DESFAZER_ORDEM_DE_TEXTO && !cortada) {
            const nomes = autoresTexto.split(';').map(n => n.trim()).filter(Boolean);
            if (nomes.length >= 10) {
                const novoTexto = _desfazerOrdemDeTexto(nomes).join(' ; ');
                if (referencia.startsWith(autoresTexto)) referencia = novoTexto + referencia.slice(autoresTexto.length);
                autoresTexto = novoTexto;
                ordemRefeita = true;
            }
        }

        const dados = {
            year: _anoDaReferencia(p.anoTexto || referencia),
            issn: doBalao.issn,
            journalName: limpo(p.periodico) || doBalao.journalName,
            paperTitle: limpo(p.titulo).replace(/\.\s*$/, ''),
            impactFactor: doBalao.impactFactor,
            jcrYear: doBalao.impactFactor ? doBalao.jcrYear : null,
            wosCitations: parseInt(p.wos, 10) || 0,
            scopusCitations: parseInt(p.scopus, 10) || 0,
            hasEtAl: false,
            authorsTruncated: cortada,
            authorOrderRestored: ordemRefeita,
            isFirstAuthor: false,
            isLastAuthor: false,
            authorCount: 0,
            authorRank: -1,
            doi: _doiDoEndereco(p.doiHref),
            reference: referencia
        };

        const autores = A._contarAutores(autoresTexto);
        const ordem = _ordemPelosApelidos(autores, op.apelidos);
        dados.authorRank = (cortada && ordem !== 1) ? -1 : ordem;
        dados.hasEtAl = /COLLABORATION/i.test(autoresTexto) || autores.length >= A.AUTORES_GRANDE_COLABORACAO;
        // primeiro autor vale sempre; último, só com a lista inteira à vista
        if (ordem === 1) dados.isFirstAuthor = true;
        dados.authorCount = dados.hasEtAl ? Math.max(autores.length, A.AUTORES_GRANDE_COLABORACAO) : autores.length;
        if (ordem !== -1 && ordem === autores.length && !dados.hasEtAl && !dados.authorsTruncated && autores.length > 1) dados.isLastAuthor = true;
        return dados;
    }

    // Seletor de um artigo completo: o id termina no número de sequência da produção.
    const SELETOR_ARTIGO = 'li[id^="cv-producao-producao-bibliografica-artigos-completos-publicados-em-periodicos-"]';

    /**
     * Lê UM artigo (o <li>). Estrutura do <p>: link do DOI, <span> dos autores,
     * <span> do título, <span> do periódico (nome, balão do JCR, volume e páginas),
     * <span> do ano e, quando há, <span> das citações.
     */
    function lerPublicacao(elemento, opcoes) {
        if (!elemento) return null;
        const p = elemento.querySelector('p') || elemento;
        const spans = Array.from(p.children).filter(el => el.tagName === 'SPAN');
        const balao = p.querySelector('.tooltip-text');
        const blocoPeriodico = balao ? balao.closest('.tooltip-container').parentElement : spans[2];
        const nomePeriodico = blocoPeriodico && blocoPeriodico.firstElementChild && blocoPeriodico.firstElementChild.tagName === 'SPAN'
            ? blocoPeriodico.firstElementChild.textContent : '';

        const citacoes = { wos: 0, scopus: 0 };
        p.querySelectorAll('a.citation-link').forEach(a => {
            const img = a.querySelector('img.citation-image');
            const n = a.querySelector('span');
            if (!img || !n) return;
            if (img.classList.contains('citation-image--wos')) citacoes.wos = n.textContent;
            else if (img.classList.contains('citation-image--scopus')) citacoes.scopus = n.textContent;
        });

        // Referência sem o que a extensão mostra à parte (balão do JCR, citações) e sem
        // o que ela própria injeta na página.
        const copia = p.cloneNode(true);
        copia.querySelectorAll('.tooltip-container, .jcr-lattes-annotation').forEach(el => el.remove());
        copia.querySelectorAll('a.citation-link').forEach(a => { const s = a.closest('p > span'); if (s) s.remove(); });
        const doi = p.querySelector('a.icone-doi');

        return _publicacaoDasPartes({
            autores: spans[0] ? spans[0].textContent : '',
            titulo: spans[1] ? spans[1].textContent : '',
            periodico: nomePeriodico,
            balao: balao ? balao.textContent : '',
            anoTexto: copia.textContent,
            doiHref: doi ? doi.getAttribute('href') : '',
            wos: citacoes.wos,
            scopus: citacoes.scopus,
            referencia: copia.textContent
        }, opcoes);
    }

    // Os <li> de todos os artigos que estão no DOM (ver prepararPagina).
    function elementosDeArtigos(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        return d ? Array.from(d.querySelectorAll(SELETOR_ARTIGO)) : [];
    }

    // ------------------------------------------------------------------
    // Identificação
    // ------------------------------------------------------------------

    function _idLattesDoEndereco(href) {
        const m = String(href || '').match(/\/curriculo\/(\d{16})\b/);
        return m ? m[1] : '';
    }

    // Endereço do perfil do pesquisador no Google Scholar, tirado de um texto qualquer
    // (o "argumento" da linha Google Scholar no resumo de citações por base). Só vale um
    // endereço de perfil de verdade (scholar.google.../citations?...user=XXXX): quem
    // escreveu ali só o nome, ou outra coisa, fica sem link.
    function _linkDoScholar(texto) {
        const m = String(texto || '').match(/(?:https?:\/\/)?scholar\.google\.[a-z.]+\/citations\?[^\s"'<>]*\buser=[\w-]+[^\s"'<>]*/i);
        if (!m) return '';
        const url = m[0].replace(/[).,;]+$/, '');
        return /^https?:\/\//i.test(url) ? url : 'https://' + url;
    }

    // Link do Google Scholar na tabela "Resumo de citações por base": o da âncora da
    // linha, se houver, ou o que estiver escrito no argumento.
    function lerLinkDoScholar(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) return '';
        const painel = _painel(d, 'producoes') || d;
        let achado = '';
        painel.querySelectorAll('tr').forEach(tr => {
            if (achado) return;
            const base = tr.querySelector('td[data-label="Base"]');
            if (!base || !/google\s*scholar/i.test(base.textContent)) return;
            const arg = tr.querySelector('td[data-label="Argumento"]');
            if (!arg) return;
            const ancoras = Array.from(arg.querySelectorAll('a[href]')).map(a => a.getAttribute('href')).join(' ');
            achado = _linkDoScholar(ancoras) || _linkDoScholar(arg.textContent);
        });
        return achado;
    }

    function lerIdentificacao(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) return { name: '', link: '' };
        const h1 = d.querySelector('app-id-card h1.nome, h1.nome');
        if (!h1) return { name: '', link: '' };
        const spanNome = h1.querySelector(':scope > span');
        const name = limpo(spanNome ? spanNome.textContent : h1.getAttribute('aria-label') || '').replace(/^Nome:\s*/, '');

        const elo = d.querySelector('a.id-lattes-link');
        const id = _idLattesDoEndereco(elo ? elo.getAttribute('href') : '') ||
            _idLattesDoEndereco(d.location ? d.location.pathname : '');
        // o endereço canônico do CV, o mesmo que o formato antigo informa
        const link = id ? `http://lattes.cnpq.br/${id}` : '';

        const rid = d.querySelector('a[href*="researcherid.com/rid/"]');
        // Bolsa de produtividade: o site novo ainda não a mostra em campo próprio (o
        // antigo tinha a tarja no cabeçalho). Fica vazia até aparecer. NÃO ler do texto
        // do resumo: ali é texto livre do pesquisador, não um dado do CNPq, e pode
        // estar desatualizado ou falar de outra coisa. Quem grava o CV não deve trocar
        // uma bolsa já conhecida por este vazio.
        return {
            name, link,
            researcherIdLink: rid ? rid.href : '',
            // '' quando o pesquisador não pôs o endereço do perfil (só o nome, por exemplo)
            googleScholarLink: lerLinkDoScholar(d),
            fellowshipText: '',
            fellowshipString: '',
            // quem grava o CV usa isto para não apagar a bolsa que já tem
            fellowshipUnknown: true
        };
    }

    // Painel de uma seção do acordeão (identificacao, formacao, orientacoes, ...).
    function _painel(d, id) {
        return d.getElementById ? d.getElementById(id + '-panel') : d.querySelector('#' + id + '-panel');
    }

    function lerApelidos(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) return [];
        const painel = _painel(d, 'identificacao') || d;
        const rotulo = Array.from(painel.querySelectorAll('h3')).find(h => /nome em cita/i.test(h.textContent));
        const valor = rotulo && rotulo.nextElementSibling;
        return valor ? antigo()._apelidosDoTexto(limpo(valor.textContent)) : [];
    }

    // Maior titulação concluída: as entradas têm o período no <h3> e o texto no corpo,
    // com as mesmas frases do formato antigo ("Doutorado em ... Ano de obtenção: 1995").
    function lerTitulacao(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) return null;
        const painel = _painel(d, 'formacao');
        if (!painel) return null;
        const entradas = [];
        painel.querySelectorAll('.formacao').forEach(bloco => {
            const h3 = bloco.querySelector('h3');
            if (!h3) return;
            const curso = h3.querySelector('span');
            const anos = Array.from(h3.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join(' ');
            const corpo = bloco.querySelector('.body');
            entradas.push({ anos: limpo(anos), texto: limpo((curso ? curso.textContent : '') + '. ' + (corpo ? corpo.textContent : '')) });
        });
        return antigo()._maiorTitulacao(entradas);
    }

    // ------------------------------------------------------------------
    // Orientações, patentes e eventos
    // ------------------------------------------------------------------

    // O site novo escreve "Iniciação Científica"; o antigo, "Iniciação científica". A
    // categoria é chave de tabela nos relatórios, então fica na forma do antigo.
    function _categoriaDeOrientacao(titulo) {
        const t = limpo(titulo);
        return t ? t.charAt(0) + t.slice(1).toLowerCase() : '';
    }

    function lerOrientacoes(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const orientacoes = { inCourse: {}, concluded: {}, raw: [] };
        if (!d) return orientacoes;
        const painel = _painel(d, 'orientacoes');
        if (!painel) return orientacoes;
        const A = antigo();

        let concluida = null;   // null até o primeiro subtítulo de situação
        let categoria = '';
        painel.querySelectorAll('h3.production-title, h4.subcategory-title, li').forEach(el => {
            if (el.tagName === 'H3') { concluida = /conclu/i.test(el.textContent); categoria = ''; return; }
            if (el.tagName === 'H4') { categoria = _categoriaDeOrientacao(el.textContent); return; }
            if (concluida === null || !categoria) return;
            const item = el.querySelector('p') || el;
            const texto = limpo(item.textContent);
            if (!texto) return;
            const chave = A._ehCoorientacao(texto) ? `${categoria} (Coorientador)` : categoria;
            let ano = NaN;
            if (concluida) {
                ano = A._ultimoAno(texto);
                (orientacoes.concluded[chave] = orientacoes.concluded[chave] || []).push(ano);
            } else {
                orientacoes.inCourse[chave] = (orientacoes.inCourse[chave] || 0) + 1;
            }
            const onde = _areaEInstituicao(texto);
            orientacoes.raw.push({
                category: chave,
                status: concluida ? 'Concluída' : 'Em andamento',
                year: ano,
                area: onde.area,
                institution: onde.institution,
                reference: texto
            });
        });
        return orientacoes;
    }

    function lerPatentes(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const patentes = [];
        if (!d) return patentes;
        const A = antigo();
        d.querySelectorAll('li[id^="cv-patente-"]').forEach(li => {
            const texto = limpo(Array.from(li.querySelectorAll(':scope > p')).map(p => p.textContent).join(' ') || li.textContent);
            const etapas = A._etapasDaPatente(texto);
            if (etapas.length === 0) return;
            etapas.sort((a, b) => b.date - a.date);
            patentes.push({
                currentStatus: etapas[0].status,
                year: etapas[0].year,
                allStages: etapas,
                registro: A._numeroDoRegistro(texto),
                reference: texto
            });
        });
        return patentes;
    }

    // "Evento. Título. 2021. (Congresso)." — o site novo não informa o tipo de
    // participação (apresentação oral, pôster...), só a natureza do evento, que é o
    // que vai entre parênteses no fim.
    function _tipoDoEvento(texto) {
        const m = limpo(texto).match(/\(([^()]+)\)\s*\.?\s*$/);
        return m ? m[1].trim() : 'Desconhecido';
    }

    function lerEventos(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const eventos = [];
        if (!d) return eventos;
        const painel = _painel(d, 'eventos');
        if (!painel) return eventos;
        const A = antigo();
        // só "Participação em eventos"; a organização de eventos não entra, como no antigo
        let participacao = true;
        painel.querySelectorAll('h3.production-title, li[id^="cv-evento-"]').forEach(el => {
            if (el.tagName === 'H3') { participacao = /participa/i.test(el.textContent); return; }
            if (!participacao) return;
            const texto = limpo((el.querySelector('p') || el).textContent);
            const ano = A._anoDoEvento(texto);
            const tipo = _tipoDoEvento(texto);
            if (!isNaN(ano) && tipo !== 'Desconhecido') eventos.push({ year: ano, type: tipo, reference: texto });
        });
        return eventos;
    }

    // Citações declaradas (tabela do topo de "Produções"), no formato que
    // extractDeclaredCitations devolve para o formato antigo.
    // O indice h vem so da coluna "Indice h" da tabela; o que o pesquisador escreve no
    // campo "Argumento" e texto livre e nao e lido.
    function lerCitacoesDeclaradas(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const r = { wosCitations: '', wosHIndex: '', scopusCitations: '', scopusHIndex: '' };
        if (!d) return r;
        const painel = _painel(d, 'producoes') || d;
        painel.querySelectorAll('tr').forEach(tr => {
            const base = tr.querySelector('td[data-label="Base"]');
            if (!base) return;
            const nome = limpo(base.textContent).toLowerCase();
            const num = (rotulo) => { const td = tr.querySelector(`td[data-label="${rotulo}"]`); const n = td ? parseInt(td.textContent, 10) : NaN; return isNaN(n) ? '' : n; };
            if (nome.includes('web of science')) { r.wosCitations = num('Citações'); r.wosHIndex = num('Índice h'); }
            else if (nome.includes('scopus')) { r.scopusCitations = num('Citações'); r.scopusHIndex = num('Índice h'); }
        });
        return r;
    }

    // ------------------------------------------------------------------
    // Preparação da página
    // ------------------------------------------------------------------

    /**
     * Deixa o currículo inteiro no DOM: abre as seções fechadas do acordeão e rola até
     * os marcadores de carregamento da lista de produções sumirem. Devolve a página à
     * posição em que estava. Resolve com { secoesAbertas, artigos, completo }.
     *
     * opcoes.secoes: data-id das seções a abrir (padrão: todas as fechadas). A
     *                extensão pede só as que lê, para mexer o mínimo na página.
     * opcoes.espera: pausa em ms entre passos (padrão 350)
     * opcoes.limite: máximo de rolagens (padrão 40)
     */
    async function prepararPagina(doc, opcoes) {
        const d = doc || document;
        const op = opcoes || {};
        const espera = (ms) => new Promise(r => setTimeout(r, ms));
        const pausa = op.espera || 350;
        const janela = d.defaultView || window;
        const rolagem = { x: janela.scrollX, y: janela.scrollY };

        // Espera uma condição, olhando a cada 200 ms, até o prazo. Devolve se ela valeu.
        const ate = async (condicao, prazo) => {
            const fim = Date.now() + prazo;
            while (!condicao()) {
                if (Date.now() >= fim) return false;
                await espera(200);
            }
            return true;
        };
        const botoes = () => Array.from(d.querySelectorAll('button.accordion-header'));
        const tempoMax = op.tempoMax || 15000;

        // O acordeão é montado aos poucos: primeiro só "Identificação", as outras seções
        // uns segundos depois (medido no site em 2026-11-24). Só começa quando a lista
        // de seções parou de crescer; senão não haveria o que abrir e o currículo
        // seria lido vazio.
        let vistos = -1, desde = Date.now();
        await ate(() => {
            const n = botoes().length;
            if (n !== vistos) { vistos = n; desde = Date.now(); }
            return n > 1 && Date.now() - desde >= 1200;
        }, tempoMax);

        let secoesAbertas = 0;
        const pedidas = Array.isArray(op.secoes) ? op.secoes : null;
        const abertas = [];
        for (const botao of botoes()) {
            const id = botao.getAttribute('data-id');
            if (pedidas && !pedidas.includes(id)) continue;
            if (botao.getAttribute('aria-expanded') === 'false') {
                botao.click();
                secoesAbertas++;
                await espera(pausa);
            }
            abertas.push(id);
        }
        // Cada seção busca o conteúdo ao abrir: espera os painéis terem algo. Um prazo só
        // para todos, porque uma seção vazia pode nunca ganhar conteúdo.
        const temConteudo = (id) => { const p = d.getElementById(id + '-panel'); return !!(p && p.childElementCount && p.textContent.trim()); };
        await ate(() => abertas.every(temConteudo), tempoMax / 2);

        const pendente = () => _marcadorPendente(d);
        // O painel de "Produções" ganha conteúdo (títulos, tabela de citações) ANTES de a
        // lista de artigos chegar, e sem artigos ainda não há marcador de carga. Concluir
        // nesse intervalo lia o currículo com 0 artigos e depois com 200, sem nunca
        // completar (visto no Chrome em 2026-11-25, ao recarregar a página). Por isso:
        // primeiro espera aparecer o primeiro item ou um marcador (um CV sem produção
        // esgota este prazo), e só dá a lista por completa quando não há marcador E a
        // contagem de itens ficou parada por 1,5 s.
        const itens = () => { const p = d.getElementById('producoes-panel'); return p ? p.querySelectorAll('li').length : 0; };
        if (!pedidas || pedidas.includes('producoes')) await ate(() => itens() > 0 || !!pendente(), tempoMax / 2);

        let voltas = 0, completo = false;
        let contagem = itens(), paradaDesde = Date.now();
        const limite = op.limite || 40;
        const prazoFinal = Date.now() + tempoMax * 4;
        while (voltas < limite && Date.now() < prazoFinal) {
            const agora = itens();
            if (agora !== contagem) { contagem = agora; paradaDesde = Date.now(); }
            const s = pendente();
            if (!s) {
                if (Date.now() - paradaDesde >= 1500) { completo = true; break; }
                await espera(200);
                continue;
            }
            // O site carrega o lote seguinte por IntersectionObserver, que não dispara em
            // aba oculta: insistir seria só esperar. Quem chamou tenta de novo quando a
            // aba ficar visível (completo = false).
            if (d.hidden) break;
            s.scrollIntoView({ block: 'start' });
            voltas++;
            await espera(pausa * 2.5);
        }
        janela.scrollTo(rolagem.x, rolagem.y);
        return { secoesAbertas, artigos: elementosDeArtigos(d).length, completo };
    }

    // Marcador de carga da lista de produções ainda ativo (altura > 0): há itens por
    // carregar. O site o consome quando ele entra na tela.
    function _marcadorPendente(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) return null;
        return Array.from(d.querySelectorAll('[appintersectionsentinel]')).find(s => parseFloat(s.style.height) > 0) || null;
    }

    // A lista de produções ainda tem itens por carregar? (content.js confere antes de
    // cada montagem, para não ler nem gravar o currículo pela metade.)
    function listaIncompleta(doc) {
        return !!_marcadorPendente(doc);
    }

    // A página está no site do Lattes novo? (content.js escolhe o leitor por aqui.)
    function ehSiteNovo(local) {
        return !!local && local.hostname === 'busca-cv-lattes.cnpq.br';
    }

    // O endereço é do currículo novo?
    function ehPaginaDoCurriculo(endereco) {
        return /^https?:\/\/busca-cv-lattes\.cnpq\.br\/curriculo\/\d{16}\/?(?:[?#].*)?$/.test(String(endereco || ''));
    }

    // Seções que a extensão lê (ver as funções ler*).
    const SECOES_LIDAS = ['identificacao', 'formacao', 'producoes', 'patentes', 'eventos', 'orientacoes'];

    raiz.JCRLattesParserNovo = {
        SELETOR_ARTIGO: SELETOR_ARTIGO,
        SECOES_LIDAS: SECOES_LIDAS,
        ehSiteNovo: ehSiteNovo,
        ehPaginaDoCurriculo: ehPaginaDoCurriculo,
        prepararPagina: prepararPagina,
        listaIncompleta: listaIncompleta,
        elementosDeArtigos: elementosDeArtigos,
        lerPublicacao: lerPublicacao,
        lerIdentificacao: lerIdentificacao,
        lerApelidos: lerApelidos,
        lerTitulacao: lerTitulacao,
        lerOrientacoes: lerOrientacoes,
        lerPatentes: lerPatentes,
        lerEventos: lerEventos,
        lerCitacoesDeclaradas: lerCitacoesDeclaradas,
        // expostas para teste
        _jcrDoBalao: _jcrDoBalao,
        _anoDaReferencia: _anoDaReferencia,
        _doiDoEndereco: _doiDoEndereco,
        _desfazerOrdemDeTexto: _desfazerOrdemDeTexto,
        _publicacaoDasPartes: _publicacaoDasPartes,
        _ordemPelosApelidos: _ordemPelosApelidos,
        _areaEInstituicao: _areaEInstituicao,
        _idLattesDoEndereco: _idLattesDoEndereco,
        _linkDoScholar: _linkDoScholar,
        lerLinkDoScholar: lerLinkDoScholar,
        _categoriaDeOrientacao: _categoriaDeOrientacao,
        _tipoDoEvento: _tipoDoEvento
    };
})(typeof window !== 'undefined' ? window : globalThis);
