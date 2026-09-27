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

// --- Instituições e anexos ---------------------------------------------------

describe('_pareceInstituicao', () => {
    test('aceita o formato "Nome - SIGLA, UF, Pais"', () => {
        assert.strictEqual(P._pareceInstituicao('Universidade Federal do Rio Grande do Norte - UFRN, RN, Brasil'), true);
    });

    test('aceita travessao no lugar do hifen', () => {
        assert.strictEqual(P._pareceInstituicao('Instituto Federal – IFPA, PA, Brasil'), true);
    });

    // O bloco de orcamento fica logo abaixo e tem linhas com hifen e virgula que
    // passariam pelo formato; por isso as palavras de orcamento sao barradas.
    test('recusa linhas do bloco de orcamento', () => {
        assert.strictEqual(P._pareceInstituicao('DETALHAMENTO - Equipamento, 2, un'), false);
        assert.strictEqual(P._pareceInstituicao('VALOR TOTAL - R$ 50.000, Custeio, Brasil'), false);
    });

    test('recusa linha sem separador ou sem o final esperado', () => {
        assert.strictEqual(P._pareceInstituicao('Universidade Federal do Ceara'), false);
        assert.strictEqual(P._pareceInstituicao('UFC - 12345'), false);
        assert.strictEqual(P._pareceInstituicao('a - b'), false);   // curta demais
        assert.strictEqual(P._pareceInstituicao(''), false);
    });
});

describe('_instituicaoExecutora', () => {
    test('le o valor que vem na linha seguinte ao rotulo', () => {
        const t = ['INSTITUIÇÕES ENVOLVIDAS', 'Executora/Sede',
                   'Universidade Federal do Pará - UFPA, PA, Brasil',
                   'Colaboradora', 'Instituto X - IX, SP, Brasil'].join('\n');
        assert.strictEqual(P._instituicaoExecutora(t), 'Universidade Federal do Pará - UFPA, PA, Brasil');
    });

    test('le o valor quando vem na mesma linha do rotulo', () => {
        const t = 'Executora/Sede: Universidade Estadual de Campinas - UNICAMP, SP, Brasil';
        assert.strictEqual(P._instituicaoExecutora(t), 'Universidade Estadual de Campinas - UNICAMP, SP, Brasil');
    });

    // A ordenacao por coordenada intercala rodape de pagina entre o rotulo e o valor.
    test('pula o rodape de paginacao que cai no meio', () => {
        const t = ['Executora/Sede', 'Página 2 / 12',
                   'Universidade de São Paulo - USP, SP, Brasil'].join('\n');
        assert.strictEqual(P._instituicaoExecutora(t), 'Universidade de São Paulo - USP, SP, Brasil');
    });

    test('para em Colaboradora: nao pega a instituicao errada', () => {
        const t = ['Executora/Sede', 'Colaboradora', 'Instituto Y - IY, RJ, Brasil'].join('\n');
        assert.strictEqual(P._instituicaoExecutora(t), '');
    });

    test('sem o rotulo devolve vazio', () => {
        assert.strictEqual(P._instituicaoExecutora('texto sem o bloco'), '');
        assert.strictEqual(P._instituicaoExecutora(''), '');
    });
});

describe('_anexos', () => {
    const bloco = (corpo) => 'DOCUMENTOS ANEXOS ARQUIVO TAMANHO URL ' + corpo + ' DECLARAÇÃO';

    test('le os pares tipo/URL do bloco', () => {
        const r = P._anexos(bloco('Projeto de Pesquisa - http://anexosform.cnpq.br/doc/X/1/a_01.pdf'));
        assert.strictEqual(r.length, 1);
        assert.strictEqual(r[0].type, 'Projeto de Pesquisa');
        assert.strictEqual(r[0].url, 'http://anexosform.cnpq.br/doc/X/1/a_01.pdf');
    });

    // O curriculo e o que o revisor abre por ultimo; o projeto vem primeiro.
    test('curriculos vao para o fim da lista', () => {
        const r = P._anexos(bloco(
            'Currículo - http://anexosform.cnpq.br/doc/X/1/cv_01.pdf ' +
            'Projeto de Pesquisa - http://anexosform.cnpq.br/doc/X/1/proj_02.pdf'));
        assert.deepStrictEqual(r.map(a => a.type), ['Projeto de Pesquisa', 'Currículo']);
    });

    // O PDF as vezes corta a extensao ao quebrar a linha.
    test('conserta a URL terminada em .pd', () => {
        const r = P._anexos(bloco('Anexo - http://anexosform.cnpq.br/doc/X/1/a_01.pd'));
        assert.strictEqual(r[0].url, 'http://anexosform.cnpq.br/doc/X/1/a_01.pdf');
    });

    test('sem o bloco, ainda aproveita um endereco solto', () => {
        const r = P._anexos('texto qualquer http://anexosform.cnpq.br/doc/X/1/solto_01.pdf fim');
        assert.strictEqual(r.length, 1);
        assert.strictEqual(r[0].type, 'Anexo');
    });

    test('sem nenhum endereco devolve lista vazia', () => {
        assert.deepStrictEqual(P._anexos('proposta sem anexos'), []);
        assert.deepStrictEqual(P._anexos(''), []);
    });
});

// --- Equipe ------------------------------------------------------------------
// A leitura por coordenadas nao tem como ser validada so com teste sintetico — a
// prova esta na comparacao sobre os 34 PDFs reais. O que se fixa aqui sao as regras
// de decisao que um teste consegue isolar.

describe('lerEquipe', () => {
    const it = (x, y, str) => ({ page: 1, x, y, str });
    // cabecalho nas posicoes padrao (45/160/225/258/400)
    const cabecalho = [
        it(50, 700, 'EQUIPE'),
        it(45, 680, 'NOME'), it(160, 680, 'FORMAÇÃO/'), it(225, 680, 'BOLSA'),
        it(258, 680, 'INSTITUIÇÃO/'), it(400, 680, 'ÁREAS'),
    ];
    const fimDeBloco = (y, url) => [
        it(45, y, 'TEMPO'),
        it(45, y - 10, 'URL'), it(70, y - 10, 'DO'), it(100, y - 10, 'CURRÍCULO'),
        it(200, y - 10, url || 'http://lattes.cnpq.br/1234567890123456'),
    ];
    const membro = (y, nome, form, bolsa, inst) => [
        it(45, y, nome), it(160, y, form), it(225, y, bolsa), it(258, y, inst),
    ];

    test('le nome, titulacao, bolsa e instituicao de cada coluna', () => {
        const r = P.lerEquipe([].concat(cabecalho, membro(670, 'Ana Souza', 'Doutorado', 'PQ 1A', 'UFC'), fimDeBloco(660)));
        assert.strictEqual(r.length, 1);
        assert.strictEqual(r[0].name, 'Ana Souza');
        assert.strictEqual(r[0].formacao, 'Doutorado');
        assert.strictEqual(r[0].bolsa, 'PQ 1A');
        assert.strictEqual(r[0].instituicao, 'UFC');
        assert.strictEqual(r[0].lattesId, '1234567890123456');
    });

    // O PDF quebra "Pesquisador Estrangeiro" em dois itens de texto. Testando a
    // categoria simples primeiro, "Pesquisador" casava sozinho e o estrangeiro
    // entrava como pesquisador comum, somando os dois grupos na distribuicao.
    test('categoria composta vence a simples quando o PDF quebra o rotulo', () => {
        const r = P.lerEquipe([].concat(
            cabecalho,
            [it(50, 675, 'Pesquisador'), it(95, 675, 'Estrangeiro')],
            membro(670, 'Hans Vogel', 'Doutorado', '-', 'Max Planck'),
            fimDeBloco(660)));
        assert.strictEqual(r[0].categoria, 'Pesquisador Estrangeiro');
    });

    test('categoria composta tambem e reconhecida quando vem num item so', () => {
        const r = P.lerEquipe([].concat(
            cabecalho,
            [it(50, 675, 'Pesquisador Estrangeiro')],
            membro(670, 'Hans Vogel', 'Doutorado', '-', 'Max Planck'),
            fimDeBloco(660)));
        assert.strictEqual(r[0].categoria, 'Pesquisador Estrangeiro');
    });

    test('a categoria vale para os membros seguintes ate mudar', () => {
        const r = P.lerEquipe([].concat(
            cabecalho,
            [it(50, 675, 'Aluno')],
            membro(670, 'Paula Nunes', '-', '-', 'UFC'), fimDeBloco(660),
            membro(640, 'Rafael Dias', '-', '-', 'UFC'), fimDeBloco(630, 'http://lattes.cnpq.br/9999999999999999')));
        assert.deepStrictEqual(r.map(m => m.categoria), ['Aluno', 'Aluno']);
    });

    // Sem isso, um cabecalho de secao entraria na equipe como se fosse pessoa.
    test('descarta blocos cujo nome e cabecalho de secao', () => {
        const r = P.lerEquipe([].concat(cabecalho, membro(670, 'Quadro Geral', '', '', ''), fimDeBloco(660)));
        assert.strictEqual(r.length, 0);
    });

    test('bolsa que nao e de produtividade vira traco', () => {
        const r = P.lerEquipe([].concat(cabecalho, membro(670, 'Ana Souza', 'Doutorado', 'DTA', 'UFC'), fimDeBloco(660)));
        assert.strictEqual(r[0].bolsa, '-');
    });

    test('URL que nao e do Lattes nao vira cvLink', () => {
        const r = P.lerEquipe([].concat(cabecalho,
            membro(670, 'Ana Souza', 'Doutorado', '-', 'UFC'),
            fimDeBloco(660, 'http://exemplo.com/perfil')));
        assert.strictEqual(r[0].cvLink, '');
        assert.strictEqual(r[0].lattesId, '');
    });

    test('entrada vazia ou invalida devolve lista vazia, sem lancar', () => {
        assert.deepStrictEqual(P.lerEquipe([]), []);
        assert.deepStrictEqual(P.lerEquipe(null), []);
        assert.deepStrictEqual(P.lerEquipe(undefined), []);
    });
});

// --- Quadro Geral ------------------------------------------------------------

describe('lerQuadroGeral', () => {
    const it = (x, y, str) => ({ page: 1, x, y, str });
    const topo = [it(50, 500, 'Quadro Geral'), it(50, 490, 'CATEGORIA'), it(200, 490, 'NÚMERO')];

    test('le o numero quando vem no mesmo item da categoria', () => {
        const r = P.lerQuadroGeral([].concat(topo, [it(50, 470, 'Pesquisador 5'), it(50, 460, 'Aluno 10')]));
        assert.deepStrictEqual(r, [
            { categoria: 'Pesquisador', quantidade: 5 },
            { categoria: 'Aluno', quantidade: 10 },
        ]);
    });

    test('le o numero quando vem numa coluna a direita, pelo y', () => {
        const r = P.lerQuadroGeral([].concat(topo, [
            it(50, 470, 'Pesquisador'), it(200, 470, '5'),
            it(50, 460, 'Aluno'), it(200, 460, '10'),
        ]));
        assert.deepStrictEqual(r, [
            { categoria: 'Pesquisador', quantidade: 5 },
            { categoria: 'Aluno', quantidade: 10 },
        ]);
    });

    // O PDF quebra "Pesquisador Estrangeiro" em dois itens com o mesmo y. Casando
    // cada pedaco com o numero da linha, saiam duas categorias — "Pesquisador" e
    // "Estrangeiro" —, ambas com a mesma quantidade, inflando o total da equipe.
    test('remonta a categoria quebrada em dois itens na mesma linha', () => {
        const r = P.lerQuadroGeral([].concat(topo, [
            it(50, 470, 'Pesquisador'), it(110, 470, 'Estrangeiro'), it(200, 470, '3'),
        ]));
        assert.deepStrictEqual(r, [{ categoria: 'Pesquisador Estrangeiro', quantidade: 3 }]);
    });

    test('remonta na ordem de leitura, nao na ordem dos itens', () => {
        const r = P.lerQuadroGeral([].concat(topo, [
            it(110, 470, 'Estrangeiro'), it(50, 470, 'Pesquisador'), it(200, 470, '3'),
        ]));
        assert.strictEqual(r[0].categoria, 'Pesquisador Estrangeiro');
    });

    test('o cabecalho da tabela nao vira categoria', () => {
        const r = P.lerQuadroGeral([].concat(topo, [
            it(50, 470, 'CATEGORIA'), it(120, 470, 'PARTICIPANTES'),
            it(50, 460, 'Aluno'), it(200, 460, '7'),
        ]));
        assert.deepStrictEqual(r, [{ categoria: 'Aluno', quantidade: 7 }]);
    });

    // O bloco termina onde a secao seguinte comeca.
    test('para na secao seguinte e nao invade o RESUMO', () => {
        const r = P.lerQuadroGeral([].concat(topo, [
            it(50, 470, 'Pesquisador'), it(200, 470, '5'),
            it(50, 450, 'RESUMO'),
            it(50, 440, 'Texto do resumo'), it(200, 440, '99'),
        ]));
        assert.deepStrictEqual(r, [{ categoria: 'Pesquisador', quantidade: 5 }]);
    });

    test('sem o bloco, ou com entrada invalida, devolve lista vazia', () => {
        assert.deepStrictEqual(P.lerQuadroGeral([it(50, 500, 'Outra coisa')]), []);
        assert.deepStrictEqual(P.lerQuadroGeral([]), []);
        assert.deepStrictEqual(P.lerQuadroGeral(null), []);
    });
});

// --- Proponente (cabeçalho da página 1) --------------------------------------

describe('lerProponente', () => {
    // allLines e uma lista de linhas, cada uma com seus itens de texto. A coluna do
    // rotulo fica a esquerda de x=140; o valor, a direita.
    const linha = (...itens) => itens.map(([x, str]) => ({ page: 1, x, y: 700, str }));

    test('le instituicao e titulacao dos rotulos da pagina 1', () => {
        const r = P.lerProponente([
            linha([40, 'FORMAÇÃO/TITULAÇÃO:'], [160, 'Doutorado em Física, UFC, 2010']),
            linha([40, 'INSTITUIÇÃO'], [160, 'Universidade Federal do Pará - UFPA, Brasil']),
            linha([40, 'CHAMADA'], [160, 'Chamada Publica 6/2026']),
        ]);
        assert.strictEqual(r.instituicao, 'Universidade Federal do Pará - UFPA, Brasil');
        assert.strictEqual(r.formacao, 'Doutorado');
    });

    // A instituicao costuma ocupar varias linhas, com o rotulo so na primeira.
    test('acumula a instituicao que continua nas linhas seguintes', () => {
        const r = P.lerProponente([
            linha([40, 'INSTITUIÇÃO'], [160, 'Instituto de Pesquisas']),
            linha([160, 'Energéticas e Nucleares']),
            linha([160, 'IPEN/CNEN - SP']),
            linha([40, 'CHAMADA'], [160, 'Outra coisa']),
        ]);
        assert.strictEqual(r.instituicao, 'Instituto de Pesquisas Energéticas e Nucleares IPEN/CNEN - SP');
    });

    test('o rotulo pode vir quebrado como VÍNCULO', () => {
        const r = P.lerProponente([
            linha([40, 'INSTITUIÇÃO'], [160, 'Universidade X']),
            linha([40, 'VÍNCULO:']),
        ]);
        assert.strictEqual(r.instituicao, 'Universidade X');
    });

    // Sem a parada, a leitura engoliria o bloco seguinte inteiro.
    test('para nos rotulos das secoes seguintes', () => {
        ['CHAMADA', 'COMITÊ', 'PROJETO', 'SIGLA', 'EQUIPE', 'PALAVRAS', 'RESUMO', 'CPF'].forEach(rotulo => {
            const r = P.lerProponente([
                linha([40, 'INSTITUIÇÃO'], [160, 'Universidade X']),
                linha([40, rotulo], [160, 'nao deve entrar']),
            ]);
            assert.strictEqual(r.instituicao, 'Universidade X', 'parou em ' + rotulo);
        });
    });

    test('linha vazia tambem encerra o bloco', () => {
        const r = P.lerProponente([
            linha([40, 'INSTITUIÇÃO'], [160, 'Universidade X']),
            linha([40, 'QUALQUER COISA']),
            linha([160, 'nao deve entrar']),
        ]);
        assert.strictEqual(r.instituicao, 'Universidade X');
    });

    test('sem os rotulos devolve os dois vazios, sem lancar', () => {
        assert.deepStrictEqual(P.lerProponente([linha([40, 'OUTRA'], [160, 'coisa'])]), { instituicao: '', formacao: '' });
        assert.deepStrictEqual(P.lerProponente([]), { instituicao: '', formacao: '' });
        assert.deepStrictEqual(P.lerProponente(null), { instituicao: '', formacao: '' });
    });
});

// --- Planilha de julgamento --------------------------------------------------
// A posicao das colunas muda conforme o comite e conforme o que o usuario habilita
// na propria pagina, entao nada pode ser fixo. Quando a Plataforma mudar os
// rotulos, e esta funcao que se ajusta.
describe('colunasDaPlanilha', () => {
    const CABECALHO = ['', 'Nº do Processo', 'Proponente', 'UF', 'Instituição',
                       'Chamada', 'Parecer Ad Hoc', 'Parecer Técnico', 'Ações'];

    test('mapeia cada campo pela sua coluna', () => {
        assert.deepStrictEqual(P.colunasDaPlanilha(CABECALHO), {
            processo: 1, proponente: 2, uf: 3, instituicao: 4,
            chamada: 5, parecerAdHoc: 6, parecerTecnico: 7, acoes: 8,
        });
    });

    test('acompanha a coluna quando a ordem muda', () => {
        const r = P.colunasDaPlanilha(['Ações', 'Instituição', 'Nº do Processo', 'Proponente']);
        assert.strictEqual(r.acoes, 0);
        assert.strictEqual(r.instituicao, 1);
        assert.strictEqual(r.processo, 2);
        assert.strictEqual(r.proponente, 3);
    });

    // Os dois comecam com "parecer": se o tecnico fosse testado primeiro, roubaria a
    // coluna do ad hoc e os pareceres iriam para o campo errado.
    test('parecer tecnico nao rouba a coluna do parecer ad hoc', () => {
        const r = P.colunasDaPlanilha(['Parecer Ad Hoc', 'Parecer Técnico']);
        assert.strictEqual(r.parecerAdHoc, 0);
        assert.strictEqual(r.parecerTecnico, 1);
    });

    test('aceita as grafias de parecer ad hoc, com e sem hifen', () => {
        assert.strictEqual(P.colunasDaPlanilha(['Parecer AdHoc']).parecerAdHoc, 0);
        assert.strictEqual(P.colunasDaPlanilha(['Parecer Ad-Hoc']).parecerAdHoc, 0);
    });

    test('parecer tecnico e reconhecido com e sem acento', () => {
        assert.strictEqual(P.colunasDaPlanilha(['Parecer Técnico']).parecerTecnico, 0);
        assert.strictEqual(P.colunasDaPlanilha(['Parecer Tecnico']).parecerTecnico, 0);
    });

    // Existe cabecalho "UF do proponente": sem a exclusao, ele viraria a coluna do
    // nome do proponente.
    test('"UF do proponente" e coluna de UF, e nao de proponente', () => {
        const r = P.colunasDaPlanilha(['UF do proponente', 'Proponente']);
        assert.strictEqual(r.uf, 0);
        assert.strictEqual(r.proponente, 1);
    });

    test('chamada tambem atende por edital', () => {
        assert.strictEqual(P.colunasDaPlanilha(['Edital']).chamada, 0);
    });

    // Fallback historico: so os quatro campos que sempre existiram na mesma ordem.
    test('cabecalho irreconhecivel cai nas posicoes historicas', () => {
        const r = P.colunasDaPlanilha(['a', 'b', 'c', 'd', 'e']);
        assert.strictEqual(r.processo, 1);
        assert.strictEqual(r.proponente, 2);
        assert.strictEqual(r.uf, 3);
        assert.strictEqual(r.instituicao, 4);
        // os demais ficam ausentes, e quem le trata isso
        assert.strictEqual(r.chamada, -1);
        assert.strictEqual(r.parecerAdHoc, -1);
        assert.strictEqual(r.parecerTecnico, -1);
        assert.strictEqual(r.acoes, -1);
    });

    test('entrada vazia ou invalida ainda devolve os fallbacks', () => {
        assert.strictEqual(P.colunasDaPlanilha([]).processo, 1);
        assert.strictEqual(P.colunasDaPlanilha(null).instituicao, 4);
    });
});

// Um rotulo repetido no cabecalho tem de resolver para a coluna da esquerda. Sem
// isto a leitura iria para a coluna mais a direita, que costuma ser um resumo.
// A regra veio de lerChamadaDaTabela, que a tinha e agora usa esta funcao.
describe('colunasDaPlanilha com rotulo repetido', () => {
    test('a primeira ocorrencia vence', () => {
        const r = P.colunasDaPlanilha(['Chamada', 'Instituição', 'Chamada (resumo)']);
        assert.strictEqual(r.chamada, 0);
    });

    test('vale para todos os campos', () => {
        const r = P.colunasDaPlanilha(['Nº do Processo', 'Ações', 'Nº do Processo', 'Ações']);
        assert.strictEqual(r.processo, 0);
        assert.strictEqual(r.acoes, 1);
    });
});
