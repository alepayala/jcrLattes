'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const N = require('./helpers/load.js').lattesNovo();

// Leitor do Lattes novo (busca-cv-lattes.cnpq.br). Aqui so as regras de texto; o que
// depende do DOM (abrir secoes, achar os <li>) e conferido numa pagina real. Os nomes,
// titulos e DOIs sao ficticios, no formato que o site escreve.

describe('_jcrDoBalao', () => {
    test('nome, ISSN com hifen, ano e valor do JCR', () => {
        assert.deepStrictEqual(N._jcrDoBalao(' Journal of Exemplo C (19327447) \n Fator de impacto (JCR 2025): 3.4 '),
            { journalName: 'Journal of Exemplo C', issn: '1932-7447', jcrYear: '2025', impactFactor: '3.4' });
    });
    test('ISSN terminado em X e nome com parenteses proprios', () => {
        const r = N._jcrDoBalao('Revista (Impresso) de Teste (0103507x) Fator de impacto (JCR 2025): 0.9');
        assert.strictEqual(r.issn, '0103-507X');
        assert.strictEqual(r.journalName, 'Revista (Impresso) de Teste');
    });
    test('sem balao nao inventa nada', () => {
        assert.deepStrictEqual(N._jcrDoBalao(''), { journalName: '', issn: '', jcrYear: null, impactFactor: null });
    });
});

describe('_anoDaReferencia', () => {
    test('o ano e o que fecha a referencia, nao um numero de pagina ou volume', () => {
        assert.strictEqual(N._anoDaReferencia('SILVA, A. . Titulo de 1999. Revista , v. 2024, p. 2001 - 2010 , 2026.'), 2026);
    });
    test('sem ano no fim, NaN', () => {
        assert.ok(isNaN(N._anoDaReferencia('SILVA, A. . Titulo. Revista , v. 2')));
    });
});

describe('_doiDoEndereco / _idLattesDoEndereco', () => {
    test('DOI sem o prefixo do site', () => {
        assert.strictEqual(N._doiDoEndereco('https://doi.org/10.5555/exemplo.2026.0001'), '10.5555/exemplo.2026.0001');
        assert.strictEqual(N._doiDoEndereco(''), '');
        // caso real: DOI antigo com < e >, que o site escreve como entidades
        assert.strictEqual(N._doiDoEndereco('https://doi.org/10.5555/1097-4555(200101)32:1&lt;27::AID-X&gt;3.0.CO;2-H'), '10.5555/1097-4555(200101)32:1<27::AID-X>3.0.CO;2-H');
    });
    test('ID Lattes do endereco do curriculo', () => {
        assert.strictEqual(N._idLattesDoEndereco('https://busca-cv-lattes.cnpq.br/curriculo/9000100000000000'), '9000100000000000');
        assert.strictEqual(N._idLattesDoEndereco('/curriculo/123'), '');
    });
});

describe('ehPaginaDoCurriculo', () => {
    test('so o endereco do curriculo, nao a busca nem a impressao', () => {
        assert.strictEqual(N.ehPaginaDoCurriculo('https://busca-cv-lattes.cnpq.br/curriculo/9000100000000000'), true);
        assert.strictEqual(N.ehPaginaDoCurriculo('https://busca-cv-lattes.cnpq.br/curriculo/9000100000000000?x=1'), true);
        assert.strictEqual(N.ehPaginaDoCurriculo('https://busca-cv-lattes.cnpq.br/curriculo/9000100000000000/imprimir'), false);
        assert.strictEqual(N.ehPaginaDoCurriculo('https://busca-cv-lattes.cnpq.br/busca'), false);
        assert.strictEqual(N.ehPaginaDoCurriculo('https://buscatextual.cnpq.br/buscatextual/visualizacv.do?id=K1'), false);
    });
});

describe('_publicacaoDasPartes', () => {
    const partes = (extra) => Object.assign({
        autores: ' ROCHA, C. E. T. ; LINS, ANA B. M. ; Tavares, Carlos ; SOUZA, P. . ',
        titulo: ' Propriedades opticas de filmes finos de exemplo.',
        periodico: ' Journal of Exemplo C',
        balao: ' Journal of Exemplo C (19327447) Fator de impacto (JCR 2025): 3.4 ',
        anoTexto: 'ROCHA, C. E. T. ; ... Journal of Exemplo C , v. 130, p. 8512 - 8525 , 2026.',
        doiHref: 'https://doi.org/10.5555/exemplo.2026.0001',
        wos: '12', scopus: ' 15 ',
        referencia: ' ROCHA, C. E. T. ; LINS, ANA B. M. ; Tavares, Carlos ; SOUZA, P. . Propriedades opticas de filmes finos de exemplo. Journal of Exemplo C , v. 130, p. 8512 - 8525 , 2026.'
    }, extra || {});

    test('mesmos campos do leitor antigo', () => {
        const r = N._publicacaoDasPartes(partes(), { apelidos: ['LINS, A. B. M.', 'Lins, Ana B. M.'] });
        assert.strictEqual(r.year, 2026);
        assert.strictEqual(r.issn, '1932-7447');
        assert.strictEqual(r.journalName, 'Journal of Exemplo C');
        assert.strictEqual(r.paperTitle, 'Propriedades opticas de filmes finos de exemplo');
        assert.strictEqual(r.impactFactor, '3.4');
        assert.strictEqual(r.jcrYear, '2025');
        assert.deepStrictEqual([r.wosCitations, r.scopusCitations], [12, 15]);
        assert.strictEqual(r.doi, '10.5555/exemplo.2026.0001');
        assert.strictEqual(r.authorCount, 4);
        assert.strictEqual(r.authorRank, 2);
        assert.deepStrictEqual([r.isFirstAuthor, r.isLastAuthor, r.hasEtAl], [false, false, false]);
        assert.ok(r.reference.startsWith('ROCHA, C. E. T. ; LINS'));
    });

    test('primeiro e ultimo autor pelos apelidos (o site novo nao destaca o nome)', () => {
        assert.strictEqual(N._publicacaoDasPartes(partes(), { apelidos: ['ROCHA, C. E. T.'] }).isFirstAuthor, true);
        const ult = N._publicacaoDasPartes(partes(), { apelidos: ['SOUZA, P.'] });
        assert.deepStrictEqual([ult.authorRank, ult.isLastAuthor], [4, true]);
    });

    test('sem apelido que case, a posicao fica desconhecida', () => {
        assert.strictEqual(N._publicacaoDasPartes(partes(), { apelidos: ['OUTRO, X.'] }).authorRank, -1);
    });

    // No site novo "et.al" e lista cortada, nao grande colaboracao: caso real de um
    // artigo com 9 autores no formato antigo que vem com 5 nomes e "et.al".
    test('"et.al" marca lista cortada, sem virar grande colaboracao', () => {
        const r = N._publicacaoDasPartes(partes({ autores: 'SOUZA, P. ; LINS, ANA B. M. ; et.al . ' }), { apelidos: ['LINS, ANA B. M.'] });
        assert.strictEqual(r.authorsTruncated, true);
        assert.strictEqual(r.hasEtAl, false);
        assert.strictEqual(r.authorCount, 2);          // so o que foi listado
        assert.strictEqual(r.authorRank, -1);          // fora do 1o lugar a posicao e indeterminada
        assert.strictEqual(r.isFirstAuthor, false);
        assert.strictEqual(r.isLastAuthor, false);     // nao da para saber quem fecha a lista
        // o 1o lugar vale mesmo com a lista cortada (conferido pelo DOI em 71 artigos)
        const primeiro = N._publicacaoDasPartes(partes({ autores: 'LINS, ANA B. M. ; SOUZA, P. ; et.al . ' }), { apelidos: ['LINS, ANA B. M.'] });
        assert.deepStrictEqual([primeiro.authorRank, primeiro.isFirstAuthor, primeiro.authorsTruncated], [1, true, true]);
        assert.strictEqual(N._publicacaoDasPartes(partes(), {}).authorsTruncated, false);
    });

    test('grande colaboracao so pela palavra ou pelo tamanho da lista', () => {
        assert.strictEqual(N._publicacaoDasPartes(partes({ autores: 'SOUZA, P. ; EXEMPLO COLLABORATION . ' }), {}).hasEtAl, true);
        const muitos = Array.from({ length: 21 }, (_, i) => 'AUTOR, N' + i).join(' ; ') + ' . ';
        const r = N._publicacaoDasPartes(partes({ autores: muitos }), {});
        assert.deepStrictEqual([r.hasEtAl, r.authorCount], [true, 21]);
    });

    // O site novo ordena as posicoes de autoria como texto (1, 10, 11, ..., 2, 3, ...).
    // Caso real: artigo de 19 autores em que o dono do CV e o 15o e aparece em 7o.
    test('lista de 10+ autores volta a ordem real', () => {
        const reais = Array.from({ length: 19 }, (_, i) => 'AUTOR, P' + (i + 1));
        const comoOSiteMostra = [1, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 2, 3, 4, 5, 6, 7, 8, 9].map(n => reais[n - 1]);
        assert.deepStrictEqual(N._desfazerOrdemDeTexto(comoOSiteMostra), reais);
        const r = N._publicacaoDasPartes(partes({
            autores: comoOSiteMostra.join(' ; ') + ' . ',
            referencia: comoOSiteMostra.join(' ; ') + ' . Um titulo. Revista , v. 1, p. 2, 2026.'
        }), { apelidos: ['AUTOR, P15'] });
        assert.strictEqual(comoOSiteMostra.indexOf('AUTOR, P15'), 6);     // 7o na pagina
        assert.strictEqual(r.authorRank, 15);
        assert.strictEqual(r.authorOrderRestored, true);
        assert.ok(r.reference.startsWith('AUTOR, P1 ; AUTOR, P2 ; AUTOR, P3'));
        assert.ok(r.reference.endsWith('. Um titulo. Revista , v. 1, p. 2, 2026.'));
        const ultimo = N._publicacaoDasPartes(partes({ autores: comoOSiteMostra.join(' ; ') + ' . ' }), { apelidos: ['AUTOR, P19'] });
        assert.deepStrictEqual([ultimo.authorRank, ultimo.isLastAuthor], [19, true]);
    });

    test('menos de 10 autores, ou lista cortada, ficam como vieram', () => {
        const nove = Array.from({ length: 9 }, (_, i) => 'AUTOR, P' + (i + 1));
        assert.deepStrictEqual(N._desfazerOrdemDeTexto(nove), nove);
        const onze = Array.from({ length: 11 }, (_, i) => 'AUTOR, Q' + (i + 1));
        const r = N._publicacaoDasPartes(partes({ autores: onze.join(' ; ') + ' ; et.al . ' }), { apelidos: ['AUTOR, Q2'] });
        assert.deepStrictEqual([r.authorOrderRestored, r.authorsTruncated, r.authorRank], [false, true, -1]);
    });

    test('100 autores: 1, 10, 100, 11, ...', () => {
        const reais = Array.from({ length: 100 }, (_, i) => 'A' + (i + 1));
        const site = reais.map((_, i) => i + 1).sort((a, b) => (String(a) < String(b) ? -1 : 1)).map(n => reais[n - 1]);
        assert.deepStrictEqual(site.slice(0, 4), ['A1', 'A10', 'A100', 'A11']);
        assert.deepStrictEqual(N._desfazerOrdemDeTexto(site), reais);
    });

    // Caso real: o artigo traz "LINS, A" e o apelido declarado e "LINS, A.".
    test('apelido casa sem depender de ponto, caixa ou espacos', () => {
        assert.strictEqual(N._ordemPelosApelidos(['SOUZA, P.', 'LINS, A'], ['LINS, A.']), 2);
        assert.strictEqual(N._ordemPelosApelidos(['Lins,  Ana B M', 'SOUZA, P.'], ['LINS, ANA B. M.']), 1);
        assert.strictEqual(N._ordemPelosApelidos(['SOUZA, P.'], []), -1);
    });

    // O nome inteiro igual vence o apelido apenas contido no nome de outro autor.
    test('nome identico tem prioridade sobre apelido contido', () => {
        assert.strictEqual(N._ordemPelosApelidos(['LINS, ANDRE', 'LINS, A'], ['LINS, A.']), 2);
    });

    test('artigo sem JCR e sem citacoes', () => {
        const r = N._publicacaoDasPartes(partes({ balao: '', wos: 0, scopus: 0 }), {});
        assert.strictEqual(r.impactFactor, null);
        assert.strictEqual(r.jcrYear, null);
        assert.strictEqual(r.issn, '');
        assert.strictEqual(r.journalName, 'Journal of Exemplo C');
        assert.deepStrictEqual([r.wosCitations, r.scopusCitations], [0, 0]);
    });
});

describe('orientacoes e eventos', () => {
    test('categoria de orientacao na forma do formato antigo', () => {
        assert.strictEqual(N._categoriaDeOrientacao(' Iniciação Científica '), 'Iniciação científica');
        assert.strictEqual(N._categoriaDeOrientacao('Tese de doutorado'), 'Tese de doutorado');
        assert.strictEqual(N._categoriaDeOrientacao('Supervisão de pós-doutorado'), 'Supervisão de pós-doutorado');
    });
    // pos-doutorado vem sem parenteses: a instituicao e o que segue o travessao
    test('sem area entre parenteses, a instituicao vem depois do travessao', () => {
        assert.deepStrictEqual(
            N._areaEInstituicao('Fulano de Tal. 2026. Supervisão de pós-doutorado – Universidade Federal Exemplo, Agência de Fomento. (Orientador).'),
            { area: '', institution: 'Universidade Federal Exemplo' });
    });

    test('instituicao da orientacao vem depois do travessao', () => {
        assert.deepStrictEqual(
            N._areaEInstituicao('Fulano de Tal. Um titulo. 2026. Dissertação (Mestrado em Física). – Universidade Federal Exemplo, Agência de Fomento. (Orientador).'),
            { area: 'Mestrado em Física', institution: 'Universidade Federal Exemplo' });
    });
    test('tipo do evento e o parentese do fim', () => {
        assert.strictEqual(N._tipoDoEvento('IV Semana de Exemplo. Um titulo (com parenteses) no meio. 2021. (Congresso).'), 'Congresso');
        assert.strictEqual(N._tipoDoEvento('Evento sem tipo. 2021.'), 'Desconhecido');
    });
});
