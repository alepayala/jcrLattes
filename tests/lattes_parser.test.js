'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const L = require('./helpers/load.js').lattes();

// As regras abaixo saíram de annotateLattesPage em content.js e foram replicadas sem
// alteração, para que a troca possa ser provada equivalente antes de acontecer. Se
// algum destes testes precisar mudar, é porque o comportamento mudou de verdade.

describe('_ehGrandeColaboracao', () => {
    test('reconhece "et.al" exatamente como o Lattes escreve', () => {
        assert.strictEqual(L._ehGrandeColaboracao('SILVA, J.; et.al . Titulo'), true);
    });

    test('COLLABORATION vale em qualquer caixa', () => {
        assert.strictEqual(L._ehGrandeColaboracao('CMS Collaboration'), true);
        assert.strictEqual(L._ehGrandeColaboracao('ATLAS COLLABORATION'), true);
    });

    // Afrouxar para "et al" (sem ponto) faria artigos comuns virarem grande
    // colaboracao: a expressao aparece em titulo e em nome de periodico.
    test('nao confunde "et al" com espaco, nem outras variacoes', () => {
        assert.strictEqual(L._ehGrandeColaboracao('SILVA, J.; et al. Titulo'), false);
        assert.strictEqual(L._ehGrandeColaboracao('SILVA, J. et. al'), false);
        assert.strictEqual(L._ehGrandeColaboracao('SILVA, J.; SOUZA, M.'), false);
    });
});

describe('_contarAutores', () => {
    test('conta so as partes com virgula, que e o formato "SOBRENOME, Iniciais"', () => {
        assert.deepStrictEqual(
            L._contarAutores('SILVA, J.; SOUZA, M. A.; LIMA, P.'),
            ['SILVA, J.', 'SOUZA, M. A.', 'LIMA, P.']);
    });

    test('descarta a numeracao do item no inicio', () => {
        assert.deepStrictEqual(L._contarAutores('12 . SILVA, J.; SOUZA, M.'), ['SILVA, J.', 'SOUZA, M.']);
    });

    test('et.al e COLLABORATION nao entram na contagem', () => {
        assert.deepStrictEqual(L._contarAutores('SILVA, J.; et.al'), ['SILVA, J.']);
        assert.deepStrictEqual(L._contarAutores('SILVA, J.; CMS Collaboration, X'), ['SILVA, J.']);
    });

    test('trecho sem virgula nao vira autor', () => {
        assert.deepStrictEqual(L._contarAutores('Titulo do artigo sem autores'), []);
        assert.deepStrictEqual(L._contarAutores(''), []);
        assert.deepStrictEqual(L._contarAutores(null), []);
    });
});

describe('_ordemDoAutor', () => {
    const autores = ['SILVA, J.', 'AYALA, A. P.', 'LIMA, P.'];

    test('o nome em negrito decide, e a comparacao ignora caixa', () => {
        assert.strictEqual(L._ordemDoAutor(autores, 'ayala, a. p.', []), 2);
    });

    test('sem negrito, usa os apelidos declarados no curriculo', () => {
        assert.strictEqual(L._ordemDoAutor(autores, '', ['LIMA, P.']), 3);
    });

    test('o negrito tem prioridade sobre os apelidos', () => {
        assert.strictEqual(L._ordemDoAutor(autores, 'SILVA, J.', ['LIMA, P.']), 1);
    });

    test('sem correspondencia devolve -1', () => {
        assert.strictEqual(L._ordemDoAutor(autores, 'OUTRO, X.', ['NINGUEM, Y.']), -1);
        assert.strictEqual(L._ordemDoAutor([], 'SILVA, J.', []), -1);
        assert.strictEqual(L._ordemDoAutor(null, '', null), -1);
    });
});

describe('_dadosDoCvuri', () => {
    const cvuri = 'http://x/?titulo=Um Titulo&nomePeriodico=NATURE&issn=00280836&doi=10.1038/x1';

    test('le titulo, periodico, issn com hifen e doi', () => {
        const r = L._dadosDoCvuri(cvuri);
        assert.strictEqual(r.titulo, 'Um Titulo');
        assert.strictEqual(r.periodico, 'NATURE');
        assert.strictEqual(r.issn, '0028-0836');   // o Lattes grava sem o hifen
        assert.strictEqual(r.doi, '10.1038/x1');
    });

    test('desfaz as entidades HTML do atributo', () => {
        const r = L._dadosDoCvuri('http://x/?titulo=Efeito da &quot;alta pressao&quot;');
        assert.strictEqual(r.titulo, 'Efeito da "alta pressao"');
    });

    // LIMITACAO HERDADA de content.js, preservada de proposito para que a troca seja
    // comprovadamente equivalente: o cvuri e decodificado ANTES do recorte, entao um
    // &amp; no titulo vira & e passa a separar campos. O titulo sai truncado ali.
    // So o paperTitle sofre — o corte da lista de autores usa indexOf e ainda acha o
    // prefixo. Corrigir isso e um passo separado, depois da troca.
    test('titulo com & sai truncado, como no content.js de hoje', () => {
        const r = L._dadosDoCvuri('http://x/?titulo=A &amp; B&nomePeriodico=REV');
        assert.strictEqual(r.titulo, 'A');
        assert.strictEqual(r.periodico, 'REV');
    });

    test('issn curto demais e ignorado em vez de virar lixo', () => {
        assert.strictEqual(L._dadosDoCvuri('http://x/?issn=123').issn, '');
    });

    test('cvuri ausente devolve tudo vazio, sem lancar', () => {
        assert.deepStrictEqual(L._dadosDoCvuri(''), { titulo: '', periodico: '', issn: '', doi: '' });
        assert.deepStrictEqual(L._dadosDoCvuri(null), { titulo: '', periodico: '', issn: '', doi: '' });
    });
});

describe('_jcrDoTitulo', () => {
    test('separa o nome do periodico do fator de impacto', () => {
        const r = L._jcrDoTitulo('NATURE (0028-0836)<br />Fator de impacto (JCR 2024): 50.5');
        assert.strictEqual(r.journalName, 'NATURE');
        assert.strictEqual(r.jcrYear, '2024');
        assert.strictEqual(r.impactFactor, '50.5');
    });

    test('aceita o formato com hifen no lugar do <br>', () => {
        const r = L._jcrDoTitulo('PHYSICAL REVIEW B - Fator de Impacto');
        assert.strictEqual(r.journalName, 'PHYSICAL REVIEW B');
    });

    test('sem fator de impacto, so o nome volta preenchido', () => {
        const r = L._jcrDoTitulo('REVISTA X (1234-5678)');
        assert.strictEqual(r.journalName, 'REVISTA X');
        assert.strictEqual(r.impactFactor, null);
        assert.strictEqual(r.jcrYear, null);
    });

    test('titulo ausente devolve tudo vazio', () => {
        assert.deepStrictEqual(L._jcrDoTitulo(''), { journalName: '', jcrYear: null, impactFactor: null });
        assert.deepStrictEqual(L._jcrDoTitulo(null), { journalName: '', jcrYear: null, impactFactor: null });
    });
});

describe('_faixaJcr', () => {
    test('os limiares sao inclusivos', () => {
        assert.strictEqual(L._faixaJcr('7.0', 7.0, 1.5), 'high');
        assert.strictEqual(L._faixaJcr('1.5', 7.0, 1.5), 'mid');
    });

    test('classifica acima, entre e abaixo', () => {
        assert.strictEqual(L._faixaJcr('12.3', 7.0, 1.5), 'high');
        assert.strictEqual(L._faixaJcr('3.0', 7.0, 1.5), 'mid');
        assert.strictEqual(L._faixaJcr('0.8', 7.0, 1.5), 'low');
    });

    test('sem fator, zero ou invalido cai em "none"', () => {
        assert.strictEqual(L._faixaJcr(null, 7.0, 1.5), 'none');
        assert.strictEqual(L._faixaJcr('0', 7.0, 1.5), 'none');
        assert.strictEqual(L._faixaJcr('abc', 7.0, 1.5), 'none');
    });
});

describe('_anoDoTexto', () => {
    test('pega o primeiro ano de quatro digitos', () => {
        assert.strictEqual(L._anoDoTexto('Artigo publicado em 2019 e citado em 2021'), 2019);
    });

    test('sem ano devolve NaN', () => {
        assert.ok(isNaN(L._anoDoTexto('sem ano aqui')));
        assert.ok(isNaN(L._anoDoTexto('')));
    });
});

// O limite tem de ser o mesmo da pagina de producoes: a mesma producao nao pode
// cair em faixas diferentes conforme a fonte de onde foi lida.
describe('limite de grande colaboracao', () => {
    test('vale 21, como em producoes_parser', () => {
        assert.strictEqual(L.AUTORES_GRANDE_COLABORACAO, 21);
    });
});
