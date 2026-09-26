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

// --- Orientações -------------------------------------------------------------

describe('_ultimoAno', () => {
    // O primeiro ano do texto costuma ser o do inicio do vinculo; o que interessa na
    // orientacao concluida e o ultimo.
    test('pega o ultimo ano, nao o primeiro', () => {
        assert.strictEqual(L._ultimoAno('Iniciou em 2018. Conclusao: 2022. Universidade X'), 2022);
    });

    test('um unico ano serve', () => {
        assert.strictEqual(L._ultimoAno('Defesa em 2021.'), 2021);
    });

    test('sem ano devolve NaN', () => {
        assert.ok(isNaN(L._ultimoAno('sem ano')));
        assert.ok(isNaN(L._ultimoAno('')));
        assert.ok(isNaN(L._ultimoAno(null)));
    });
});

describe('_areaEInstituicao', () => {
    test('formato "(Area) - Instituicao" e o caso direto', () => {
        const r = L._areaEInstituicao('Tese de doutorado. 2022. (Física) - Universidade Federal do Ceará, CNPq');
        assert.strictEqual(r.area, 'Física');
        assert.strictEqual(r.institution, 'Universidade Federal do Ceará');
    });

    // So conta o que vem DEPOIS do ultimo ano: um parentese no titulo do trabalho
    // nao pode ser confundido com a area.
    test('parentese antes do ultimo ano nao vira area', () => {
        const r = L._areaEInstituicao('Estudo de (alta pressao) em cristais. 2020. (Química) - UFC');
        assert.strictEqual(r.area, 'Química');
        assert.strictEqual(r.institution, 'UFC');
    });

    test('sem area, cai em "natureza - Instituicao"', () => {
        const r = L._areaEInstituicao('Orientação de outra natureza - Universidade Estadual X, 2019');
        assert.strictEqual(r.area, '');
        assert.strictEqual(r.institution, 'Universidade Estadual X');
    });

    test('ultimo recurso: o texto logo apos "ano. "', () => {
        const r = L._areaEInstituicao('Monografia. 2018. Instituto Federal do Piauí, bolsa');
        assert.strictEqual(r.institution, 'Instituto Federal do Piauí');
    });

    test('texto sem nada reconhecivel devolve os dois vazios', () => {
        assert.deepStrictEqual(L._areaEInstituicao('texto solto'), { area: '', institution: '' });
        assert.deepStrictEqual(L._areaEInstituicao(''), { area: '', institution: '' });
    });
});

describe('_ehCoorientacao', () => {
    test('reconhece as duas grafias do Lattes', () => {
        assert.strictEqual(L._ehCoorientacao('Coorientador: Fulano'), true);
        assert.strictEqual(L._ehCoorientacao('Co-orientador: Fulano'), true);
    });

    test('orientacao comum nao e coorientacao', () => {
        assert.strictEqual(L._ehCoorientacao('Orientador: Fulano'), false);
        assert.strictEqual(L._ehCoorientacao(''), false);
    });
});

// --- Patentes ----------------------------------------------------------------

describe('_etapasDaPatente', () => {
    test('le cada etapa no formato "Status: dd/mm/aaaa"', () => {
        const r = L._etapasDaPatente('Depósito: 10/03/2019, Concessão: 25/11/2021');
        assert.deepStrictEqual(r.map(e => e.status), ['Depósito', 'Concessão']);
        assert.deepStrictEqual(r.map(e => e.year), [2019, 2021]);
    });

    // "Data de registro" e um dado do documento, nao uma etapa de tramitacao.
    test('descarta a data de registro', () => {
        const r = L._etapasDaPatente('Data de registro: 01/01/2020, Depósito: 10/03/2019');
        assert.deepStrictEqual(r.map(e => e.status), ['Depósito']);
    });

    test('a data vira Date de verdade, para poder ordenar', () => {
        const r = L._etapasDaPatente('Depósito: 10/03/2019');
        assert.ok(r[0].date instanceof Date);
        assert.strictEqual(r[0].date.getFullYear(), 2019);
        assert.strictEqual(r[0].date.getMonth(), 2);    // marco = 2
        assert.strictEqual(r[0].date.getDate(), 10);
    });

    test('texto sem etapa devolve lista vazia', () => {
        assert.deepStrictEqual(L._etapasDaPatente('patente sem datas'), []);
        assert.deepStrictEqual(L._etapasDaPatente(''), []);
    });
});

describe('_numeroDoRegistro', () => {
    test('le o numero, com ou sem acento no rotulo', () => {
        assert.strictEqual(L._numeroDoRegistro('Número do registro: BR102019001, outro'), 'BR102019001');
        assert.strictEqual(L._numeroDoRegistro('Numero do registro: BR999'), 'BR999');
    });

    test('sem registro devolve vazio', () => {
        assert.strictEqual(L._numeroDoRegistro('patente qualquer'), '');
        assert.strictEqual(L._numeroDoRegistro(''), '');
    });
});

// --- Trabalhos em eventos ----------------------------------------------------
// Nenhum dos curriculos salvos em test_pages tem eventos, entao a comparacao
// antes/depois nao exercitou esta parte: e aqui que ela fica coberta.

describe('_anoDoEvento', () => {
    test('le o ano que antecede o parentese do tipo de trabalho', () => {
        assert.strictEqual(L._anoDoEvento('XX Encontro de Física. 2019. (Congresso)'), 2019);
    });

    test('ano solto, sem o parentese, nao conta', () => {
        assert.ok(isNaN(L._anoDoEvento('Trabalho de 2019 apresentado')));
        assert.ok(isNaN(L._anoDoEvento('')));
    });
});

describe('_tipoDeParticipacao', () => {
    test('le o tipo e remove a pontuacao final', () => {
        assert.strictEqual(L._tipoDeParticipacao('Tipo de participação: Apresentação Oral.'), 'Apresentação Oral');
    });

    test('corta no que vem depois do tipo', () => {
        assert.strictEqual(
            L._tipoDeParticipacao('Tipo de participação: Painel. Forma de participação: presencial'),
            'Painel');
        assert.strictEqual(
            L._tipoDeParticipacao('Tipo de participação: Conferência Homepage: http://x'),
            'Conferência');
    });

    test('remove marcacao HTML que sobre no texto', () => {
        assert.strictEqual(L._tipoDeParticipacao('Tipo de participação: <b>Simpósio</b>.'), 'Simpósio');
    });

    test('sem o rotulo, devolve Desconhecido — e o evento e descartado', () => {
        assert.strictEqual(L._tipoDeParticipacao('evento sem tipo'), 'Desconhecido');
        assert.strictEqual(L._tipoDeParticipacao(''), 'Desconhecido');
    });
});

// --- Identificação do pesquisador --------------------------------------------

describe('_bolsaDoTexto', () => {
    test('Produtividade em Pesquisa vira PQ', () => {
        assert.strictEqual(L._bolsaDoTexto('Bolsista de Produtividade em Pesquisa do CNPq - Nível 1B'), 'PQ 1B');
    });

    test('Desenvolvimento Tecnológico vira DT, nas duas grafias', () => {
        assert.strictEqual(L._bolsaDoTexto('Bolsista de Produtividade em Desenvolvimento Tecnológico - Nível 2'), 'DT 2');
        assert.strictEqual(L._bolsaDoTexto('Bolsista de Produtividade Desen. Tec. - Nível A'), 'DT A');
    });

    test('cobre os niveis 1A a 1D', () => {
        ['1A', '1B', '1C', '1D'].forEach(n => {
            assert.strictEqual(L._bolsaDoTexto(`Produtividade em Pesquisa - Nível ${n}`), 'PQ ' + n);
        });
    });

    test('cobre os niveis de letra e o senior', () => {
        ['A', 'B', 'C', 'SR'].forEach(n => {
            assert.strictEqual(L._bolsaDoTexto(`Produtividade em Pesquisa - Nível ${n}`), 'PQ ' + n);
        });
    });

    // Sem esta prioridade, o "2" de "2 do CNPq" ou qualquer numero da frase poderia
    // ser lido como nivel antes do valor certo.
    test('o nivel explicito vence um codigo solto que apareca antes', () => {
        assert.strictEqual(L._bolsaDoTexto('Produtividade em Pesquisa 2 do CNPq - Nível 1A'), 'PQ 1A');
    });

    test('sem "Nível", aceita o codigo solto', () => {
        assert.strictEqual(L._bolsaDoTexto('Produtividade em Pesquisa - 1C - CNPq'), 'PQ 1C');
    });

    test('sem nivel nenhum, devolve so a sigla', () => {
        assert.strictEqual(L._bolsaDoTexto('Bolsista de Produtividade em Pesquisa do CNPq'), 'PQ');
    });

    test('o nivel e normalizado para maiuscula', () => {
        assert.strictEqual(L._bolsaDoTexto('Produtividade em Pesquisa - Nível 1a'), 'PQ 1A');
    });

    test('texto que nao e bolsa de produtividade devolve vazio', () => {
        assert.strictEqual(L._bolsaDoTexto('Professor Titular da Universidade'), '');
        assert.strictEqual(L._bolsaDoTexto('Bolsista de Doutorado - Nível 1A'), '');
        assert.strictEqual(L._bolsaDoTexto(''), '');
        assert.strictEqual(L._bolsaDoTexto(null), '');
    });
});

describe('_apelidosDoTexto', () => {
    test('separa por ponto e virgula e tira os espacos', () => {
        assert.deepStrictEqual(
            L._apelidosDoTexto('AYALA, A. P.;  AYALA, ALEJANDRO ; Ayala, A.'),
            ['AYALA, A. P.', 'AYALA, ALEJANDRO', 'Ayala, A.']);
    });

    test('descarta separadores vazios', () => {
        assert.deepStrictEqual(L._apelidosDoTexto('SILVA, J.;;  ; LIMA, P.'), ['SILVA, J.', 'LIMA, P.']);
    });

    test('um nome so continua valendo', () => {
        assert.deepStrictEqual(L._apelidosDoTexto('SILVA, J.'), ['SILVA, J.']);
    });

    test('texto vazio devolve lista vazia', () => {
        assert.deepStrictEqual(L._apelidosDoTexto(''), []);
        assert.deepStrictEqual(L._apelidosDoTexto(null), []);
    });
});
