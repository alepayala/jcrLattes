/**
 * Leitor do currículo pela API do Lattes novo (busca-cv-lattes-api.cnpq.br).
 *
 * Segunda fonte para o mesmo currículo que lattes_parser_novo.js lê da página. Devolve
 * os mesmos objetos (publicações, orientações, patentes, eventos, identificação,
 * titulação, citações declaradas), de modo que tudo o que vem depois não precisa saber
 * de onde o dado veio.
 *
 * Para dar o mesmo resultado que a página, as REGRAS não são repetidas aqui: cada
 * item da API é reescrito nas "partes" que o leitor da página tira do DOM e passa
 * pelas mesmas funções (JCRLattesParserNovo._publicacaoDasPartes e as funções puras
 * de JCRLattesParser). O que a API tem a mais é o identificador do dono do currículo
 * na lista de coautores (nroIdCnpq): a posição de autoria não depende de casar
 * apelidos.
 *
 * Duas partes:
 *   - lerCurriculo(bruto): pura, converte as respostas já baixadas. Testável em Node.
 *   - buscarCurriculo(id): baixa as respostas. A API é a que a própria página do site
 *     usa; não exige login. Pode deixar de existir a qualquer momento — quem chama
 *     deve tratar a falha e cair para o leitor da página.
 *
 * Onde entra: content.js usa como reserva quando a lista de artigos da página não
 * completa (aba em segundo plano); db_tools.js usa para atualizar CVs do banco sem
 * abrir abas (página db.html, que precisa do host da API em host_permissions).
 */
(function () {
    const raiz = typeof window !== 'undefined' ? window : globalThis;
    const antigo = () => raiz.JCRLattesParser;
    const pagina = () => raiz.JCRLattesParserNovo;
    const limpo = (t) => String(t == null ? '' : t).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

    // A API escreve entidades HTML nos textos ("&amp;", "&lt;", "&#8804;"); a página já
    // as mostra decodificadas. As numéricas o leitor antigo não trata, então vão aqui.
    // Primeiro as nomeadas: há texto com a entidade escrita duas vezes ("&amp;#8804;").
    const texto = (t) => limpo(antigo().decodificarEntidades(String(t == null ? '' : t))
        .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(parseInt(n, 10)))
        .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))));

    const BASE = 'https://busca-cv-lattes-api.cnpq.br/busca-textual-api/v1/busca-curriculo/cv/';
    const SUBTIPO_ARTIGO = /artigos completos/i;
    const ET_AL = /^et\.?\s?al\.?$/i;
    // códigos de base bibliográfica nas citações de cada artigo
    const BASE_WOS = 1, BASE_SCOPUS = 3, BASE_SCHOLAR = 4;

    // ------------------------------------------------------------------
    // Publicações
    // ------------------------------------------------------------------

    // "v. 130, n.4, p. 8512 - 8525" como a página escreve, com o que houver.
    function _volumeEPaginas(p) {
        const partes = [];
        if (limpo(p.numeroVolume)) partes.push('v. ' + limpo(p.numeroVolume));
        if (limpo(p.numeroFasciculo)) partes.push('n.' + limpo(p.numeroFasciculo));
        const ini = limpo(p.numeroPaginaInicial), fim = limpo(p.numeroPaginaFinal);
        if (ini && fim) partes.push(`p. ${ini} - ${fim}`);
        else if (ini) partes.push('p. ' + ini);
        return partes.join(', ');
    }

    // Item de produção da API -> as "partes" que lerPublicacao tira do <li> da página.
    function _partesDoArtigo(p) {
        const nomes = (Array.isArray(p.coautores) ? p.coautores : []).map(c => limpo(c && c.nomeCitacaoBibliografica)).filter(Boolean);
        const cortada = nomes.some(n => ET_AL.test(n));
        const autores = nomes.filter(n => !ET_AL.test(n)).join(' ; ') + (cortada ? ' ; et.al' : '') + ' . ';
        const titulo = texto(p.tituloProducao);
        // o nome que a página mostra na referência é o "título público" do periódico;
        // o do balão do JCR é o outro
        const noBalao = texto(p.nmePeriodico) || texto(p.tituloPeriodicoPublic);
        const periodico = texto(p.tituloPeriodicoPublic) || noBalao;
        const ano = limpo(p.anoProducao);
        const issn = limpo(p.codIssn).replace('-', '');
        const temJcr = p.vlrImpacto !== null && p.vlrImpacto !== undefined && p.vlrImpacto !== '';
        const balao = noBalao + (issn ? ` (${issn})` : '') + (temJcr ? ` Fator de impacto (JCR ${limpo(p.anoJcr)}): ${p.vlrImpacto}` : '');
        const citacoes = (base) => {
            const c = (Array.isArray(p.citacoes) ? p.citacoes : []).find(x => x && x.codBaseBibliografica === base);
            return c ? (parseInt(c.nroCitacoes, 10) || 0) : 0;
        };
        const doi = limpo(p.urlProducao).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
        const volume = _volumeEPaginas(p);
        const referencia = `${limpo(autores)} ${titulo}. ${periodico} ${volume ? ', ' + volume : ''}, ${ano}.`;
        return {
            autores, titulo, periodico, balao,
            anoTexto: `, ${ano}.`,
            doiHref: doi ? 'https://doi.org/' + doi : '',
            wos: citacoes(BASE_WOS),
            scopus: citacoes(BASE_SCOPUS),
            referencia
        };
    }

    // Nomes com que o dono do currículo assina NESTE artigo: os coautores marcados com
    // o identificador dele. Vêm antes dos apelidos declarados, que ficam de reserva.
    function _nomesDoDono(p, idLattes) {
        if (!idLattes) return [];
        return (Array.isArray(p.coautores) ? p.coautores : [])
            .filter(c => c && String(c.nroIdCnpq || '') === String(idLattes))
            .map(c => limpo(c.nomeCitacaoBibliografica)).filter(Boolean);
    }

    /**
     * Um artigo da API no formato de lerPublicacao. opcoes: { idLattes, apelidos }.
     * Devolve null se o item não é artigo completo em periódico.
     */
    function _publicacaoDoItem(p, opcoes) {
        if (!p || !SUBTIPO_ARTIGO.test(p.subTipoproducao || '')) return null;
        const op = opcoes || {};
        const doDono = _nomesDoDono(p, op.idLattes);
        const dados = pagina()._publicacaoDasPartes(_partesDoArtigo(p), {
            // só os nomes marcados pelo identificador, quando existem: casar também pelos
            // apelidos poderia achar um homônimo que aparece antes na lista
            apelidos: doDono.length ? doDono : (op.apelidos || [])
        });
        dados.seq = p.seqProducao;
        return dados;
    }

    // ------------------------------------------------------------------
    // Identificação, apelidos, titulação, citações
    // ------------------------------------------------------------------

    function _cvdoc(estrutura) {
        const e = estrutura || {};
        let doc = e.cvdoc;
        if (typeof doc === 'string') { try { doc = JSON.parse(doc); } catch (x) { doc = null; } }
        return doc || {};
    }

    // Bolsa vigente, do bloco BOLSA da resposta "estrutura":
    // { codModalidade: 'PQ', dscModalidade: 'Produtividade em Pesquisa', codCategoria: '1B' }.
    // Vale para qualquer modalidade: a sigla e a do proprio CNPq. Sem o bloco, tudo vazio.
    function _bolsa(doc) {
        const b = doc && doc.BOLSA;
        if (!b || typeof b !== 'object') return { texto: '', sigla: '' };
        const cat = limpo(b.codCategoria), dsc = limpo(b.dscModalidade);
        const mod = limpo(b.codModalidade) || dsc;
        if (!mod) return { texto: '', sigla: '' };
        return {
            texto: limpo(`Bolsista de ${dsc || mod} ${cat}`),
            sigla: cat ? `${mod} ${cat}` : mod
        };
    }

    function _identificacao(estrutura, citacoes) {
        const doc = _cvdoc(estrutura);
        const bolsa = _bolsa(doc);
        const gerais = doc['DADOS-GERAIS'] || {};
        const id = limpo(doc['NUMERO-IDENTIFICADOR'] || (estrutura && estrutura.cvid) || '');
        const wos = (Array.isArray(citacoes) ? citacoes : []).find(c => c && c.codBaseBibliog === BASE_WOS);
        const scholar = (Array.isArray(citacoes) ? citacoes : []).find(c => c && c.codBaseBibliog === BASE_SCHOLAR);
        const scopus = (Array.isArray(citacoes) ? citacoes : []).find(c => c && c.codBaseBibliog === BASE_SCOPUS);
        return {
            name: limpo(gerais['NOME-COMPLETO']),
            // o mesmo identificador que os outros leitores gravam
            link: /^\d{16}$/.test(id) ? `http://lattes.cnpq.br/${id}` : '',
            researcherIdLink: wos && /researcherid\.com\/rid\//i.test(wos.txtUriPesquisadorBase || '') ? wos.txtUriPesquisadorBase : '',
            // perfil no Google Scholar: só quando há um endereço de perfil (no campo
            // próprio ou escrito no argumento); nome solto não serve
            googleScholarLink: scholar ? (pagina()._linkDoScholar(scholar.txtUriPesquisadorBase) || pagina()._linkDoScholar(scholar.txtArgumento)) : '',
            // Scopus ID: só quando o endereço ou o argumento o trazem; nomes de busca não servem
            scopusAuthorId: scopus ? (pagina()._idScopusDoArgumento(scopus.txtUriPesquisadorBase) || pagina()._idScopusDoArgumento(scopus.txtArgumento)) : '',
            // sem o bloco BOLSA nao da para distinguir "sem bolsa" de "a API deixou de
            // informar": fica desconhecida e quem grava nao apaga a que ja conhece
            fellowshipText: bolsa.texto,
            fellowshipString: bolsa.sigla,
            fellowshipUnknown: !bolsa.sigla
        };
    }

    function _apelidos(estrutura) {
        const gerais = _cvdoc(estrutura)['DADOS-GERAIS'] || {};
        return String(gerais['NOME-EM-CITACOES-BIBLIOGRAFICAS'] || '').split(';').map(limpo).filter(Boolean);
    }

    // Atributos de uma tag XML ("<DOUTORADO A="1" B="2"/>") num objeto.
    function _atributos(tag) {
        const o = {};
        const re = /([A-Z0-9-]+)="([^"]*)"/g;
        let m;
        while ((m = re.exec(tag)) !== null) o[m[1]] = m[2];
        return o;
    }

    // A formação vem em XML. Cada curso vira uma entrada { anos, texto } com as frases
    // que o currículo exibe, e a decisão fica com a regra de sempre (_maiorTitulacao):
    // maior nível concluído; "em andamento"/"interrompido" não contam, salvo com ano
    // de obtenção.
    const NIVEIS_XML = [
        ['DOUTORADO', 'Doutorado'], ['MESTRADO', 'Mestrado'], ['MESTRADO-PROFISSIONALIZANTE', 'Mestrado profissional'],
        ['ESPECIALIZACAO', 'Especialização'], ['GRADUACAO', 'Graduação']
    ];
    function _titulacaoDoXml(xml) {
        const texto = String(xml || '');
        const entradas = [];
        NIVEIS_XML.forEach(([tag, rotulo]) => {
            const re = new RegExp('<' + tag + '\\s[^>]*>', 'g');
            let m;
            while ((m = re.exec(texto)) !== null) {
                const a = _atributos(m[0]);
                const status = String(a['STATUS-DO-CURSO'] || '').toUpperCase();
                let frase = `${rotulo} em ${a['NOME-CURSO'] || ''}.`;
                if (a['ANO-DE-OBTENCAO-DO-TITULO']) frase += ` Ano de obtenção: ${a['ANO-DE-OBTENCAO-DO-TITULO']}.`;
                if (status === 'EM_ANDAMENTO') frase += ' Em andamento.';
                else if (status === 'INCOMPLETO') frase += ' Interrompido.';
                entradas.push({ anos: `${a['ANO-DE-INICIO'] || ''} - ${a['ANO-DE-CONCLUSAO'] || ''}`, texto: frase });
            }
        });
        return antigo()._maiorTitulacao(entradas);
    }

    // Mesmo formato de lerCitacoesDeclaradas ('' onde não há número).
    function _citacoesDeclaradas(citacoes) {
        const r = { wosCitations: '', wosHIndex: '', scopusCitations: '', scopusHIndex: '' };
        const num = (v) => { const n = parseInt(v, 10); return isNaN(n) ? '' : n; };
        // O indice h declarado e so o do campo proprio. O "argumento" e texto livre do
        // pesquisador: ler "H-Index: N" dali funcionava para quem o escrevia assim e para
        // mais ninguem (retirado em 2026-11-26, a pedido).
        const h = (c) => num(c.nroIndiceH);
        (Array.isArray(citacoes) ? citacoes : []).forEach(c => {
            if (!c) return;
            if (c.codBaseBibliog === BASE_WOS) { r.wosCitations = num(c.nroCitacoes); r.wosHIndex = h(c); }
            else if (c.codBaseBibliog === BASE_SCOPUS) { r.scopusCitations = num(c.nroCitacoes); r.scopusHIndex = h(c); }
        });
        return r;
    }

    // ------------------------------------------------------------------
    // Orientações, patentes e eventos
    // ------------------------------------------------------------------

    // Área como a página a escreve entre parênteses ("Mestrado em Física").
    function _areaDaOrientacao(o) {
        const curso = limpo(o.curso);
        if (!curso) return '';
        const tipo = limpo(o.tipoProducao).toLowerCase();
        if (tipo.includes('mestrado')) return 'Mestrado em ' + curso;
        if (tipo.includes('doutorado') && !tipo.includes('pós')) return 'Doutorado em ' + curso;
        if (tipo.includes('especializa')) return 'Aperfeiçoamento/Especialização em ' + curso;
        if (tipo.includes('gradua')) return 'Graduação em ' + curso;
        if (tipo.includes('inicia')) return 'Graduando em ' + curso;
        return curso;
    }

    function _orientacoes(lista) {
        const orientacoes = { inCourse: {}, concluded: {}, raw: [] };
        (Array.isArray(lista) ? lista : []).forEach(o => {
            if (!o) return;
            const categoria = pagina()._categoriaDeOrientacao(o.tipoProducao);
            if (!categoria) return;
            const chave = /CO_ORIENTADOR/i.test(o.tpoOrientacao || '') ? `${categoria} (Coorientador)` : categoria;
            const concluida = /conclu/i.test(o.tipoOrientacao || '');
            let ano = NaN;
            if (concluida) {
                ano = parseInt(o.anoProducao, 10);
                (orientacoes.concluded[chave] = orientacoes.concluded[chave] || []).push(ano);
            } else {
                orientacoes.inCourse[chave] = (orientacoes.inCourse[chave] || 0) + 1;
            }
            const area = _areaDaOrientacao(o);
            const instituicao = limpo(o.nomeInstituicaoTese);
            const pedacos = [limpo(o.nomeOrientado), limpo(o.tituloProducao),
                (concluida ? '' : 'Início: ') + limpo(o.anoProducao),
                categoria + (area ? ` (${area})` : '')].filter(Boolean);
            orientacoes.raw.push({
                category: chave,
                status: concluida ? 'Concluída' : 'Em andamento',
                year: ano,
                area: area,
                institution: instituicao,
                reference: pedacos.join('. ') + '.' + (instituicao ? ` – ${instituicao}.` : '')
            });
        });
        return orientacoes;
    }

    // A API só informa a data de registro, que na página aparece como "Depósito".
    // Etapas posteriores (concessão) não vêm nas respostas examinadas.
    function _patentes(lista) {
        const patentes = [];
        (Array.isArray(lista) ? lista : []).forEach(p => {
            if (!p) return;
            const d = String(p.dataRegistro || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (!d) return;
            const data = new Date(parseInt(d[1], 10), parseInt(d[2], 10) - 1, parseInt(d[3], 10));
            const etapa = { status: 'Depósito', date: data, year: data.getFullYear() };
            const autores = (Array.isArray(p.coautores) ? p.coautores : []).map(c => limpo(c && c.nomeCitacaoBibliografica)).filter(Boolean).join(' ; ');
            const titulo = limpo(p.tituloProducao);
            const registro = limpo(p.numeroRegistro);
            patentes.push({
                currentStatus: etapa.status,
                year: etapa.year,
                allStages: [etapa],
                registro: registro,
                reference: `${autores} . ${titulo}. ${limpo(p.anoProducao)}, ${limpo(p.pais)}. Patente: ${limpo(p.tpoProducao)}. ` +
                    `Número do registro: ${registro}, Título: "${titulo}" , Instituição de registro: ${limpo(p.institutoDeRegistro)} , ` +
                    `Depósito: ${d[3]}/${d[2]}/${d[1]}.`
            });
        });
        return patentes;
    }

    // Só participação em eventos (a organização não entra, como nos outros leitores).
    // "type" é a natureza do evento (Congresso, Encontro...), como no leitor da página.
    function _eventos(lista) {
        const eventos = [];
        (Array.isArray(lista) ? lista : []).forEach(e => {
            if (!e || !/participa/i.test(e.tipoEvento || '')) return;
            const ano = parseInt(e.anoProducao, 10);
            const tipo = limpo(e.tipoProducao);
            if (isNaN(ano) || !tipo) return;
            const pedacos = [limpo(e.nomeEvento), limpo(e.tituloProducao), String(ano)].filter(Boolean);
            eventos.push({ year: ano, type: tipo, reference: `${pedacos.join('. ')}. (${tipo}).` });
        });
        return eventos;
    }

    // ------------------------------------------------------------------
    // Currículo inteiro
    // ------------------------------------------------------------------

    /**
     * Converte as respostas da API. bruto: { estrutura, citacoes, producao, orientacoes,
     * patentes, eventos, formacaoXml } — o que buscarCurriculo devolve. Seção ausente
     * vira lista vazia (ou null, na titulação).
     */
    function lerCurriculo(bruto) {
        const b = bruto || {};
        const identificacao = _identificacao(b.estrutura, b.citacoes);
        const apelidos = _apelidos(b.estrutura);
        const idLattes = (identificacao.link.match(/(\d{16})$/) || [])[1] || '';
        const publications = (Array.isArray(b.producao) ? b.producao : [])
            .map(p => _publicacaoDoItem(p, { idLattes, apelidos }))
            .filter(Boolean);
        return {
            fonte: 'api',
            identificacao,
            apelidos,
            titulacao: _titulacaoDoXml(b.formacaoXml),
            citacoes: _citacoesDeclaradas(b.citacoes),
            publications,
            orientacoes: _orientacoes(b.orientacoes),
            patentes: _patentes(b.patentes),
            eventos: _eventos(b.eventos)
        };
    }

    /**
     * Baixa as respostas de um currículo. opcoes: { fetch, base, lote }.
     * Rejeita se a identificação ou a produção falharem; as outras seções, se falharem,
     * vêm vazias e são listadas em `falhas`.
     */
    async function buscarCurriculo(idLattes, opcoes) {
        const op = opcoes || {};
        const f = op.fetch || (typeof fetch !== 'undefined' ? fetch.bind(raiz) : null);
        if (!f) throw new Error('fetch indisponível');
        if (!/^\d{16}$/.test(String(idLattes || ''))) throw new Error('ID Lattes inválido');
        const base = (op.base || BASE) + idLattes + '/';
        const lote = op.lote || 200;

        const pedir = async (caminho, init) => {
            const r = await f(base + caminho, init);
            if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`);
            return r;
        };
        const json = async (caminho, init) => (await pedir(caminho, init)).json();
        const falhas = [];
        const opcional = async (nome, promessa, vazio) => {
            try { return await promessa; } catch (e) { falhas.push(nome + ': ' + (e && e.message)); return vazio; }
        };

        const estrutura = await json('estrutura');
        const sequencias = await json('producao/sequencias');
        const seqs = Array.isArray(sequencias && sequencias.seqs) ? sequencias.seqs : [];
        const producao = [];
        for (let i = 0; i < seqs.length; i += lote) {
            const itens = await json('producao/por-sequencias?idiomaAplicacao=1', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(seqs.slice(i, i + lote))
            });
            if (Array.isArray(itens)) producao.push(...itens);
        }

        return {
            estrutura,
            producao,
            citacoes: await opcional('citacoes', json('citacoes'), []),
            orientacoes: await opcional('orientacoes', json('orientacoes?idiomaAplicacao=1'), []),
            patentes: await opcional('patentes', json('patentes?idiomaAplicacao=1'), []),
            eventos: await opcional('eventos', json('eventos?idiomaAplicacao=1'), []),
            formacaoXml: await opcional('formacao', pedir('secao.xml?secao=formacao').then(r => r.text()), ''),
            falhas
        };
    }

    raiz.JCRLattesApi = {
        // Chave geral: com false ninguem chama a API (a extensao segue so com a pagina
        // e com "abrir os CVs em abas"). Desligar quando o CNPq fechar este acesso.
        ATIVA: true,
        BASE: BASE,
        lerCurriculo: lerCurriculo,
        buscarCurriculo: buscarCurriculo,
        // expostas para teste
        _partesDoArtigo: _partesDoArtigo,
        _publicacaoDoItem: _publicacaoDoItem,
        _titulacaoDoXml: _titulacaoDoXml,
        _citacoesDeclaradas: _citacoesDeclaradas,
        _orientacoes: _orientacoes,
        _patentes: _patentes,
        _eventos: _eventos
    };
})();
