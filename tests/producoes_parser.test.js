'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const P = require('./helpers/load.js').producoes();

// Artigo minimo no formato que o parser produz
const art = (o) => Object.assign({
    year: 2024, paperTitle: '', journalName: '', issn: '', doi: '',
    jif: 0, jcrYear: 0, authorCount: 0, authorRank: 0,
    qualis: '', classificacaoRevista: '', volume: '', pages: '', fasciculo: ''
}, o);

describe('tituloChave', () => {
    test('normaliza acentos, caixa e pontuacao', () => {
        assert.strictEqual(P._tituloChave('Ação do Ferro!'), 'acao do ferro');
    });

    test('descarta tags, entidades HTML e formulas $$', () => {
        assert.strictEqual(
            P._tituloChave('Ação do <i>Fe</i>&nbsp;em $$x^2$$ nanotubos!'),
            'acao do fe em nanotubos');
    });

    // $$...$$ sai inteiro; de <math> saem apenas as tags, e o conteudo vira
    // palavras. As duas formas, portanto, NAO produzem a mesma chave — e por
    // isso a deduplicacao nao pode depender so de igualdade exata de titulo
    // (ver 'unifica par com e sem <math>' abaixo).
    test('$$...$$ sai inteiro, mas o conteudo de <math> permanece', () => {
        assert.strictEqual(P._tituloChave('Spin $$S=1/2$$ chains'), 'spin chains');
        assert.strictEqual(P._tituloChave('Spin <math>S=1/2</math> chains'), 'spin s 1 2 chains');
    });

    test('entrada vazia ou nula vira string vazia', () => {
        assert.strictEqual(P._tituloChave(null), '');
        assert.strictEqual(P._tituloChave(''), '');
    });
});

describe('deduplicarArtigos', () => {
    test('unifica a linha do periodico por extenso com a abreviada', () => {
        const r = P._deduplicarArtigos([
            art({ paperTitle: 'Stellar winds', doi: '10.1093/mnras/1', journalName: 'The Astrophysical Journal' }),
            art({ paperTitle: 'Stellar winds', doi: '10.1093/mnras/1', journalName: 'Astrophys J' })
        ]);
        assert.strictEqual(r.removidos, 1);
        assert.strictEqual(r.lista.length, 1);
    });

    test('mantem a linha mais completa (nome por extenso, ISSN, DOI, JCR)', () => {
        const r = P._deduplicarArtigos([
            art({ paperTitle: 'Stellar winds', doi: '10.1093/mnras/1', journalName: 'Astrophys J' }),
            art({ paperTitle: 'Stellar winds', doi: '10.1093/mnras/1', journalName: 'The Astrophysical Journal', issn: '0035-8711' })
        ]);
        assert.strictEqual(r.lista[0].journalName, 'The Astrophysical Journal');
        assert.strictEqual(r.lista[0].issn, '0035-8711');
    });

    // A razao de ser da regra: grandes colaboracoes trazem artigos DIFERENTES
    // sob o mesmo DOI errado. DOI igual nao pode, sozinho, unificar.
    test('NAO unifica artigos distintos que compartilham o mesmo DOI errado', () => {
        const r = P._deduplicarArtigos([
            art({ paperTitle: 'Measurement of the Higgs boson mass', doi: '10.1016/j.physletb.2020.1' }),
            art({ paperTitle: 'Search for dark matter in dilepton events', doi: '10.1016/j.physletb.2020.1' })
        ]);
        assert.strictEqual(r.removidos, 0);
        assert.strictEqual(r.lista.length, 2);
    });

    test('sem DOI, exige titulo identico E mesmo ano', () => {
        const mesmoAno = P._deduplicarArtigos([
            art({ paperTitle: 'Raman spectroscopy', year: 2020 }),
            art({ paperTitle: 'Raman spectroscopy', year: 2020 })
        ]);
        assert.strictEqual(mesmoAno.removidos, 1);

        const anosDiferentes = P._deduplicarArtigos([
            art({ paperTitle: 'Raman spectroscopy', year: 2020 }),
            art({ paperTitle: 'Raman spectroscopy', year: 2021 })
        ]);
        assert.strictEqual(anosDiferentes.removidos, 0);
    });

    test('preenche na linha vencedora os campos que so a descartada tinha', () => {
        const r = P._deduplicarArtigos([
            art({ paperTitle: 'Phase transitions', doi: '10.1103/x', journalName: 'Physical Review Letters', qualis: '' }),
            art({ paperTitle: 'Phase transitions', doi: '10.1103/x', journalName: 'PRL', qualis: 'A1', jif: 8.1 })
        ]);
        assert.strictEqual(r.lista.length, 1);
        assert.strictEqual(r.lista[0].journalName, 'Physical Review Letters');
        assert.strictEqual(r.lista[0].qualis, 'A1', 'qualis veio da linha descartada');
        assert.strictEqual(r.lista[0].jif, 8.1, 'jif veio da linha descartada');
    });

    test('recalcula primeiro/ultimo autor apos a mesclagem', () => {
        const r = P._deduplicarArtigos([
            art({ paperTitle: 'Thermal analysis', doi: '10.1007/y', journalName: 'Journal of Thermal Analysis' }),
            art({ paperTitle: 'Thermal analysis', doi: '10.1007/y', journalName: 'J Therm Anal', authorCount: 4, authorRank: 4 })
        ]);
        assert.strictEqual(r.lista[0].authorRank, 4);
        assert.strictEqual(r.lista[0].isLastAuthor, true);
        assert.strictEqual(r.lista[0].isFirstAuthor, false);
    });

    // O caso que a regra de sobreposicao existe para resolver: a chave exata
    // difere ('spin s 1 2 chains' vs 'spin chains'), mas com o mesmo DOI, mesmo
    // ano e paginacao compativel as palavras se sobrepoem o bastante.
    test('unifica par com e sem <math> apesar de a chave exata diferir', () => {
        const r = P._deduplicarArtigos([
            art({ paperTitle: 'Spin <math>S=1/2</math> chains', doi: '10.1103/z', journalName: 'Physical Review B' }),
            art({ paperTitle: 'Spin chains', doi: '10.1103/z', journalName: 'Phys Rev B' })
        ]);
        assert.strictEqual(r.removidos, 1);
        assert.strictEqual(r.lista.length, 1);
    });

    test('nao deixa a chave temporaria _chave no resultado', () => {
        const r = P._deduplicarArtigos([art({ paperTitle: 'Qualquer coisa' })]);
        assert.ok(!('_chave' in r.lista[0]), '_chave deveria ter sido removida');
    });

    test('lista vazia nao quebra', () => {
        const r = P._deduplicarArtigos([]);
        assert.deepStrictEqual(r, { lista: [], removidos: 0 });
    });
});

describe('doiDeChamada', () => {
    test('extrai DOI do formato com barras invertidas da pagina', () => {
        assert.strictEqual(
            P.doiDeChamada('HTTP:\\\\DX.DOI.ORG\\10.1093/mnras/stab123'),
            '10.1093/mnras/stab123');
    });

    test('aceita tambem barras normais', () => {
        assert.strictEqual(
            P.doiDeChamada('http://dx.doi.org/10.1016/j.cej.2019.05.001'),
            '10.1016/j.cej.2019.05.001');
    });

    test('devolve vazio quando nao ha DOI', () => {
        assert.strictEqual(P.doiDeChamada('sem doi aqui'), '');
        assert.strictEqual(P.doiDeChamada(null), '');
    });
});

describe('urlDoi', () => {
    test('monta a URL canonica', () => {
        assert.strictEqual(P.urlDoi('10.1093/x'), 'https://doi.org/10.1093/x');
    });
    test('DOI vazio nao vira link', () => {
        assert.strictEqual(P.urlDoi(''), '');
    });
});

describe('_periodico', () => {
    test('separa nome e ISSN', () => {
        assert.deepStrictEqual(
            P._periodico('MONTHLY NOTICES OF THE RAS (ISSN:0035-8711)'),
            { nome: 'MONTHLY NOTICES OF THE RAS', issn: '0035-8711' });
    });

    test('aceita ISBN no lugar de ISSN', () => {
        assert.strictEqual(P._periodico('Livro tal (ISBN: 978-85-333)').issn, '978-85-333');
    });

    test('sem parenteses, o texto inteiro e o nome', () => {
        assert.deepStrictEqual(P._periodico('Nature'), { nome: 'Nature', issn: '' });
    });
});

describe('_fatorImpacto', () => {
    test('separa fator e ano', () => {
        assert.deepStrictEqual(P._fatorImpacto('5.2 (2025)'), { jif: 5.2, ano: 2025 });
    });
    test('aceita virgula como separador decimal', () => {
        assert.strictEqual(P._fatorImpacto('5,2 (2025)').jif, 5.2);
    });
    test('traco e vazio viram zero', () => {
        assert.deepStrictEqual(P._fatorImpacto('-'), { jif: 0, ano: 0 });
        assert.deepStrictEqual(P._fatorImpacto(''), { jif: 0, ano: 0 });
    });
});

describe('_classificar', () => {
    test('reconhece artigos completos e patentes', () => {
        assert.strictEqual(P._classificar('Artigos completos publicados em periodicos').tipo, 'artigos');
        assert.strictEqual(P._classificar('Patentes').tipo, 'patentes');
    });

    test('deriva a categoria da orientacao concluida', () => {
        assert.strictEqual(P._classificar('Orientacoes concluidas de mestrado').categoria, 'Dissertação de mestrado');
        assert.strictEqual(P._classificar('Orientacoes concluidas de iniciacao cientifica').categoria, 'Iniciação científica');
    });

    test('distingue doutorado de pos-doutorado', () => {
        assert.strictEqual(P._classificar('Orientacoes concluidas de doutorado').categoria, 'Tese de doutorado');
        assert.strictEqual(P._classificar('Orientacoes concluidas de pos-doutorado').categoria, 'Supervisão de pós-doutorado');
    });

    test('marca coorientacao', () => {
        assert.strictEqual(
            P._classificar('Co-orientacoes concluidas de mestrado').categoria,
            'Dissertação de mestrado (Coorientador)');
    });

    test('secoes fora do relatorio devolvem null', () => {
        assert.strictEqual(P._classificar('Trabalhos completos publicados em anais'), null);
        assert.strictEqual(P._classificar('Livros publicados'), null);
        assert.strictEqual(P._classificar(''), null);
    });
});

describe('converterLinksDoi', () => {
    test('troca o onclick por um href de verdade', () => {
        const entrada = '<a onclick="abrirDOI(\'HTTP:\\\\DX.DOI.ORG\\10.1093/x\')">ver</a>';
        const saida = P.converterLinksDoi(entrada);
        assert.match(saida, /href="https:\/\/doi\.org\/10\.1093\/x"/);
        assert.match(saida, /rel="noopener noreferrer"/);
        assert.doesNotMatch(saida, /onclick/);
    });

    test('deixa intacto o link sem DOI reconhecivel', () => {
        const entrada = '<a onclick="abrirDOI(\'nada\')">x</a>';
        assert.strictEqual(P.converterLinksDoi(entrada), entrada);
    });
});
