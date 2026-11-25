'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const API = require('./helpers/load.js').lattesApi();

// Dados inventados, no formato das respostas da API do Lattes novo.
const ID = '1111222233334444';
const coautor = (nome, id) => ({ nomeCitacaoBibliografica: nome, nroIdCnpq: id || null });
const artigo = (extra) => Object.assign({
    subTipoproducao: 'Artigos Completos publicados em periódicos',
    tituloProducao: 'Um estudo qualquer',
    anoProducao: '2024',
    seqProducao: 77,
    coautores: [coautor('SOUZA, P.'), coautor('LINS, ANA B. M.', ID), coautor('PRADO, C.')],
    urlProducao: '10.1000/abc.123',
    tituloPeriodicoPublic: 'JOURNAL OF EXAMPLES',
    nmePeriodico: 'Journal of Examples',
    codIssn: '12345678',
    anoJcr: '2025',
    vlrImpacto: 4.3,
    numeroVolume: '12', numeroFasciculo: '3', numeroPaginaInicial: '100', numeroPaginaFinal: '110',
    citacoes: [{ codBaseBibliografica: 3, nroCitacoes: 5 }, { codBaseBibliografica: 1, nroCitacoes: 7 }, { codBaseBibliografica: 2, nroCitacoes: 9 }]
}, extra || {});

describe('_publicacaoDoItem', () => {
    test('artigo comum sai no formato do leitor da pagina', () => {
        const r = API._publicacaoDoItem(artigo(), { idLattes: ID });
        assert.strictEqual(r.year, 2024);
        assert.strictEqual(r.paperTitle, 'Um estudo qualquer');
        assert.strictEqual(r.journalName, 'JOURNAL OF EXAMPLES');   // o nome que a pagina mostra
        assert.strictEqual(r.issn, '1234-5678');
        assert.deepStrictEqual([r.impactFactor, r.jcrYear], ['4.3', '2025']);
        assert.deepStrictEqual([r.wosCitations, r.scopusCitations], [7, 5]);   // 1 = WoS, 3 = Scopus
        assert.strictEqual(r.doi, '10.1000/abc.123');
        assert.deepStrictEqual([r.authorCount, r.authorRank, r.isFirstAuthor, r.isLastAuthor], [3, 2, false, false]);
        assert.strictEqual(r.seq, 77);
        assert.strictEqual(r.reference,
            'SOUZA, P. ; LINS, ANA B. M. ; PRADO, C. . Um estudo qualquer. JOURNAL OF EXAMPLES , v. 12, n.3, p. 100 - 110, 2024.');
    });

    test('so artigo completo em periodico vira publicacao', () => {
        assert.strictEqual(API._publicacaoDoItem(artigo({ subTipoproducao: 'Livros e Capítulos' }), { idLattes: ID }), null);
        assert.strictEqual(API._publicacaoDoItem(null, {}), null);
    });

    // A posicao vem do identificador do dono na lista de coautores, nao dos apelidos:
    // aqui o apelido declarado nem aparece na lista.
    test('a posicao do dono sai do identificador, sem depender dos apelidos', () => {
        const r = API._publicacaoDoItem(artigo({ coautores: [coautor('LINS, A.', ID), coautor('SOUZA, P.')] }),
            { idLattes: ID, apelidos: ['NOME QUE NAO ESTA NA LISTA'] });
        assert.deepStrictEqual([r.authorRank, r.isFirstAuthor], [1, true]);
    });

    test('sem o identificador na lista, vale o apelido declarado', () => {
        const r = API._publicacaoDoItem(artigo({ coautores: [coautor('SOUZA, P.'), coautor('LINS, ANA B. M.')] }),
            { idLattes: ID, apelidos: ['LINS, ANA B. M.'] });
        assert.strictEqual(r.authorRank, 2);
    });

    // "et.al" vem como ultimo nome da lista: marca lista cortada e nao conta como autor.
    test('"et.al" na lista: cortada, posicao indeterminada fora do 1o lugar', () => {
        const r = API._publicacaoDoItem(artigo({ coautores: [coautor('SOUZA, P.'), coautor('LINS, ANA B. M.', ID), coautor('et.al')] }), { idLattes: ID });
        assert.deepStrictEqual([r.authorsTruncated, r.authorCount, r.authorRank, r.hasEtAl], [true, 2, -1, false]);
        const primeiro = API._publicacaoDoItem(artigo({ coautores: [coautor('LINS, ANA B. M.', ID), coautor('SOUZA, P.'), coautor('et.al')] }), { idLattes: ID });
        assert.deepStrictEqual([primeiro.authorRank, primeiro.isFirstAuthor], [1, true]);
    });

    // A API devolve os autores na mesma ordem "de texto" da pagina (1, 10, 11, 2, ...).
    test('lista inteira com 10+ autores volta a ordem real', () => {
        const real = Array.from({ length: 11 }, (_, i) => 'AUTOR, Q' + (i + 1));
        const comoTexto = [1, 10, 11, 2, 3, 4, 5, 6, 7, 8, 9].map(n => real[n - 1]);
        const r = API._publicacaoDoItem(artigo({ coautores: comoTexto.map(n => coautor(n, n === 'AUTOR, Q10' ? ID : null)) }), { idLattes: ID });
        assert.deepStrictEqual([r.authorOrderRestored, r.authorRank, r.authorCount], [true, 10, 11]);
    });

    test('sem JCR, sem DOI e sem paginas', () => {
        const r = API._publicacaoDoItem(artigo({ vlrImpacto: null, anoJcr: null, urlProducao: null, numeroVolume: '', numeroFasciculo: '', numeroPaginaInicial: '', numeroPaginaFinal: '', citacoes: null }), { idLattes: ID });
        assert.deepStrictEqual([r.impactFactor, r.jcrYear, r.doi, r.wosCitations, r.scopusCitations], [null, null, '', 0, 0]);
        assert.strictEqual(r.issn, '1234-5678');   // o ISSN vem mesmo sem JCR
        assert.strictEqual(r.year, 2024);
    });

    test('entidades HTML do titulo e do periodico sao decodificadas', () => {
        const r = API._publicacaoDoItem(artigo({ tituloProducao: 'Fase 17&amp;#946; (0 &amp;lt; x &#8804; 1)', tituloPeriodicoPublic: 'CRYSTAL GROWTH &amp; DESIGN' }), { idLattes: ID });
        assert.strictEqual(r.paperTitle, 'Fase 17β (0 < x ≤ 1)');
        assert.strictEqual(r.journalName, 'CRYSTAL GROWTH & DESIGN');
    });
});

describe('_titulacaoDoXml', () => {
    const xml = (corpo) => `<formacao><FORMACAO-ACADEMICA-TITULACAO>${corpo}</FORMACAO-ACADEMICA-TITULACAO></formacao>`;
    test('maior nivel concluido, com o ano de obtencao', () => {
        const r = API._titulacaoDoXml(xml(
            '<GRADUACAO ANO-DE-CONCLUSAO="1990" ANO-DE-INICIO="1984" NOME-CURSO="Fisica" STATUS-DO-CURSO="CONCLUIDO"/>' +
            '<MESTRADO ANO-DE-CONCLUSAO="1992" ANO-DE-INICIO="1990" ANO-DE-OBTENCAO-DO-TITULO="1992" NOME-CURSO="Fisica" STATUS-DO-CURSO="CONCLUIDO"/>' +
            '<DOUTORADO ANO-DE-CONCLUSAO="1995" ANO-DE-INICIO="1992" ANO-DE-OBTENCAO-DO-TITULO="1996" NOME-CURSO="Fisica" STATUS-DO-CURSO="CONCLUIDO"/>'));
        assert.deepStrictEqual(r, { nivel: 'D', ano: 1996 });
    });
    test('doutorado em andamento nao conta: fica o mestrado', () => {
        const r = API._titulacaoDoXml(xml(
            '<MESTRADO ANO-DE-CONCLUSAO="2022" ANO-DE-INICIO="2020" NOME-CURSO="Quimica" STATUS-DO-CURSO="CONCLUIDO"/>' +
            '<DOUTORADO ANO-DE-CONCLUSAO="" ANO-DE-INICIO="2022" NOME-CURSO="Quimica" STATUS-DO-CURSO="EM_ANDAMENTO"/>'));
        assert.deepStrictEqual(r, { nivel: 'M', ano: 2022 });
    });
    // caso real: marcado como interrompido, mas com ano de obtencao (concluiu de fato)
    test('interrompido com ano de obtencao conta', () => {
        const r = API._titulacaoDoXml(xml('<DOUTORADO ANO-DE-CONCLUSAO="" ANO-DE-INICIO="2015" ANO-DE-OBTENCAO-DO-TITULO="2019" NOME-CURSO="Fisica" STATUS-DO-CURSO="INCOMPLETO"/>'));
        assert.deepStrictEqual(r, { nivel: 'D', ano: 2019 });
    });
    test('sem formacao, null', () => {
        assert.strictEqual(API._titulacaoDoXml(''), null);
        assert.strictEqual(API._titulacaoDoXml(xml('<DOUTORADO ANO-DE-INICIO="2020" NOME-CURSO="X" STATUS-DO-CURSO="INCOMPLETO"/>')), null);
    });
});

describe('_citacoesDeclaradas', () => {
    test('WoS com indice h no campo proprio, Scopus com o h no argumento', () => {
        const r = API._citacoesDeclaradas([
            { codBaseBibliog: 1, nroCitacoes: 5237, nroIndiceH: 35 },
            { codBaseBibliog: 4, nroCitacoes: 6458, txtArgumento: 'H-Index: 41 - endereco' },
            { codBaseBibliog: 3, nroCitacoes: 5186, nroIndiceH: null, txtArgumento: 'H-Index: 34 - AU-ID(1)' }
        ]);
        assert.deepStrictEqual(r, { wosCitations: 5237, wosHIndex: 35, scopusCitations: 5186, scopusHIndex: 34 });
    });
    test('sem resposta, tudo vazio', () => {
        assert.deepStrictEqual(API._citacoesDeclaradas(null), { wosCitations: '', wosHIndex: '', scopusCitations: '', scopusHIndex: '' });
    });
});

describe('_orientacoes', () => {
    const o = (extra) => Object.assign({ tipoProducao: 'Dissertação de mestrado', tipoOrientacao: 'Concluída', anoProducao: '2020',
        tpoOrientacao: 'ORIENTADOR_PRINCIPAL', curso: 'Física', nomeInstituicaoTese: 'Universidade Exemplo',
        nomeOrientado: 'Fulano de Tal', tituloProducao: 'Um titulo' }, extra || {});
    test('concluidas guardam o ano; em andamento, so a contagem', () => {
        const r = API._orientacoes([o(), o({ anoProducao: '2022' }), o({ tipoOrientacao: 'Em andamento', anoProducao: '2025' })]);
        assert.deepStrictEqual(r.concluded, { 'Dissertação de mestrado': [2020, 2022] });
        assert.deepStrictEqual(r.inCourse, { 'Dissertação de mestrado': 1 });
        assert.strictEqual(r.raw.length, 3);
        assert.deepStrictEqual([r.raw[0].category, r.raw[0].status, r.raw[0].year, r.raw[0].area, r.raw[0].institution],
            ['Dissertação de mestrado', 'Concluída', 2020, 'Mestrado em Física', 'Universidade Exemplo']);
        assert.ok(isNaN(r.raw[2].year));
    });
    test('coorientacao vira categoria propria e a caixa segue a do formato antigo', () => {
        const r = API._orientacoes([o({ tipoProducao: 'Tese de doutorado', tpoOrientacao: 'CO_ORIENTADOR' }), o({ tipoProducao: 'Iniciação Científica', tpoOrientacao: '' })]);
        assert.deepStrictEqual(Object.keys(r.concluded), ['Tese de doutorado (Coorientador)', 'Iniciação científica']);
        assert.strictEqual(r.raw[1].area, 'Graduando em Física');
    });
});

describe('_patentes e _eventos', () => {
    test('patente: a data de registro e o deposito', () => {
        const r = API._patentes([{ tituloProducao: 'Um composto', anoProducao: '2026', dataRegistro: '2026-05-25T03:00:00.000+00:00',
            numeroRegistro: 'BR000', tpoProducao: 'Patente', pais: 'Brasil', institutoDeRegistro: 'INPI', coautores: [coautor('LINS, A.')] }, { tituloProducao: 'sem data' }]);
        assert.strictEqual(r.length, 1);
        assert.deepStrictEqual([r[0].currentStatus, r[0].year, r[0].registro], ['Depósito', 2026, 'BR000']);
        assert.deepStrictEqual([r[0].allStages[0].date.getFullYear(), r[0].allStages[0].date.getMonth(), r[0].allStages[0].date.getDate()], [2026, 4, 25]);
        assert.match(r[0].reference, /Número do registro: BR000,.*Depósito: 25\/05\/2026\.$/);
    });
    test('evento: so participacao; o tipo e a natureza do evento', () => {
        const r = API._eventos([
            { tipoEvento: 'Participação', tipoProducao: 'Congresso', anoProducao: '2021', nomeEvento: 'Encontro X', tituloProducao: 'Uma palestra' },
            { tipoEvento: 'Organização', tipoProducao: 'Congresso', anoProducao: '2021', nomeEvento: 'Encontro Y' }
        ]);
        assert.deepStrictEqual(r, [{ year: 2021, type: 'Congresso', reference: 'Encontro X. Uma palestra. 2021. (Congresso).' }]);
    });
});

describe('lerCurriculo e buscarCurriculo', () => {
    const bruto = {
        estrutura: { cvid: ID, cvdoc: JSON.stringify({ 'NUMERO-IDENTIFICADOR': ID, 'DADOS-GERAIS': { 'NOME-COMPLETO': 'Ana Beatriz Lins', 'NOME-EM-CITACOES-BIBLIOGRAFICAS': 'LINS, ANA B. M.;LINS, A.' } }) },
        citacoes: [{ codBaseBibliog: 1, nroCitacoes: 10, nroIndiceH: 2, txtUriPesquisadorBase: 'http://www.researcherid.com/rid/X-0000-2000' }],
        producao: [artigo(), artigo({ subTipoproducao: 'Apresentações de Trabalho', seqProducao: 78 })]
    };
    test('monta o curriculo inteiro; secao ausente vira vazio', () => {
        const r = API.lerCurriculo(bruto);
        assert.deepStrictEqual(r.identificacao, { name: 'Ana Beatriz Lins', link: 'http://lattes.cnpq.br/' + ID,
            researcherIdLink: 'http://www.researcherid.com/rid/X-0000-2000', fellowshipText: '', fellowshipString: '', fellowshipUnknown: true });
        assert.deepStrictEqual(r.apelidos, ['LINS, ANA B. M.', 'LINS, A.']);
        assert.strictEqual(r.publications.length, 1);
        assert.strictEqual(r.publications[0].authorRank, 2);
        assert.strictEqual(r.titulacao, null);
        assert.deepStrictEqual([r.patentes, r.eventos, r.orientacoes.raw], [[], [], []]);
        assert.deepStrictEqual(API.lerCurriculo(null).publications, []);
    });

    test('buscarCurriculo pede a producao em lotes e tolera secao que falha', async () => {
        const pedidos = [];
        const resposta = (corpo, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => corpo, text: async () => String(corpo) });
        const falso = async (url, init) => {
            const caminho = url.split(ID + '/')[1];
            pedidos.push((init && init.method) || 'GET', caminho);
            if (caminho === 'estrutura') return resposta(bruto.estrutura);
            if (caminho === 'producao/sequencias') return resposta({ seqs: [1, 2, 3], totalElements: 3 });
            if (caminho.startsWith('producao/por-sequencias')) return resposta(JSON.parse(init.body).map(s => artigo({ seqProducao: s })));
            if (caminho === 'citacoes') return resposta(bruto.citacoes);
            if (caminho.startsWith('secao.xml')) return resposta('<formacao/>');
            return resposta(null, false);   // orientacoes, patentes e eventos fora do ar
        };
        const r = await API.buscarCurriculo(ID, { fetch: falso, lote: 2 });
        assert.deepStrictEqual(r.producao.map(p => p.seqProducao), [1, 2, 3]);
        assert.strictEqual(pedidos.filter(p => p.startsWith('producao/por-sequencias')).length, 2);   // lotes de 2
        assert.deepStrictEqual([r.orientacoes, r.patentes, r.eventos], [[], [], []]);
        assert.strictEqual(r.falhas.length, 3);
        assert.strictEqual(API.lerCurriculo(r).publications.length, 3);
    });

    test('buscarCurriculo recusa ID invalido e falha se a identificacao falhar', async () => {
        await assert.rejects(API.buscarCurriculo('123', { fetch: async () => ({}) }), /ID Lattes/);
        await assert.rejects(API.buscarCurriculo(ID, { fetch: async () => ({ ok: false, status: 403 }) }), /HTTP 403/);
    });
});
