'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const P = require('./helpers/load.js').picc();

// O titulo do projeto vem de uma tabela de duas colunas do PDF. O rotulo fica
// centrado verticalmente na celula, entao parte do valor pode cair ACIMA do
// proprio rotulo na ordem de leitura — e o rotulo ainda pode quebrar em duas
// linhas. Estes casos reproduzem os dois layouts vistos nas propostas reais.
describe('lerTituloResumo', () => {
    // Monta allPageItems/allLines/fullText como o pdf.js os entrega, a partir de
    // uma lista de linhas {y, celulas:[{x, texto}]}.
    const pdf = (linhas) => {
        const allLines = linhas.map(l => l.celulas.map(c => ({
            page: 1, x: c.x, y: l.y, str: c.texto,
        })));
        const allPageItems = [].concat.apply([], allLines);
        const fullText = allLines.map(l => l.map(i => i.str).join(' ')).join('\n');
        return [allPageItems, allLines, fullText];
    };
    const L = (y, ...celulas) => ({ y, celulas: celulas.map(c => ({ x: c[0], texto: c[1] })) });

    test('rotulo numa linha so: pega o titulo em portugues e para no ingles', () => {
        const r = P.lerTituloResumo(...pdf([
            L(470, [53, 'PROJETO']),
            L(445, [51, 'INÍCIO:'], [186, '04/12/2026'], [271, 'DURAÇÃO:'], [406, '60 meses']),
            L(433, [51, 'TÍTULO (em português):'], [186, 'Materiais Catódicos para Baterias:']),
            L(425, [186, 'Desenvolvimento Sustentável']),
            L(413, [51, 'TÍTULO (em inglês):']),
            L(402, [186, 'Cathode Materials for Battery']),
        ]));
        assert.strictEqual(r.tituloProjeto, 'Materiais Catódicos para Baterias: Desenvolvimento Sustentável');
    });

    test('rotulo quebrado em duas linhas, com o valor comecando acima dele', () => {
        // Layout da proposta 409210: o valor ocupa 5 linhas e o rotulo, centrado,
        // aparece entre a 3a e a 4a. O texto linear traria o ingles junto.
        const r = P.lerTituloResumo(...pdf([
            L(249, [33, 'PROJETO']),
            L(217, [35, 'INÍCIO:'], [160, '06/10/2025'], [478, 'DURAÇÃO:']),
            L(211, [531, 'meses']),
            L(197, [160, 'Nanotecnologia Sustentável']),
            L(186, [160, 'Desenvolvimento de Nanomateriais']),
            L(181, [35, 'TÍTULO (em']),
            L(175, [160, 'Estratégicos para Nutrição']),
            L(169, [35, 'português):']),
            L(163, [160, 'de Culturas de Alagoas']),
            L(140, [160, 'Sustainable Nanotechnology']),
            L(129, [35, 'TÍTULO (em inglês):']),
        ]));
        assert.strictEqual(
            r.tituloProjeto,
            'Nanotecnologia Sustentável Desenvolvimento de Nanomateriais Estratégicos para Nutrição de Culturas de Alagoas');
    });

    test('o bloco DURACAO acima nao vaza para o titulo', () => {
        const r = P.lerTituloResumo(...pdf([
            L(249, [33, 'PROJETO']),
            L(217, [35, 'INÍCIO:'], [160, '06/10/2025'], [478, 'DURAÇÃO:']),
            L(211, [531, 'meses']),
            L(197, [160, 'Só o título']),
            L(181, [35, 'TÍTULO (em português):']),
            L(160, [35, 'TÍTULO (em inglês):']),
        ]));
        assert.ok(!/meses/.test(r.tituloProjeto), 'titulo trouxe "meses": ' + r.tituloProjeto);
    });

    test('sem as coordenadas esperadas, cai no recorte do texto linear', () => {
        const r = P.lerTituloResumo([], [], 'TÍTULO (em português): Um título\nTÍTULO (em inglês): A title');
        assert.strictEqual(r.tituloProjeto, 'Um título');
    });

    test('resumo vai de RESUMO ate ETAPAS, sem o rodape de paginacao', () => {
        const r = P.lerTituloResumo([], [], [
            'RESUMO',
            'Primeira parte do resumo',
            'Página 3 / 12',
            'segunda parte do resumo.',
            'ETAPAS / ATIVIDADES',
            'DESCRIÇÃO INICIO PRAZO',
        ].join('\n'));
        assert.strictEqual(r.resumoProjeto, 'Primeira parte do resumo segunda parte do resumo.');
    });

    test('entradas degeneradas devolvem vazio sem lancar', () => {
        assert.deepStrictEqual(P.lerTituloResumo(null, null, null), { tituloProjeto: '', resumoProjeto: '' });
        assert.deepStrictEqual(P.lerTituloResumo([], [], ''), { tituloProjeto: '', resumoProjeto: '' });
    });
});

// --- Cabeçalho da proposta ---------------------------------------------------

describe('_edital', () => {
    test('prefere o caminho do PDF, que e o dado mais confiavel', () => {
        assert.strictEqual(P._edital('http://anexosform.cnpq.br/doc/Universal_2026/6/x_cp.pdf', 'SIGLA: Outra'), 'Universal_2026');
    });

    test('sem URL, cai na SIGLA do texto', () => {
        assert.strictEqual(P._edital('', 'CHAMADA\nSIGLA: Universal 2026\nCOMITE'), 'Universal 2026');
    });

    test('sem nenhum dos dois, devolve vazio', () => {
        assert.strictEqual(P._edital('', 'texto sem sigla'), '');
        assert.strictEqual(P._edital(null, null), '');
    });
});

describe('_faixa', () => {
    test('le a letra da faixa e normaliza para maiuscula', () => {
        assert.strictEqual(P._faixa('Chamada ... - Faixa b: Grupos consolidados'), 'B');
    });

    test('aceita faixa numerica', () => {
        assert.strictEqual(P._faixa('Faixa 2 - descricao'), '2');
    });

    // "-" e o valor que a tabela de propostas mostra quando nao ha faixa.
    test('sem faixa devolve o traco, nao vazio', () => {
        assert.strictEqual(P._faixa('chamada sem faixa'), '-');
        assert.strictEqual(P._faixa(''), '-');
    });
});

describe('_processo', () => {
    test('le o numero no formato do CNPq', () => {
        assert.strictEqual(P._processo('Processo: 429018/2026-6\nPROPOSTA'), '429018/2026-6');
    });

    test('sem processo devolve vazio', () => {
        assert.strictEqual(P._processo('sem numero'), '');
    });
});

describe('_protocolo', () => {
    test('le os 16 digitos depois de PROPOSTA', () => {
        assert.strictEqual(P._protocolo('PROPOSTA 5325027670185623 Envio'), '5325027670185623');
    });

    test('sem o rotulo, aceita a sequencia que comeca em 00', () => {
        assert.strictEqual(P._protocolo('Setor: X 0084400192409407 fim'), '0084400192409407');
    });

    test('sem protocolo devolve vazio', () => {
        assert.strictEqual(P._protocolo('nada'), '');
    });
});

describe('_nomeProponente', () => {
    test('prefere o NOME que vem dentro do bloco PROPONENTE', () => {
        const t = 'PROPONENTE\nNOME: Bruno Santos Correa\nCPF: 000\nCHAMADA\nNOME: Chamada Publica';
        assert.strictEqual(P._nomeProponente(t), 'Bruno Santos Correa');
    });

    test('sem o bloco, aceita o primeiro NOME do texto', () => {
        assert.strictEqual(P._nomeProponente('NOME: Ana Souza\noutra coisa'), 'Ana Souza');
    });

    test('sem nome devolve vazio', () => {
        assert.strictEqual(P._nomeProponente('texto qualquer'), '');
    });
});

// --- Campos de um membro da equipe -------------------------------------------

describe('_uf', () => {
    test('le a sigla no formato "- CE -" da instituicao', () => {
        assert.strictEqual(P._uf('Universidade Federal do Ceara-UFC-CE-Brasil-'), 'CE');
    });

    test('aceita a sigla solta apos virgula', () => {
        assert.strictEqual(P._uf('Universidade Federal do Rio Grande do Norte - UFRN, RN, Brasil'), 'RN');
    });

    test('normaliza para maiuscula', () => {
        assert.strictEqual(P._uf('Instituto X -sp- Brasil'), 'SP');
    });

    test('instituicao sem UF devolve vazio', () => {
        assert.strictEqual(P._uf('Universidade Federal'), '');
        assert.strictEqual(P._uf(''), '');
        assert.strictEqual(P._uf(null), '');
    });
});

describe('_ehUrlLattes', () => {
    test('aceita o endereco canonico com os 16 digitos', () => {
        assert.strictEqual(P._ehUrlLattes('http://lattes.cnpq.br/4274598374126989'), true);
        assert.strictEqual(P._ehUrlLattes('https://lattes.cnpq.br/4274598374126989'), true);
        assert.strictEqual(P._ehUrlLattes('  http://lattes.cnpq.br/4274598374126989  '), true);
    });

    test('recusa numero de tamanho errado e outros enderecos', () => {
        assert.strictEqual(P._ehUrlLattes('http://lattes.cnpq.br/123'), false);
        assert.strictEqual(P._ehUrlLattes('http://buscatextual.cnpq.br/x'), false);
        assert.strictEqual(P._ehUrlLattes('4274598374126989'), false);
        assert.strictEqual(P._ehUrlLattes(''), false);
        assert.strictEqual(P._ehUrlLattes(null), false);
    });
});

describe('_formacao', () => {
    test('normaliza cada nivel para um nome so', () => {
        assert.strictEqual(P._formacao('Doutor em Fisica'), 'Doutorado');
        assert.strictEqual(P._formacao('Mestre'), 'Mestrado');
        assert.strictEqual(P._formacao('Bacharel'), 'Graduação');
        assert.strictEqual(P._formacao('Licenciatura'), 'Graduação');
        assert.strictEqual(P._formacao('Especialista'), 'Especialização');
    });

    // Pos-Doutorado nao pode ser reduzido a Doutorado.
    test('pos-doutorado e um nivel proprio, com ou sem acento', () => {
        assert.strictEqual(P._formacao('Pós-Doutorado'), 'Pós-Doutorado');
        assert.strictEqual(P._formacao('Pos-Doutorado'), 'Pós-Doutorado');
    });

    // A coluna do PDF vem colada a restos das colunas vizinhas.
    test('descarta URL, ID de 16 digitos e rotulos que vazam de outras colunas', () => {
        assert.strictEqual(
            P._formacao('FORMAÇÃO/ TITULAÇÃO Doutorado URL DO CURRÍCULO http://lattes.cnpq.br/4274598374126989'),
            'Doutorado');
    });

    test('texto sem nivel reconhecivel vira vazio, e nao sujeira', () => {
        assert.strictEqual(P._formacao('Pesquisador Colaborador'), '');
        assert.strictEqual(P._formacao('-'), '');
        assert.strictEqual(P._formacao(''), '');
        assert.strictEqual(P._formacao(null), '');
    });
});

describe('_ehBolsaValida', () => {
    test('aceita os niveis numericos de PQ e DT', () => {
        ['PQ 1A', 'PQ 1B', 'PQ 1C', 'PQ 1D', 'PQ 2', 'DT 1A', 'DT 2'].forEach(b => {
            assert.strictEqual(P._ehBolsaValida(b), true, b);
        });
    });

    test('aceita senior e os niveis de letra', () => {
        ['PQ SR', 'PQ A', 'PQ B', 'PQ C', 'DT C'].forEach(b => {
            assert.strictEqual(P._ehBolsaValida(b), true, b);
        });
    });

    test('aceita hifen e espacos extras entre sigla e nivel', () => {
        assert.strictEqual(P._ehBolsaValida('PQ-1A'), true);
        assert.strictEqual(P._ehBolsaValida('  DT - 2  '), true);
    });

    // Sem exigir separador antes da letra, "DTA" (analise termica) viraria bolsa
    // DT-A — foi o que motivou serem duas expressoes e nao uma.
    test('letra colada na sigla NAO e bolsa', () => {
        assert.strictEqual(P._ehBolsaValida('DTA'), false);
        assert.strictEqual(P._ehBolsaValida('PQA'), false);
    });

    test('vazio, traco e texto qualquer nao sao bolsa', () => {
        assert.strictEqual(P._ehBolsaValida('-'), false);
        assert.strictEqual(P._ehBolsaValida(''), false);
        assert.strictEqual(P._ehBolsaValida('Pesquisador'), false);
        assert.strictEqual(P._ehBolsaValida('PQ 9'), false);
        assert.strictEqual(P._ehBolsaValida(null), false);
        assert.strictEqual(P._ehBolsaValida(123), false);
    });
});
