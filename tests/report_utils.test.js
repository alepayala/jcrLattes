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

// A ordem das linhas desta tabela ja divergiu entre os tres lugares que a
// montavam: a do topo do CV mostrava 10 anos antes de 5, e a redesenhada ao mexer
// nos filtros invertia as duas. Os numeros estavam certos, mas as linhas trocavam
// de lugar ao marcar o filtro, o que faz comparar periodos diferentes sem perceber.
describe('corpoTabelaPublicacoes', () => {
    const faixa = { count: 0, sum: 0 };
    const bloco = { total: { count: 0, sum: 0, papersWithJcr: 0, firstAuthorCount: 0, lastAuthorCount: 0, gcCount: 0, authorCountSum: 0 },
                    high: faixa, mid: faixa, low: faixa, noJcr: 0 };
    const stats = { all: bloco, last10: bloco, recent: bloco, custom: bloco };
    const anos = { min: 2000, max: 2026, last10: 2016, recent: 2021 };

    test('a ordem e Total, 10 anos, 5 anos e o periodo escolhido', () => {
        const html = R.corpoTabelaPublicacoes(stats, anos, '3 anos (2023 - 2026)');
        const rotulos = html.match(/Total \(|10 anos \(|5 anos \(|3 anos \(/g);
        assert.deepStrictEqual(rotulos, ['Total (', '10 anos (', '5 anos (', '3 anos (']);
    });

    test('10 anos vem sempre antes de 5 anos', () => {
        const html = R.corpoTabelaPublicacoes(stats, anos, 'x');
        assert.ok(html.indexOf('10 anos') < html.indexOf('5 anos'),
            '10 anos precisa vir antes de 5 anos');
    });

    test('os intervalos de cada linha saem dos anos recebidos', () => {
        const html = R.corpoTabelaPublicacoes(stats, anos, 'x');
        assert.ok(html.includes('Total (2000 - 2026)'));
        assert.ok(html.includes('10 anos (2016 - 2026)'));
        assert.ok(html.includes('5 anos (2021 - 2026)'));
    });

    // No CV o rotulo do periodo e um <input> editavel; no relatorio e so o numero.
    test('o rotulo do periodo entra como veio, inclusive com HTML', () => {
        const html = R.corpoTabelaPublicacoes(stats, anos, '<input id="custom-year-input" value="7">');
        assert.ok(html.includes('<input id="custom-year-input" value="7">'));
    });

    test('devolve quatro linhas', () => {
        const html = R.corpoTabelaPublicacoes(stats, anos, 'x');
        assert.strictEqual((html.match(/<tr/g) || []).length, 4);
    });
});

// Patentes por situacao e trabalhos em eventos por tipo tem a mesma forma — uma
// linha por categoria nos quatro periodos, mais o Total. Estavam escritas quatro
// vezes: a tabela do CV e a do relatorio, para cada uma das duas.
describe('corpoTabelaContagens', () => {
    const pat = (c) => ({ patents: { statusCounts: c, total: Object.values(c).reduce((a, b) => a + b, 0) } });
    const stats = {
        all: pat({ 'Depositada': 3, 'Concedida': 2 }),
        last10: pat({ 'Depositada': 2, 'Concedida': 1 }),
        recent: pat({ 'Depositada': 1 }),
        custom: pat({}),
    };
    const html = () => R.corpoTabelaContagens(stats, 'patents', 'statusCounts');

    test('uma linha por categoria, mais a linha de Total', () => {
        assert.strictEqual((html().match(/<tr/g) || []).length, 3);
    });

    test('as categorias saem em ordem alfabetica', () => {
        const rotulos = html().match(/text-align: left;">([^<]+)</g).map(m => m.replace(/.*">/, '').replace('<', ''));
        assert.deepStrictEqual(rotulos, ['Concedida', 'Depositada', 'Total']);
    });

    test('as colunas sao os quatro periodos, nesta ordem', () => {
        // Concedida: 2 no total, 1 em 10 anos, 0 em 5 anos, 0 no periodo escolhido
        const linha = html().split('<tr').find(l => l.includes('Concedida'));
        const valores = (linha.match(/center;">(\d+)</g) || []).map(m => m.replace(/\D/g, ''));
        assert.deepStrictEqual(valores, ['2', '1', '0', '0']);
    });

    test('a linha de Total usa os totais de cada periodo', () => {
        const linha = html().split('<tr').find(l => l.includes('>Total<'));
        const valores = (linha.match(/center;">(\d+)</g) || []).map(m => m.replace(/\D/g, ''));
        assert.deepStrictEqual(valores, ['5', '3', '1', '0']);
    });

    test('escapa o nome da categoria', () => {
        const st = { all: pat({ 'A & B <x>': 1 }), last10: pat({}), recent: pat({}), custom: pat({}) };
        assert.ok(R.corpoTabelaContagens(st, 'patents', 'statusCounts').includes('A &amp; B &lt;x&gt;'));
    });

    test('serve igual para eventos, que usam outro mapa', () => {
        const ev = (c) => ({ events: { typeCounts: c, total: Object.values(c).reduce((a, b) => a + b, 0) } });
        const st = { all: ev({ 'Painel': 2 }), last10: ev({ 'Painel': 1 }), recent: ev({}), custom: ev({}) };
        assert.ok(R.corpoTabelaContagens(st, 'events', 'typeCounts').includes('Painel'));
    });

    test('entrada sem o campo esperado devolve vazio, sem lancar', () => {
        assert.strictEqual(R.corpoTabelaContagens({ all: {} }, 'patents', 'statusCounts'), '');
        assert.strictEqual(R.corpoTabelaContagens(null, 'patents', 'statusCounts'), '');
    });
});

// A linha de orientacao do CV Lattes traz aluno, titulo, ano e instituicao num texto
// so. Os casos abaixo sao linhas REAIS dos curriculos de test_pages.
describe('camposDaOrientacao', () => {
    const CONCLUIDA = {
        category: 'Dissertação de mestrado', status: 'Concluída', year: 2023,
        institution: 'Universidade Federal do Ceará',
        reference: 'Otávio Peixoto Furtado. Low temperature structural phase transitions of the '
            + 'lead-free hybrid vacancy-ordered perovskite (DMA)2SnBr6". 2023. Dissertação '
            + '(Mestrado em Física) - Universidade Federal do Ceará, Coordenação de '
            + 'Aperfeiçoamento de Pessoal de Nível Superior. Orientador: Alejandro Pedro Ayala.'
    };

    test('separa os cinco campos de uma orientacao concluida', () => {
        const c = R.camposDaOrientacao(CONCLUIDA);
        assert.strictEqual(c.aluno, 'Otávio Peixoto Furtado');
        assert.ok(c.titulo.startsWith('Low temperature structural phase transitions'));
        assert.ok(!c.titulo.includes('2023'));
        assert.strictEqual(c.instituicao, 'Universidade Federal do Ceará');
        assert.strictEqual(c.ano, 2023);
        assert.strictEqual(c.tipo, 'Dissertação de mestrado');
    });

    // "Cláudio de Oliveira A. Castro": cortar no primeiro ponto daria "Cláudio de
    // Oliveira A" como aluno e jogaria "Castro" para dentro do titulo.
    test('nome com inicial abreviada nao e cortado no ponto da abreviatura', () => {
        const c = R.camposDaOrientacao({
            category: 'Tese de doutorado', status: 'Em andamento', year: NaN, institution: '',
            reference: 'Cláudio de Oliveira A. Castro. Desenvolvimento de células solares a base '
                + 'de perovskitas. Início: 2024. Tese (Doutorado em Física) - Universidade Federal '
                + 'do Ceará, Conselho Nacional de Desenvolvimento Científico e Tecnológico. (Orientador).'
        });
        assert.strictEqual(c.aluno, 'Cláudio de Oliveira A. Castro');
        assert.strictEqual(c.titulo, 'Desenvolvimento de células solares a base de perovskitas');
        assert.strictEqual(c.ano, 2024);
    });

    // O ano lido e o de INICIO, e quem separa as em andamento das concluidas e a flag —
    // o tipo fica com a categoria limpa, porque a secao "Em andamento" ja diz o resto.
    test('em andamento le o ano de inicio e marca a flag', () => {
        const c = R.camposDaOrientacao({
            category: 'Dissertação de mestrado', status: 'Em andamento', year: NaN, institution: '',
            reference: 'Felipe Alison Costa Alves. Determinação do gap de energia sob condições '
                + 'extremas. Início: 2025. Dissertação (Mestrado profissional em Física) - '
                + 'Universidade Federal do Ceará, CAPES. (Orientador).'
        });
        assert.strictEqual(c.ano, 2025);
        assert.strictEqual(c.tipo, 'Dissertação de mestrado');
        assert.strictEqual(c.emAndamento, true);
    });

    // A supervisao de pos-doutorado costuma vir sem titulo nenhum.
    test('sem titulo devolve o campo vazio, e nao parte do nome', () => {
        const c = R.camposDaOrientacao({
            category: 'Supervisão de pós-doutorado', status: 'Em andamento', year: NaN, institution: '',
            reference: 'Laura Maria Teodorio Vidal. Início: 2024. Universidade Federal do Ceará, '
                + 'Financiadora de Estudos e Projetos.'
        });
        assert.strictEqual(c.aluno, 'Laura Maria Teodorio Vidal');
        assert.strictEqual(c.titulo, '');
        assert.strictEqual(c.instituicao, 'Universidade Federal do Ceará');
        assert.strictEqual(c.ano, 2024);
    });

    // "Início: 2026 - UFJF": o ano nao e seguido de ponto, e a captura devolve
    // institution vazia. A lista tem de achar a instituicao mesmo assim.
    test('acha a instituicao quando o ano e seguido de travessao', () => {
        const c = R.camposDaOrientacao({
            category: 'Iniciação científica', status: 'Em andamento', year: NaN, institution: '',
            reference: 'Amanda Soares Porfírio. Síntese e caracterização de pontos de carbono: um '
                + 'estudo teórico experimental. Início: 2026 - Universidade Federal de Juiz de Fora, '
                + 'Fundação de Amparo à Pesquisa do Estado de Minas Gerais. (Orientador).'
        });
        assert.strictEqual(c.instituicao, 'Universidade Federal de Juiz de Fora');
        assert.strictEqual(c.ano, 2026);
    });

    test('o ano do registro tem precedencia sobre o texto', () => {
        const c = R.camposDaOrientacao(Object.assign({}, CONCLUIDA, { year: 2021 }));
        assert.strictEqual(c.ano, 2021);
    });

    test('entrada vazia nao quebra', () => {
        const c = R.camposDaOrientacao(null);
        assert.strictEqual(c.aluno, '');
        assert.strictEqual(c.titulo, '');
        assert.strictEqual(c.tipo, 'Outras');
    });
});

describe('orientacoesAgrupadas', () => {
    const item = (nome, ano, cat, status) => ({
        category: cat, status: status || 'Concluída', year: ano, institution: 'UFC',
        reference: nome + '. Titulo qualquer. ' + ano + '. ' + cat + ' (X em Y) - UFC, CAPES.'
    });
    const emCurso = (nome, ano, cat) => item(nome, ano, cat, 'Em andamento');
    const titulos = (blocos) => blocos.map(b => b.titulo);

    test('por ano: anos em ordem decrescente', () => {
        const b = R.orientacoesAgrupadas([item('Ana Alves', 2019, 'Tese de doutorado'),
                                          item('Bruno Braga', 2024, 'Tese de doutorado'),
                                          item('Carla Costa', 2021, 'Tese de doutorado')], 100, 2026, 'ano');
        assert.deepStrictEqual(titulos(b), ['2024', '2021', '2019']);
    });

    // A secao Em andamento vem ANTES do primeiro ano: uma tese que comecou em 2023 e
    // continua em curso nao e producao de 2023.
    test('por ano: Em andamento abre a lista, antes do primeiro ano', () => {
        const b = R.orientacoesAgrupadas([item('Ana Alves', 2024, 'Tese de doutorado'),
                                          emCurso('Bruno Braga', 2023, 'Tese de doutorado')], 100, 2026, 'ano');
        assert.deepStrictEqual(titulos(b), ['Em andamento', '2024']);
        assert.strictEqual(b[0].grupos[0].itens[0].aluno, 'Bruno Braga');
    });

    test('por ano: dentro do ano as categorias vao da mais graduada para a menos', () => {
        const b = R.orientacoesAgrupadas([
            item('Ana Alves', 2024, 'Iniciação científica'),
            item('Bruno Braga', 2024, 'Tese de doutorado'),
            item('Carla Costa', 2024, 'Supervisão de pós-doutorado'),
            item('Diego Dias', 2024, 'Dissertação de mestrado')
        ], 100, 2026, 'ano');
        assert.deepStrictEqual(b[0].grupos.map(g => g.titulo), [
            'Supervisão de pós-doutorado', 'Tese de doutorado',
            'Dissertação de mestrado', 'Iniciação científica'
        ]);
    });

    test('por categoria: categorias no primeiro nivel, anos no segundo', () => {
        const b = R.orientacoesAgrupadas([
            item('Ana Alves', 2019, 'Dissertação de mestrado'),
            item('Bruno Braga', 2024, 'Tese de doutorado'),
            item('Carla Costa', 2021, 'Tese de doutorado')
        ], 100, 2026, 'categoria');
        assert.deepStrictEqual(titulos(b), ['Tese de doutorado', 'Dissertação de mestrado']);
        assert.deepStrictEqual(b[0].grupos.map(g => g.titulo), ['2024', '2021']);
    });

    test('por categoria: Em andamento abre cada categoria', () => {
        const b = R.orientacoesAgrupadas([item('Ana Alves', 2024, 'Tese de doutorado'),
                                          emCurso('Bruno Braga', 2023, 'Tese de doutorado')], 100, 2026, 'categoria');
        assert.deepStrictEqual(b[0].grupos.map(g => g.titulo), ['Em andamento', '2024']);
    });

    test('a ordem padrao e por ano', () => {
        const itens = [item('Ana Alves', 2024, 'Tese de doutorado')];
        assert.deepStrictEqual(titulos(R.orientacoesAgrupadas(itens, 100, 2026)),
                               titulos(R.orientacoesAgrupadas(itens, 100, 2026, 'ano')));
    });

    test('dentro do grupo os alunos saem em ordem alfabetica', () => {
        const b = R.orientacoesAgrupadas([item('Zulmira Xavier', 2024, 'Tese de doutorado'),
                                          item('Ana Yamada', 2024, 'Tese de doutorado')], 100, 2026, 'ano');
        assert.deepStrictEqual(b[0].grupos[0].itens.map(i => i.aluno), ['Ana Yamada', 'Zulmira Xavier']);
    });

    test('o filtro de anos corta as concluidas pelo ano atual', () => {
        const itens = [item('Ana Alves', 2026, 'Tese de doutorado'), item('Bruno Braga', 2018, 'Tese de doutorado')];
        assert.deepStrictEqual(titulos(R.orientacoesAgrupadas(itens, 3, 2026, 'ano')), ['2026']);
        assert.deepStrictEqual(titulos(R.orientacoesAgrupadas(itens, 100, 2026, 'ano')), ['2026', '2018']);
    });

    // Zero nao e atalho para "tudo": zero ano de recuo e o ano corrente sozinho, igual
    // ao campo "Periodo (anos)" da lista de publicacoes. Para ver tudo poe-se um numero
    // grande; so o campo vazio (NaN) desliga o corte.
    test('zero ano de recuo e o ano corrente sozinho', () => {
        const itens = [item('Ana Alves', 2026, 'Tese de doutorado'), item('Bruno Braga', 2025, 'Tese de doutorado')];
        assert.deepStrictEqual(titulos(R.orientacoesAgrupadas(itens, 0, 2026, 'ano')), ['2026']);
        assert.deepStrictEqual(titulos(R.orientacoesAgrupadas(itens, '', 2026, 'ano')), ['2026', '2025']);
    });

    // Filtrar as em andamento pelo ano de inicio esconderia justamente os doutorados
    // longos, que sao os que mais interessam num relatorio de equipe.
    test('o filtro de anos NAO corta as em andamento', () => {
        const b = R.orientacoesAgrupadas([emCurso('Ana Alves', 2015, 'Tese de doutorado')], 3, 2026, 'ano');
        assert.deepStrictEqual(titulos(b), ['Em andamento']);
    });

    // Num relatorio de equipe o orientador e o coorientador listam o mesmo aluno.
    test('mesmo aluno, ano e titulo entram uma vez so', () => {
        const a = item('Joao Silva', 2024, 'Tese de doutorado');
        assert.strictEqual(R.orientacoesAgrupadas([a, Object.assign({}, a)], 100, 2026, 'ano')[0].total, 1);
    });

    test('a mesma pessoa concluida e em andamento sao registros diferentes', () => {
        const fim = item('Joao Silva', 2024, 'Tese de doutorado');
        const curso = emCurso('Joao Silva', 2024, 'Tese de doutorado');
        assert.deepStrictEqual(titulos(R.orientacoesAgrupadas([fim, curso], 100, 2026, 'ano')),
                               ['Em andamento', '2024']);
    });

    test('concluida sem ano legivel fica de fora', () => {
        const semAno = { category: 'Tese de doutorado', status: 'Concluída', year: NaN,
                         institution: '', reference: 'Fulano de Tal. Sem ano nenhum aqui.' };
        assert.deepStrictEqual(R.orientacoesAgrupadas([semAno], 100, 2026, 'ano'), []);
    });

    test('aceita tanto o array cru quanto o objeto com .raw', () => {
        const i = item('Ana Alves', 2024, 'Tese de doutorado');
        assert.strictEqual(R.orientacoesAgrupadas({ raw: [i] }, 100, 2026, 'ano').length, 1);
        assert.deepStrictEqual(R.orientacoesAgrupadas(null, 100, 2026, 'ano'), []);
    });
});

describe('orientacaoEmLinha', () => {
    test('os cinco campos na ordem pedida, separados por ponto', () => {
        assert.strictEqual(
            R.orientacaoEmLinha({ aluno: 'Ana Souza', titulo: 'Um titulo', instituicao: 'UFC',
                                  ano: 2024, tipo: 'Tese de doutorado', emAndamento: false }),
            'Ana Souza. Um titulo. UFC. 2024. Tese de doutorado');
    });

    test('em andamento diz que o ano e o de inicio', () => {
        assert.ok(R.orientacaoEmLinha({ aluno: 'Ana', titulo: '', instituicao: 'UFC',
                                        ano: 2023, tipo: 'Tese de doutorado', emAndamento: true })
            .includes('início 2023'));
    });

    // O pos-doutorado costuma vir sem titulo; sem o filtro sobraria ".." na frase.
    test('campo vazio some, em vez de deixar pontos soltos', () => {
        const l = R.orientacaoEmLinha({ aluno: 'Ana', titulo: '', instituicao: 'UFC',
                                        ano: 2024, tipo: 'Supervisão de pós-doutorado', emAndamento: false });
        assert.strictEqual(l, 'Ana. UFC. 2024. Supervisão de pós-doutorado');
        assert.ok(!l.includes('..'));
    });

    test('entrada vazia devolve string vazia', () => {
        assert.strictEqual(R.orientacaoEmLinha(null), '');
    });
});

describe('orientacoesEmTexto', () => {
    const blocos = () => R.orientacoesAgrupadas([
        { category: 'Tese de doutorado', status: 'Concluída', year: 2024, institution: 'UFC',
          reference: 'Ana Souza. Um titulo. 2024. Tese (Doutorado em Física) - UFC, CAPES.' },
        { category: 'Tese de doutorado', status: 'Em andamento', year: 2023, institution: 'UFC',
          reference: 'Bruno Lima. Outro titulo. Início: 2023. Tese (Doutorado em Física) - UFC, CAPES.' }
    ], 100, 2026, 'ano');

    test('leva os titulos das secoes, na ordem da tela', () => {
        const linhas = R.orientacoesEmTexto(blocos()).split('\n').filter(l => l !== '');
        assert.strictEqual(linhas[0], 'Em andamento');
        assert.ok(linhas[2].trim().startsWith('Bruno Lima'));
        assert.strictEqual(linhas[3], '2024');
        assert.ok(linhas[5].trim().startsWith('Ana Souza'));
    });

    // Numero colado num documento vira texto fixo: inserir ou tirar uma linha depois
    // obrigaria a renumerar tudo a mao. Quem numera e o editor de texto.
    test('por padrao NAO numera', () => {
        assert.ok(!/^\s*\d+\.\s/m.test(R.orientacoesEmTexto(blocos())));
    });

    test('a numeracao continua existe, mas so quando pedida', () => {
        const linhas = R.orientacoesEmTexto(blocos(), { numerar: true }).split('\n').filter(l => l !== '');
        assert.ok(linhas[2].trim().startsWith('1. Bruno Lima'));
        assert.ok(linhas[5].trim().startsWith('2. Ana Souza'));
    });

    test('lista vazia devolve texto vazio', () => {
        assert.strictEqual(R.orientacoesEmTexto([]), '');
        assert.strictEqual(R.orientacoesEmTexto(null), '');
    });
});

// A planilha de producoes do efomento vem em colunas, entao os campos chegam
// separados. Quebrar o `reference` dela daria "Titulo. Instituicao. Curso" como
// titulo — os campos prontos tem de vencer.
describe('camposDaOrientacao com a planilha de producoes', () => {
    const DA_PLANILHA = {
        category: 'Dissertação de mestrado', status: 'Concluída', year: 2022,
        student: 'Marina Ferreira Lima',
        title: 'Estudo de perovskitas híbridas',
        institution: 'Universidade Federal do Ceará',
        course: 'Física',
        reference: 'Marina Ferreira Lima. Estudo de perovskitas híbridas. '
            + 'Universidade Federal do Ceará. Física. 2022'
    };

    test('usa os campos ja separados em vez de quebrar o texto', () => {
        const c = R.camposDaOrientacao(DA_PLANILHA);
        assert.strictEqual(c.aluno, 'Marina Ferreira Lima');
        assert.strictEqual(c.titulo, 'Estudo de perovskitas híbridas');
        assert.strictEqual(c.instituicao, 'Universidade Federal do Ceará');
        assert.strictEqual(c.ano, 2022);
    });

    test('orientacao sem titulo na planilha nao herda texto do reference', () => {
        const c = R.camposDaOrientacao(Object.assign({}, DA_PLANILHA, { title: '' }));
        assert.strictEqual(c.aluno, 'Marina Ferreira Lima');
        assert.strictEqual(c.titulo, '');
    });
});

// A instituicao so e derivada do texto quando a captura nao trouxe o campo. Os quatro
// casos abaixo sao as formas que aparecem nos CVs de test_pages, e cada um quebrava
// uma versao anterior da regra.
describe('_instituicaoDaOrientacao', () => {
    const semCaptura = (ref) => R.camposDaOrientacao({
        category: 'X', status: 'Concluída', year: NaN, institution: '', reference: ref
    }).instituicao;

    test('natureza com area entre parenteses', () => {
        assert.strictEqual(
            semCaptura('Ana Souza. Um titulo. 2023. Dissertação (Mestrado em Física) - '
                + 'Universidade Federal do Ceará, Coordenação de Aperfeiçoamento de Pessoal.'),
            'Universidade Federal do Ceará');
    });

    // O travessao tambem aparece DENTRO do nome da financiadora; parar na virgula e o
    // que impede a lista de exibir "MA" como instituicao.
    test('travessao dentro do nome da financiadora nao rouba a vaga', () => {
        assert.strictEqual(
            semCaptura('Ariel Nonato Almeida de Abreu Silva. 2022. Universidade Federal do Ceará, '
                + 'Fundação de Amparo à Pesquisa ao Desenv. Científico e Tecnológico - MA. '
                + 'Alejandro Pedro Ayala.'),
            'Universidade Federal do Ceará');
    });

    test('natureza sem parenteses, separada so por travessao', () => {
        assert.strictEqual(
            semCaptura('Maria Silmara Alves de Santana. Engenharia de cristais. 2013. '
                + 'Orientação de outra natureza - Universidade Federal do Ceará, '
                + 'Fundação Cearense de Apoio ao Desenvolvimento.'),
            'Universidade Federal do Ceará');
    });

    // Sem financiadora nao ha virgula, e o texto emenda direto em "Orientador:".
    test('sem financiadora, corta no ponto antes do orientador', () => {
        assert.strictEqual(
            semCaptura('Manoel Florindo Júnior. Resinas odontológicas. Início: 2023. '
                + 'Tese (Doutorado em Física) - Universidade Federal do Ceará. (Orientador).'),
            'Universidade Federal do Ceará');
    });

    test('texto sem ano nenhum nao inventa instituicao', () => {
        assert.strictEqual(semCaptura('Fulano de Tal. Sem ano aqui.'), '');
    });
});

// Muita gente digita nome e titulo no Lattes em CAIXA ALTA. Numa lista para colar num
// documento isso grita, entao a caixa e normalizada — mas so quando o texto todo esta
// em maiuscula, para nunca estragar quem escreveu direito.
describe('_normalizarCaixa', () => {
    test('nome inteiro em maiuscula vira caixa de titulo', () => {
        assert.strictEqual(R._normalizarCaixa('MARIA FERNANDA OLIVEIRA MARTÍNEZ'),
                           'Maria Fernanda Oliveira Martínez');
    });

    test('conectivo no meio do nome fica em minuscula', () => {
        assert.strictEqual(R._normalizarCaixa('DIOGO RUBIO SANT ANNA DAS DORES'),
                           'Diogo Rubio Sant Anna das Dores');
    });

    test('a primeira palavra nunca e rebaixada, mesmo sendo conectivo', () => {
        assert.strictEqual(R._normalizarCaixa('DAS NEVES SILVA JUNIOR'), 'Das Neves Silva Junior');
    });

    // Caixa de TITULO, e nao de frase: em caixa de frase "RAMAN" viraria "raman", que
    // para quem le e erro visivel.
    test('sobrenome dentro do titulo mantem a maiuscula', () => {
        assert.strictEqual(R._normalizarCaixa('ESTUDO POR ESPECTROSCOPIA RAMAN'),
                           'Estudo por Espectroscopia Raman');
    });

    test('conectivo em ingles tambem e rebaixado', () => {
        assert.strictEqual(R._normalizarCaixa('EXPLORING THE PROPERTIES OF HALIDE PEROVSKITES'),
                           'Exploring the Properties of Halide Perovskites');
    });

    // Formula quimica: a palavra ja tem minuscula, ou tem digito. Nos dois casos passa
    // intacta, senao "CsPbBr" viraria "Cspbbr".
    test('formula quimica no meio do titulo passa intacta', () => {
        const fora = R._normalizarCaixa('SÍNTESE DE NANOCRISTAIS DE PEROVSKITA CsPbBr 3 VIA LARP');
        assert.ok(fora.includes('CsPbBr'));
        assert.ok(fora.startsWith('Síntese de Nanocristais'));
    });

    test('palavra com digito nao e tocada', () => {
        assert.ok(R._normalizarCaixa('PROPRIEDADES DE Rb2InCl5 POR RAMAN').includes('Rb2InCl5'));
    });

    test('texto escrito normalmente nao e tocado', () => {
        const t = 'Determinação do gap de energia sob condições extremas';
        assert.strictEqual(R._normalizarCaixa(t), t);
        const misto = 'Low temperature transitions of the perovskite (DMA)2SnBr6';
        assert.strictEqual(R._normalizarCaixa(misto), misto);
    });

    test('sigla curta e texto vazio nao quebram', () => {
        assert.strictEqual(R._normalizarCaixa('UFC'), 'UFC');   // menos de 4 letras: intacto
        assert.strictEqual(R._normalizarCaixa(''), '');
        assert.strictEqual(R._normalizarCaixa(null), '');
    });
});

// O orientador sai do dono do CV de onde a linha veio. E a unica fonte que serve para
// as orientacoes em andamento, cujo texto diz so "(Orientador)." sem nome.
describe('orientador da orientacao', () => {
    const base = (extra) => Object.assign({
        category: 'Tese de doutorado', status: 'Concluída', year: 2020, institution: 'UFC',
        reference: 'Ana Souza. Um titulo. 2020. Tese (Doutorado em Física) - UFC, CAPES. '
            + 'Orientador: Carlos Pereira.'
    }, extra || {});

    test('o dono do CV vence o nome escrito no texto', () => {
        const c = R.camposDaOrientacao(base({ _orientador: 'Alejandro Pedro Ayala' }));
        assert.deepStrictEqual(c.orientadores, [{ nome: 'Alejandro Pedro Ayala', coorientador: false }]);
    });

    test('sem o dono do CV, le o nome do fim da linha', () => {
        const c = R.camposDaOrientacao(base());
        assert.deepStrictEqual(c.orientadores, [{ nome: 'Carlos Pereira', coorientador: false }]);
    });

    test('em andamento nao tem nome no texto, e so o dono do CV resolve', () => {
        const emCurso = {
            category: 'Tese de doutorado', status: 'Em andamento', year: NaN, institution: '',
            reference: 'Ana Souza. Um titulo. Início: 2024. Tese (Doutorado em Física) - UFC. (Orientador).',
            _orientador: 'Alejandro Pedro Ayala'
        };
        assert.deepStrictEqual(R.camposDaOrientacao(emCurso).orientadores,
                               [{ nome: 'Alejandro Pedro Ayala', coorientador: false }]);
    });

    test('nome do orientador em caixa alta tambem e normalizado', () => {
        const c = R.camposDaOrientacao(base({ _orientador: 'ALEJANDRO PEDRO AYALA' }));
        assert.strictEqual(c.orientadores[0].nome, 'Alejandro Pedro Ayala');
    });

    // "(Coorientador)" sai da categoria: a coorientacao agora aparece por nome no fim
    // da linha, e manter a marca ali partiria o mesmo trabalho em duas categorias.
    test('coorientacao e marcada na pessoa, e nao na categoria', () => {
        const c = R.camposDaOrientacao({
            category: 'Tese de doutorado (Coorientador)', status: 'Concluída', year: 2014,
            institution: 'UFC', _orientador: 'Alejandro Pedro Ayala',
            reference: 'Ana Souza. Um titulo. 2014. Tese (Doutorado em Física) - UFC, . '
                + 'Coorientador: Alejandro Pedro Ayala.'
        });
        assert.strictEqual(c.tipo, 'Tese de doutorado');
        assert.deepStrictEqual(c.orientadores, [{ nome: 'Alejandro Pedro Ayala', coorientador: true }]);
    });
});

describe('textoDeOrientadores', () => {
    test('um orientador', () => {
        assert.strictEqual(R.textoDeOrientadores([{ nome: 'Ana', coorientador: false }]),
                           'Orientador: Ana');
    });
    test('orientador e coorientador saem separados', () => {
        assert.strictEqual(
            R.textoDeOrientadores([{ nome: 'Ana', coorientador: false },
                                   { nome: 'Bruno', coorientador: true }]),
            'Orientador: Ana; Coorientador: Bruno');
    });
    test('mais de um vira plural', () => {
        assert.strictEqual(
            R.textoDeOrientadores([{ nome: 'Ana', coorientador: false },
                                   { nome: 'Bruno', coorientador: false }]),
            'Orientadores: Ana, Bruno');
    });
    test('lista vazia devolve string vazia', () => {
        assert.strictEqual(R.textoDeOrientadores([]), '');
        assert.strictEqual(R.textoDeOrientadores(null), '');
    });
});

// A coorientacao so aparece quando os DOIS CVs estao no relatorio: a mesma orientacao
// chega duas vezes, uma por cada CV, e e a juncao das duas que revela o par.
describe('coorientacao entre CVs da equipe', () => {
    const linha = (dono, coorientou) => ({
        category: coorientou ? 'Tese de doutorado (Coorientador)' : 'Tese de doutorado',
        status: 'Concluída', year: 2020, institution: 'UFC', _orientador: dono,
        reference: 'Ana Souza. Estudo de perovskitas. 2020. Tese (Doutorado em Física) - UFC, CAPES. '
            + (coorientou ? 'Coorientador: ' : 'Orientador: ') + dono + '.'
    });

    test('as duas vias viram uma linha so, com os dois nomes', () => {
        const b = R.orientacoesAgrupadas([linha('Alejandro Ayala', false),
                                          linha('Zélia Ludwig', true)], 100, 2026, 'ano');
        assert.strictEqual(b[0].total, 1);
        const o = b[0].grupos[0].itens[0];
        assert.deepStrictEqual(o.orientadores, [
            { nome: 'Alejandro Ayala', coorientador: false },
            { nome: 'Zélia Ludwig', coorientador: true }
        ]);
        assert.ok(R.orientacaoEmLinha(o).endsWith('Orientador: Alejandro Ayala; Coorientador: Zélia Ludwig'));
    });

    test('a ordem em que os CVs entram nao muda o resultado', () => {
        const b = R.orientacoesAgrupadas([linha('Zélia Ludwig', true),
                                          linha('Alejandro Ayala', false)], 100, 2026, 'ano');
        assert.strictEqual(R.textoDeOrientadores(b[0].grupos[0].itens[0].orientadores),
                           'Orientador: Alejandro Ayala; Coorientador: Zélia Ludwig');
    });

    // O mesmo CV importado duas vezes nao pode virar "Orientadores: Fulano, Fulano".
    test('a mesma pessoa nao entra duas vezes', () => {
        const b = R.orientacoesAgrupadas([linha('Alejandro Ayala', false),
                                          linha('Alejandro Ayala', false)], 100, 2026, 'ano');
        assert.strictEqual(b[0].grupos[0].itens[0].orientadores.length, 1);
    });

    // Se a pessoa aparece como orientadora numa via e coorientadora noutra, vale o papel
    // mais forte — senao ela seria listada como coorientadora do proprio aluno.
    test('orientador vence coorientador para a mesma pessoa', () => {
        const b = R.orientacoesAgrupadas([linha('Alejandro Ayala', true),
                                          linha('Alejandro Ayala', false)], 100, 2026, 'ano');
        assert.deepStrictEqual(b[0].grupos[0].itens[0].orientadores,
                               [{ nome: 'Alejandro Ayala', coorientador: false }]);
    });
});

// A lista de publicacoes devolve blocos no MESMO formato da de orientacoes
// ({ titulo, grupos, total }), porque as duas passam pelo mesmo desenhista.
describe('publicacoesAgrupadas', () => {
    const pub = (ano, jif, ref) => ({ year: ano, jif: jif, reference: ref || ('Artigo de ' + ano) });

    test('um bloco por ano, do mais recente para o mais antigo', () => {
        const b = R.publicacoesAgrupadas([pub(2019, 1), pub(2024, 1), pub(2021, 1)], 100, 2026);
        assert.deepStrictEqual(b.map(x => x.titulo), ['2024', '2021', '2019']);
    });

    test('dentro do ano, do maior JCR para o menor', () => {
        const b = R.publicacoesAgrupadas([pub(2024, 2.5, 'baixo'), pub(2024, 9.1, 'alto')], 100, 2026);
        assert.deepStrictEqual(b[0].grupos[0].itens.map(p => p.reference), ['alto', 'baixo']);
    });

    // Sem segundo nivel: um grupo unico e sem nome, que o desenhista nao titula.
    test('cada ano traz um grupo unico e sem titulo', () => {
        const b = R.publicacoesAgrupadas([pub(2024, 1)], 100, 2026);
        assert.strictEqual(b[0].grupos.length, 1);
        assert.strictEqual(b[0].grupos[0].titulo, '');
        assert.strictEqual(b[0].total, 1);
    });

    test('o filtro de anos corta pelo ano atual', () => {
        const itens = [pub(2026, 1), pub(2018, 1)];
        assert.deepStrictEqual(R.publicacoesAgrupadas(itens, 3, 2026).map(x => x.titulo), ['2026']);
        assert.deepStrictEqual(R.publicacoesAgrupadas(itens, 100, 2026).map(x => x.titulo), ['2026', '2018']);
    });

    // Comportamento antigo da lista, preservado: zero ano de recuo e o ano corrente
    // sozinho, e nao "tudo".
    test('zero ano de recuo e o ano corrente sozinho', () => {
        const itens = [pub(2026, 1), pub(2025, 1)];
        assert.deepStrictEqual(R.publicacoesAgrupadas(itens, 0, 2026).map(x => x.titulo), ['2026']);
        assert.deepStrictEqual(R.publicacoesAgrupadas(itens, '', 2026).map(x => x.titulo), ['2026', '2025']);
    });

    test('publicacao sem ano fica de fora, e entrada invalida nao quebra', () => {
        assert.deepStrictEqual(R.publicacoesAgrupadas([{ jif: 3 }], 100, 2026), []);
        assert.deepStrictEqual(R.publicacoesAgrupadas(null, 100, 2026), []);
        assert.deepStrictEqual(R.publicacoesAgrupadas([null], 100, 2026), []);
    });
});

describe('_referenciaLimpa', () => {
    // O relatorio ja mostra JCR e citacoes em separado; repeti-los dentro da referencia
    // so polui a linha que vai para o documento.
    test('tira numero da lista, fator de impacto e citacoes', () => {
        assert.strictEqual(
            R._referenciaLimpa({ reference: '12. SILVA, A. Titulo do artigo. Revista X, 2024. '
                + 'Fator de Impacto: 4.510 (2024) Citações: 7|9' }),
            'SILVA, A. Titulo do artigo. Revista X, 2024.');
    });

    test('tira tambem o "Não classificado"', () => {
        assert.strictEqual(R._referenciaLimpa({ reference: 'SILVA, A. Artigo. Não classificado (2 autores)' }),
                           'SILVA, A. Artigo.');
    });

    test('sem reference, monta a partir de titulo, periodico e ano', () => {
        assert.strictEqual(R._referenciaLimpa({ paperTitle: 'Um artigo', journalName: 'Rev X', year: 2024 }),
                           'Um artigo. Rev X. 2024');
    });

    test('sem nada devolve o aviso, e entrada vazia nao quebra', () => {
        assert.strictEqual(R._referenciaLimpa({}), 'Referência indisponível');
        assert.strictEqual(R._referenciaLimpa(null), '');
    });
});

describe('publicacaoEmLinha', () => {
    const P = { year: 2024, jif: 4.51, wosCitations: 7, scopusCitations: 9, doi: '10.1000/xyz',
                reference: 'SILVA, A. Titulo. Rev X, 2024.' };

    test('leva os extras que as caixas de selecao deixam ver', () => {
        assert.strictEqual(R.publicacaoEmLinha(P, {}),
            'SILVA, A. Titulo. Rev X, 2024. | JCR: 4.510 | Citações: WoS: 7 / Scopus: 9 | DOI: 10.1000/xyz');
    });

    test('caixa desmarcada tira o extra correspondente', () => {
        assert.strictEqual(R.publicacaoEmLinha(P, { jcr: false, citacoes: false, doi: false }),
                           'SILVA, A. Titulo. Rev X, 2024.');
    });

    test('sem JCR, sem citacoes e sem DOI sobra so a referencia', () => {
        assert.strictEqual(R.publicacaoEmLinha({ year: 2024, jif: 0, reference: 'SILVA, A. Titulo.' }, {}),
                           'SILVA, A. Titulo.');
    });

    test('entrada vazia devolve string vazia', () => {
        assert.strictEqual(R.publicacaoEmLinha(null, {}), '');
    });
});

describe('publicacoesEmTexto', () => {
    const blocos = () => R.publicacoesAgrupadas([
        { year: 2024, jif: 0, reference: 'SILVA, A. Artigo de 2024.' },
        { year: 2023, jif: 0, reference: 'SOUZA, B. Artigo de 2023.' }
    ], 100, 2026);

    test('leva o ano como titulo de secao', () => {
        const linhas = R.publicacoesEmTexto(blocos()).split('\n').filter(l => l !== '');
        assert.strictEqual(linhas[0], '2024');
        assert.ok(linhas[1].trim().startsWith('SILVA, A.'));
        assert.strictEqual(linhas[2], '2023');
    });

    // Mesma regra da lista de orientacoes: numero colado num documento vira texto fixo.
    test('por padrao NAO numera', () => {
        assert.ok(!/^\s*\d+\.\s/m.test(R.publicacoesEmTexto(blocos())));
    });

    test('a numeracao continua existe, mas so quando pedida', () => {
        const linhas = R.publicacoesEmTexto(blocos(), { numerar: true }).split('\n').filter(l => l !== '');
        assert.ok(linhas[1].trim().startsWith('1. SILVA'));
        assert.ok(linhas[3].trim().startsWith('2. SOUZA'));
    });

    test('lista vazia devolve texto vazio', () => {
        assert.strictEqual(R.publicacoesEmTexto([]), '');
        assert.strictEqual(R.publicacoesEmTexto(null), '');
    });
});

// A lista de autores do Lattes costuma vir em CAIXA ALTA, as vezes misturada com nomes
// ja escritos direito. O corte entre autores e titulo e o MESMO que a captura usa para
// contar autores (lattes_parser: bruto.indexOf(doCvuri.titulo)), e o titulo esta gravado
// no registro — entao isto vale para os CVs que ja estao no banco, sem reimportar.
describe('normalizacao da caixa dos autores', () => {
    const TITULO = 'About the strain-coupled molecular dynamics in the ferroelastic phase transition';
    const pub = (autores) => ({
        paperTitle: TITULO,
        reference: autores + ' . ' + TITULO + '. JOURNAL OF MOLECULAR STRUCTURE , v. 1349, p. 143739, 2026.'
    });

    test('autor em caixa alta vira caixa de titulo, e a inicial continua maiuscula', () => {
        assert.ok(R._referenciaLimpa(pub('NONATO, A. ; PASCHOAL, C.W.A.'))
            .startsWith('Nonato, A. ; Paschoal, C.W.A.'));
    });

    // A decisao e por AUTOR, e nao pelo bloco todo: numa lista misturada quem ja esta
    // certo nao pode ser reescrito.
    test('autor que ja esta escrito direito fica intacto', () => {
        assert.ok(R._referenciaLimpa(pub('NONATO, A. ; Silva, R.X. ; Ayala, Alejandro Pedro'))
            .startsWith('Nonato, A. ; Silva, R.X. ; Ayala, Alejandro Pedro'));
    });

    test('conectivo no meio do nome cai para minuscula', () => {
        assert.ok(R._referenciaLimpa(pub('SILVA, ANTONIO C. DE S.'))
            .startsWith('Silva, Antonio C. de S.'));
    });

    test('sobrenome composto e hifenizado mantem a acentuacao', () => {
        assert.ok(R._referenciaLimpa(pub('SENÃRÍS-RODRÍGUEZ, M.A. ; DOS SANTOS, VICTÓRIA MARIA'))
            .startsWith('Senãrís-Rodríguez, M.A. ; Dos Santos, Victória Maria'));
    });

    // So a parte dos autores muda. Nome de periodico em caixa alta fica como esta: o
    // pedido foi sobre os autores.
    test('nada depois do titulo e tocado', () => {
        const p = pub('NONATO, A.');
        const fora = R._referenciaLimpa(p);
        assert.ok(fora.includes('JOURNAL OF MOLECULAR STRUCTURE , v. 1349, p. 143739, 2026.'));
        assert.ok(fora.includes(TITULO));
    });

    test('sem o titulo no registro, a referencia passa inteira', () => {
        const p = pub('NONATO, A.');
        assert.strictEqual(R._referenciaLimpa({ reference: p.reference, paperTitle: '' }),
                           p.reference);
    });

    // A planilha de producoes do efomento nao traz nomes de autores, e a referencia dela
    // COMECA pelo titulo — nao ha bloco de autores para mexer.
    test('referencia que comeca pelo titulo passa inteira', () => {
        const ref = 'Um titulo qualquer. REVISTA X. 2024. v. 10. p. 1-9';
        assert.strictEqual(R._referenciaLimpa({ reference: ref, paperTitle: 'Um titulo qualquer' }), ref);
    });

    test('titulo que nao aparece na referencia nao quebra nada', () => {
        const ref = 'NONATO, A. . Outro titulo. REVISTA. 2024.';
        assert.strictEqual(R._referenciaLimpa({ reference: ref, paperTitle: 'Titulo que nao esta la' }), ref);
    });

    test('o numero da lista continua saindo antes da normalizacao', () => {
        const p = pub('NONATO, A.');
        assert.ok(R._referenciaLimpa({ reference: '12. ' + p.reference, paperTitle: TITULO })
            .startsWith('Nonato, A.'));
    });
});

// Letra solta seguida de ponto e inicial de nome, e nao palavra — "a" e "e" estao na
// lista de conectivos e seriam rebaixados sem esta regra.
describe('_normalizarCaixa com iniciais', () => {
    test('inicial nao vira minuscula por ser conectivo', () => {
        assert.strictEqual(R._normalizarCaixa('NONATO, A.'), 'Nonato, A.');
        assert.strictEqual(R._normalizarCaixa('SILVA, E. O.'), 'Silva, E. O.');
    });
    test('sequencia de iniciais fica intacta', () => {
        assert.strictEqual(R._normalizarCaixa('PASCHOAL, C.W.A.'), 'Paschoal, C.W.A.');
    });
    test('conectivo de verdade continua caindo para minuscula', () => {
        assert.strictEqual(R._normalizarCaixa('SILVA, ANTONIO C. DE S.'), 'Silva, Antonio C. de S.');
    });
});

// O sobrenome — o que vem antes da primeira virgula — sai sempre com so a primeira letra
// maiuscula. Ele e normalizado por conta propria, sem depender de o autor inteiro estar
// em caixa alta: os quatro casos abaixo sao reais dos CVs de test_pages e nenhum deles
// disparava o teste de caixa alta do autor inteiro, porque o prenome ja vinha certo.
describe('_normalizarAutor: o sobrenome manda', () => {
    const casos = [
        ['FREITAS, Gabrielle Cavalcante', 'Freitas, Gabrielle Cavalcante'],
        ['PERAZZO, P. K. de', 'Perazzo, P. K. de'],
        ['de la PRESA, P. M', 'de la Presa, P. M'],
        ['HU, X', 'Hu, X']
    ];
    casos.forEach(([antes, depois]) => {
        test('"' + antes + '" vira "' + depois + '"', () => {
            assert.strictEqual(R._normalizarAutor(antes), depois);
        });
    });

    // Sobrenome de duas letras fica abaixo do piso de quatro letras de _emCaixaAlta;
    // por isso ele nao passa por ali.
    test('sobrenome curto tambem e corrigido', () => {
        assert.strictEqual(R._normalizarAutor('HU, X'), 'Hu, X');
        assert.strictEqual(R._normalizarAutor('LI, Y. Z.'), 'Li, Y. Z.');
    });

    // Particula que ja veio em minuscula continua em minuscula: e a grafia correta e
    // nao cabe "corrigir" o que o autor escreveu.
    test('particula em minuscula no sobrenome e preservada', () => {
        assert.strictEqual(R._normalizarAutor('de la PRESA, P. M'), 'de la Presa, P. M');
        assert.strictEqual(R._normalizarAutor('van der WAALS, J.'), 'van der Waals, J.');
    });

    // Do outro lado da virgula valem as regras de sempre: prenome que ja veio certo nao
    // e reescrito, e prenome todo em maiuscula e.
    test('prenome ja correto nao e mexido; prenome gritando e', () => {
        assert.strictEqual(R._normalizarAutor('SILVA, Maria José'), 'Silva, Maria José');
        assert.strictEqual(R._normalizarAutor('SILVA, MARIA JOSÉ'), 'Silva, Maria José');
    });

    test('autor sem virgula cai na regra geral', () => {
        assert.strictEqual(R._normalizarAutor('CONSORTIUM COLABORATIVO'), 'Consortium Colaborativo');
        assert.strictEqual(R._normalizarAutor('Ayala, Alejandro Pedro'), 'Ayala, Alejandro Pedro');
    });

    test('entrada vazia nao quebra', () => {
        assert.strictEqual(R._normalizarAutor(''), '');
        assert.strictEqual(R._normalizarAutor(null), '');
    });
});
