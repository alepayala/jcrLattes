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

// A faixa de JCR estava repetida em cinco lugares (tres em report_utils, uma em
// db_tools e uma em content.js). Um limiar interpretado de forma diferente em
// qualquer uma faria os mesmos artigos cairem em faixas distintas conforme a tela.
describe('faixaDeJcr', () => {
    const faixa = (v) => R.faixaDeJcr(v, 7.0, 1.5);

    test('os limiares sao inclusivos', () => {
        assert.strictEqual(faixa(7.0), 'high');
        assert.strictEqual(faixa(1.5), 'mid');
    });

    test('logo abaixo do limiar cai na faixa de baixo', () => {
        assert.strictEqual(faixa(6.999), 'mid');
        assert.strictEqual(faixa(1.4999), 'low');
    });

    test('aceita o valor como texto, que e como vem do PDF e do CV', () => {
        assert.strictEqual(faixa('12.5'), 'high');
        assert.strictEqual(faixa('3'), 'mid');
        assert.strictEqual(faixa('0.8'), 'low');
    });

    // "Sem JCR" nao e o mesmo que "JCR baixo": o artigo existe, so nao tem fator
    // de impacto conhecido, e e contado numa coluna propria.
    test('ausente, vazio, zero e negativo sao noJcr, nao low', () => {
        [null, undefined, '', 0, '0', -2].forEach(v => {
            assert.strictEqual(faixa(v), 'noJcr', JSON.stringify(v));
        });
    });

    test('texto nao numerico tambem e noJcr', () => {
        assert.strictEqual(faixa('abc'), 'noJcr');
    });

    test('respeita limiares diferentes dos padroes', () => {
        assert.strictEqual(R.faixaDeJcr(6, 10, 5), 'mid');
        assert.strictEqual(R.faixaDeJcr(6, 1, 0.1), 'high');
    });
});

// O fator de impacto tem dois formatos: impactFactor em memoria (o que os leitores
// devolvem) e jif no banco (extractData converte ao salvar). Este acessor cobre o
// caso comum; o filtro do relatorio em db_tools inverte a ordem de proposito,
// porque la os dados vem do banco.
describe('valorJcr', () => {
    test('prefere impactFactor, o formato em memoria', () => {
        assert.strictEqual(R.valorJcr({ impactFactor: '3.5', jif: 9 }), '3.5');
    });

    test('usa jif quando nao ha impactFactor', () => {
        assert.strictEqual(R.valorJcr({ jif: 2.4 }), 2.4);
    });

    // impactFactor: 0 e um valor lido, nao ausencia: nao pode cair para o jif
    test('impactFactor zero nao e tratado como ausente', () => {
        assert.strictEqual(R.valorJcr({ impactFactor: 0, jif: 9 }), 0);
    });

    test('sem nenhum dos dois, devolve undefined', () => {
        assert.strictEqual(R.valorJcr({}), undefined);
        assert.strictEqual(R.valorJcr(null), undefined);
    });
});

// O agrupamento por periodico e mais complicado do que parece: o mesmo periodico
// chega com grafias diferentes, as vezes com ISSN e as vezes sem, e o fator de
// impacto nem sempre vem. Saiu de dentro de generateJournalTableHTML.
describe('agruparPorPeriodico', () => {
    const P = (nome, issn, jif, ano) => ({ journalName: nome, issn, jif, year: ano, wosCitations: 0, scopusCitations: 0 });
    const nomes = (r) => r.map(j => j.name).sort();

    test('o ISSN une grafias diferentes do mesmo periodico', () => {
        const r = R.agruparPorPeriodico([
            P('Physical Review B', '1098-0121', 3.9, 2022),
            P('PHYS REV B', '1098-0121', 3.9, 2021),
        ], 0, 2026);
        assert.strictEqual(r.length, 1);
        assert.strictEqual(r[0].count, 2);
    });

    test('sem ISSN, une pelo nome quando o JIF bate', () => {
        const r = R.agruparPorPeriodico([
            P('Nature Physics', '', 19.6, 2022),
            P('NATURE PHYSICS', '', 19.6, 2021),
        ], 0, 2026);
        assert.strictEqual(r.length, 1);
        assert.strictEqual(r[0].count, 2);
    });

    // Mesmo nome com JIF diferente sao periodicos distintos, nao um erro de grafia.
    test('mesmo nome com JIF diferente fica separado', () => {
        const r = R.agruparPorPeriodico([
            P('Acta Cientifica', '', 1.2, 2022),
            P('Acta Cientifica', '', 4.8, 2021),
        ], 0, 2026);
        assert.strictEqual(r.length, 2);
    });

    test('artigo sem JIF entra no grupo mais populoso daquele nome', () => {
        const r = R.agruparPorPeriodico([
            P('Revista X', '', 2.0, 2022), P('Revista X', '', 2.0, 2021),
            P('Revista X', '', 0, 2020), P('Revista X', '', 0, 2019),
        ], 0, 2026);
        assert.strictEqual(r.length, 1);
        assert.strictEqual(r[0].count, 4);
        assert.strictEqual(r[0].jif, 2);
    });

    // O nome vem do Lattes com sufixos entre parenteses, as vezes mais de um.
    test('descarta sufixos entre parenteses, inclusive repetidos', () => {
        const r = R.agruparPorPeriodico([
            P('Journal of Physics (Print) (Online)', '', 2.2, 2022),
            P('Journal of Physics', '', 2.2, 2021),
        ], 0, 2026);
        assert.strictEqual(r.length, 1);
        assert.strictEqual(r[0].name, 'Journal of Physics');
    });

    test('o corte de anos descarta o que e mais antigo', () => {
        const pubs = [P('Rev W', '', 1, 1990), P('Rev W', '', 1, 2022)];
        assert.strictEqual(R.agruparPorPeriodico(pubs, 0, 2026)[0].count, 2);   // 0 = sem corte
        assert.strictEqual(R.agruparPorPeriodico(pubs, 5, 2026)[0].count, 1);
    });

    test('publicacao sem nome de periodico e ignorada', () => {
        const r = R.agruparPorPeriodico([P('', '1234-5678', 3, 2022)], 0, 2026);
        assert.deepStrictEqual(r, []);
    });

    test('entrada invalida devolve lista vazia', () => {
        assert.deepStrictEqual(R.agruparPorPeriodico([], 0, 2026), []);
        assert.deepStrictEqual(R.agruparPorPeriodico(null, 0, 2026), []);
    });
});

// Classificacao de orientacoes: eram closures dentro do grafico por ano. A ordem
// dos testes importa mais do que parece — "pos-doutorado" contem "doutorado".
describe('tipoDeOrientacao', () => {
    const t = (cat, ref) => R.tipoDeOrientacao({ category: cat, reference: ref || '' });

    test('reconhece os tipos principais', () => {
        assert.strictEqual(t('Tese de doutorado'), 'doutorado');
        assert.strictEqual(t('Dissertação de mestrado'), 'mestrado');
        assert.strictEqual(t('Iniciação científica'), 'ic');
    });

    // Inverter a ordem faria TODA supervisao de pos-doutorado virar doutorado,
    // inflando justamente a contagem que mais pesa na avaliacao.
    test('pos-doutorado nao e lido como doutorado, em nenhuma das grafias', () => {
        ['Supervisão de pós-doutorado', 'Supervisao de pos-doutorado',
         'Supervisão de pós doutorado', 'Supervisao de pos doutorado'].forEach(c => {
            assert.strictEqual(t(c), 'posdoc', c);
        });
    });

    test('pos-doutorado tambem e reconhecido pela referencia', () => {
        assert.strictEqual(t('Outras', 'estágio de pós-doutorado no exterior'), 'posdoc');
    });

    test('o que nao casa com nenhum tipo vai para outras', () => {
        assert.strictEqual(t('Orientações de outra natureza'), 'outras');
        assert.strictEqual(t('Trabalho de conclusão de curso de graduação'), 'outras');
        assert.strictEqual(t(''), 'outras');
    });
});

describe('ehCoorientacao', () => {
    test('reconhece as duas grafias, na categoria ou na referencia', () => {
        assert.strictEqual(R.ehCoorientacao({ category: 'Tese de doutorado (Coorientador)' }), true);
        assert.strictEqual(R.ehCoorientacao({ category: 'Tese', reference: 'Co-orientador: Fulano' }), true);
    });

    test('orientacao comum nao e coorientacao', () => {
        assert.strictEqual(R.ehCoorientacao({ category: 'Tese de doutorado', reference: 'Orientador: Fulano' }), false);
        assert.strictEqual(R.ehCoorientacao({}), false);
    });
});

describe('subtipoDeOutras', () => {
    const s = (cat, ref) => R.subtipoDeOutras({ category: cat, reference: ref || '' });

    test('agrupa graduacao e TCC sob o mesmo rotulo', () => {
        assert.strictEqual(s('Trabalho de conclusão de curso de graduação'), 'TCC / Graduação');
    });

    test('agrupa especializacao e aperfeicoamento', () => {
        assert.strictEqual(s('Monografia de conclusão de curso de aperfeiçoamento/especialização'),
                           'Especialização / Aperfeiçoamento');
    });

    test('outra natureza tem rotulo proprio', () => {
        assert.strictEqual(s('Orientações de outra natureza'), 'Outra natureza');
    });

    // O sufixo (Coorientador) e informacao de papel, nao de tipo: sem remove-lo, a
    // mesma categoria apareceria duas vezes na tabela.
    test('remove o sufixo de coorientador do rotulo', () => {
        assert.strictEqual(s('Categoria Estranha (Coorientador)'), 'Categoria Estranha');
    });

    test('sem categoria, cai em Outras', () => {
        assert.strictEqual(s(''), 'Outras');
    });
});
