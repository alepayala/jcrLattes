'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const R = require('./helpers/load.js').relatorio();

describe('formatNum / getAvg', () => {
    test('sempre duas casas decimais', () => {
        assert.strictEqual(R.formatNum(3), '3.00');
        assert.strictEqual(R.formatNum(3.456), '3.46');
    });

    test('media divide soma por contagem', () => {
        assert.strictEqual(R.getAvg(10, 4), '2.50');
    });

    test('contagem zero nao vira divisao por zero', () => {
        assert.strictEqual(R.getAvg(10, 0), '0.00');
        assert.strictEqual(R.getAvg(0, 0), '0.00');
    });
});

describe('getSoftColor', () => {
    test('clareia na direcao do branco conforme o fator', () => {
        assert.strictEqual(R.getSoftColor('#000000', 0), 'rgb(0, 0, 0)');
        assert.strictEqual(R.getSoftColor('#000000', 1), 'rgb(255, 255, 255)');
        assert.strictEqual(R.getSoftColor('#000000', 0.85), 'rgb(217, 217, 217)');
    });

    test('aceita a forma curta de 3 digitos', () => {
        assert.strictEqual(R.getSoftColor('#fff', 0), 'rgb(255, 255, 255)');
    });

    test('descarta o canal alpha de #rrggbbaa', () => {
        assert.strictEqual(R.getSoftColor('#3daa4380', 0), R.getSoftColor('#3daa43', 0));
    });

    test('funciona sem o # inicial', () => {
        assert.strictEqual(R.getSoftColor('3daa43', 0), 'rgb(61, 170, 67)');
    });
});

describe('_esc', () => {
    test('escapa os caracteres que quebrariam o HTML', () => {
        assert.strictEqual(R._esc('<script>'), '&lt;script&gt;');
        assert.strictEqual(R._esc('a & b'), 'a &amp; b');
        assert.strictEqual(R._esc('diz "oi"'), 'diz &quot;oi&quot;');
    });

    test('escapa o & antes dos demais, sem escape duplo invertido', () => {
        assert.strictEqual(R._esc('&lt;'), '&amp;lt;');
    });
});

describe('_safeUrl', () => {
    test('deixa passar http e https', () => {
        assert.strictEqual(R._safeUrl('https://doi.org/10.1/x'), 'https://doi.org/10.1/x');
        assert.strictEqual(R._safeUrl('http://exemplo.br'), 'http://exemplo.br');
    });

    // O ponto da funcao: nada que nao seja http(s) vira href.
    test('recusa javascript:, data: e caminhos relativos', () => {
        assert.strictEqual(R._safeUrl('javascript:alert(1)'), '');
        assert.strictEqual(R._safeUrl('data:text/html,<script>'), '');
        assert.strictEqual(R._safeUrl('/caminho/local'), '');
        assert.strictEqual(R._safeUrl(''), '');
        assert.strictEqual(R._safeUrl(null), '');
    });

    test('escapa aspas da URL aceita', () => {
        assert.strictEqual(R._safeUrl('https://x.br/?a="b"'), 'https://x.br/?a=&quot;b&quot;');
    });
});

describe('calculateReportStats', () => {
    const pubs = [
        { year: 2024, jif: 9.0, authorCount: 3, authorRank: 1 }, // high  (>= 5)
        { year: 2024, jif: 3.0, authorCount: 2, authorRank: 2 }, // mid   (>= 2)
        { year: 2024, jif: 1.0, authorCount: 2, authorRank: 2 }, // low   (<  2)
        { year: 2024, jif: 0,   authorCount: 1, authorRank: 1 }  // noJcr
    ];
    // (pubs, patents, events, supervisions, declaredCitations, currentYear,
    //  customYears, startRecent, startLast10, startCustom, highJcr, lowJcr)
    const stats = R.calculateReportStats(pubs, [], [], {}, null, 2026, 5, 2022, 2016, 2021, 5, 2);

    test('classifica cada artigo na faixa de JCR correta', () => {
        assert.strictEqual(stats.all.high.count, 1);
        assert.strictEqual(stats.all.mid.count, 1);
        assert.strictEqual(stats.all.low.count, 1);
        assert.strictEqual(stats.all.noJcr, 1);
    });

    test('soma o fator de impacto so dos artigos com JCR', () => {
        assert.strictEqual(stats.all.total.countWithJcr, 3);
        assert.strictEqual(stats.all.total.sum, 13);
        assert.strictEqual(stats.all.total.count, 4);
    });

    test('deduz primeiro autor de authorRank quando isFirstAuthor nao vem', () => {
        assert.strictEqual(stats.all.total.firstAuthorCount, 2);
    });

    test('ultimo autor exige rank igual a contagem e mais de um autor', () => {
        assert.strictEqual(stats.all.total.lastAuthorCount, 2);
    });

    test('artigo marcado com et al entra em gcCount e fica fora do nao-GC', () => {
        const comEtAl = R.calculateReportStats(
            [{ year: 2024, jif: 4.0, authorCount: 900, authorRank: 500, hasEtAl: true }],
            [], [], {}, null, 2026, 5, 2022, 2016, 2021, 5, 2);
        assert.strictEqual(comEtAl.all.total.gcCount, 1);
        assert.strictEqual(comEtAl.all.total.countNonGc, 0);
        assert.strictEqual(comEtAl.all.total.sumAuthorsNonGc, 0);
    });

    test('lista vazia devolve estrutura zerada, sem quebrar', () => {
        const vazio = R.calculateReportStats([], [], [], {}, null, 2026, 5, 2022, 2016, 2021, 5, 2);
        assert.strictEqual(vazio.all.total.count, 0);
        assert.strictEqual(vazio.all.noJcr, 0);
    });
});
