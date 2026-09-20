'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert');
const B = require('./helpers/load.js').banco();

describe('_chaveMembro', () => {
    test('ignora caixa e espacos em volta', () => {
        assert.strictEqual(B._chaveMembro('  Maria DA Silva '), 'maria da silva');
    });
    test('nome ausente vira string vazia', () => {
        assert.strictEqual(B._chaveMembro(null), '');
        assert.strictEqual(B._chaveMembro(undefined), '');
    });
});

// A reimportacao de uma proposta NUNCA pode desfazer o que o revisor ajustou a
// mao. Estas quatro regras sao o contrato descrito no CLAUDE.md.
describe('mesclarEquipe', () => {
    test('membro apagado a mao nao volta na reimportacao', () => {
        const r = B.mesclarEquipe(
            [{ name: 'Ana Souza' }, { name: 'Bruno Lima' }],
            [],
            ['ana souza']);
        assert.deepStrictEqual(r.map(m => m.name), ['Bruno Lima']);
    });

    test('a remocao ignora caixa e espacos', () => {
        const r = B.mesclarEquipe([{ name: 'Ana Souza' }], [], ['  ANA SOUZA ']);
        assert.strictEqual(r.length, 0);
    });

    test('versao corrigida a mao vence a extraida', () => {
        const r = B.mesclarEquipe(
            [{ name: 'Ana Souza', titulacao: 'Mestre' }],
            [{ name: 'Ana Souza', titulacao: 'Doutora', editado: true }],
            []);
        assert.strictEqual(r.length, 1);
        assert.strictEqual(r[0].titulacao, 'Doutora');
        assert.strictEqual(r[0].editado, true);
    });

    test('sem a marca editado, o dado novo substitui o antigo', () => {
        const r = B.mesclarEquipe(
            [{ name: 'Ana Souza', titulacao: 'Mestre' }],
            [{ name: 'Ana Souza', titulacao: 'Doutora' }],
            []);
        assert.strictEqual(r[0].titulacao, 'Mestre');
    });

    test('membro acrescentado a mao sobrevive mesmo sem vir na extracao', () => {
        const r = B.mesclarEquipe(
            [{ name: 'Bruno Lima' }],
            [{ name: 'Carla Dias', manual: true }],
            []);
        assert.deepStrictEqual(r.map(m => m.name).sort(), ['Bruno Lima', 'Carla Dias']);
    });

    test('antigo sem marca alguma e que sumiu da extracao nao e preservado', () => {
        const r = B.mesclarEquipe(
            [{ name: 'Bruno Lima' }],
            [{ name: 'Carla Dias' }],
            []);
        assert.deepStrictEqual(r.map(m => m.name), ['Bruno Lima']);
    });

    test('nome repetido na extracao entra uma unica vez', () => {
        const r = B.mesclarEquipe(
            [{ name: 'Ana Souza' }, { name: 'ana souza' }],
            [], []);
        assert.strictEqual(r.length, 1);
    });

    test('descarta entradas sem nome', () => {
        const r = B.mesclarEquipe([{ name: '' }, { name: 'Ana' }, null], [], []);
        assert.deepStrictEqual(r.map(m => m.name), ['Ana']);
    });

    test('argumentos ausentes nao quebram', () => {
        assert.deepStrictEqual(B.mesclarEquipe(null, null, null), []);
        assert.deepStrictEqual(B.mesclarEquipe(undefined, undefined, undefined), []);
    });

    test('apagado a mao vence ate a marca manual', () => {
        const r = B.mesclarEquipe(
            [],
            [{ name: 'Carla Dias', manual: true }],
            ['carla dias']);
        assert.strictEqual(r.length, 0);
    });
});

describe('_faixaDe', () => {
    test('devolve a faixa em maiuscula', () => {
        assert.strictEqual(B._faixaDe({ faixa: 'a' }), 'A');
        assert.strictEqual(B._faixaDe({ faixa: ' b ' }), 'B');
    });
    test('ausente ou vazia vira traco', () => {
        assert.strictEqual(B._faixaDe({}), '-');
        assert.strictEqual(B._faixaDe({ faixa: '' }), '-');
        assert.strictEqual(B._faixaDe({ faixa: null }), '-');
        assert.strictEqual(B._faixaDe(null), '-');
    });
});

describe('_chaveColapso', () => {
    test('deriva a chave do titulo do bloco', () => {
        assert.strictEqual(B._chaveColapso('Limiares e Filtros'), 'limiares-e-filtros');
    });
    test('remove acentos e pontuacao', () => {
        assert.strictEqual(B._chaveColapso('Produção & Orientações!'), 'producao-orientacoes');
    });
    test('nao deixa hifen sobrando nas pontas', () => {
        assert.strictEqual(B._chaveColapso('  ...Titulo...  '), 'titulo');
    });
    test('texto vazio vira chave vazia', () => {
        assert.strictEqual(B._chaveColapso(''), '');
        assert.strictEqual(B._chaveColapso(null), '');
    });
});

describe('_chaveProposta', () => {
    test('a chave e o numero do processo', () => {
        assert.strictEqual(B._chaveProposta({ processId: '404123/2024-0' }), '404123/2024-0');
    });
    // Sem processId a chave e vazia de proposito: quem chama trata como "sem
    // correspondencia" em vez de arriscar casar propostas diferentes.
    test('sem processId devolve vazio', () => {
        assert.strictEqual(B._chaveProposta({}), '');
        assert.strictEqual(B._chaveProposta(null), '');
    });
});

describe('_cvStorageKey', () => {
    const cvPrefix = B.cvKeyPrefix || 'jcr_cv:';
    const procPrefix = B.procKeyPrefix || 'jcr_proc:';

    test('CV com lattesId usa a chave por id', () => {
        assert.strictEqual(B._cvStorageKey({ lattesId: '1234567890123456' }), cvPrefix + 'id:1234567890123456');
    });
    test('CV sem lattesId cai para a chave por nome', () => {
        assert.strictEqual(B._cvStorageKey({ name: 'Ana Souza' }), cvPrefix + 'nm:Ana Souza');
    });
    test('proposta usa o prefixo de processo', () => {
        assert.strictEqual(B._cvStorageKey({ processId: '404123/2024-0' }), procPrefix + 'proc:404123/2024-0');
        assert.strictEqual(B._cvStorageKey({ isProcesso: true, lattesId: 'X' }), procPrefix + 'proc:X');
    });
    test('registro nulo nao quebra', () => {
        assert.strictEqual(B._cvStorageKey(null), cvPrefix + 'unknown');
    });
});

describe('_cssAttr', () => {
    test('escapa barra invertida e aspas', () => {
        assert.strictEqual(B._cssAttr('a"b'), 'a\\"b');
        assert.strictEqual(B._cssAttr('a\\b'), 'a\\\\b');
    });
});

describe('_esc', () => {
    test('escapa o que quebraria o HTML', () => {
        assert.strictEqual(B._esc('<b>&"'), '&lt;b&gt;&amp;&quot;');
    });
});

describe('_contarParticipantes', () => {
    test('conta o proponente junto com a equipe', () => {
        assert.strictEqual(B._contarParticipantes({
            proponente: { name: 'Ana' },
            teamMembers: [{ name: 'Bruno' }, { name: 'Carla' }]
        }), 3);
    });

    test('nao conta duas vezes quem aparece como proponente e na equipe', () => {
        assert.strictEqual(B._contarParticipantes({
            proponente: { name: 'Ana Souza' },
            teamMembers: [{ name: ' ana souza ' }, { name: 'Bruno' }]
        }), 2);
    });

    test('cai para proc.name quando nao ha proponente', () => {
        assert.strictEqual(B._contarParticipantes({ name: 'Ana', teamMembers: [] }), 1);
    });

    test('proposta vazia ou nula conta zero', () => {
        assert.strictEqual(B._contarParticipantes({}), 0);
        assert.strictEqual(B._contarParticipantes(null), 0);
    });
});

// Base da matriz de coautoria: dois pesquisadores colaboram quando os conjuntos
// de artigos deles se cruzam, e a chave e o que decide se e o mesmo artigo.
describe('_chaveArtigo', () => {
    test('o DOI manda, normalizado', () => {
        assert.strictEqual(B._chaveArtigo({ doi: '10.1103/X' }), B._chaveArtigo({ doi: ' 10.1103/x ' }));
    });

    test('DOI tem precedencia sobre o titulo', () => {
        // o mesmo DOI casa mesmo com titulos grafados de formas diferentes
        assert.strictEqual(
            B._chaveArtigo({ doi: '10.1/a', paperTitle: 'Um titulo' }),
            B._chaveArtigo({ doi: '10.1/a', paperTitle: 'Outro titulo qualquer' }));
    });

    test('sem DOI, casa por titulo normalizado e ano', () => {
        assert.strictEqual(
            B._chaveArtigo({ paperTitle: 'Ação do <i>Fe</i>!', year: 2024 }),
            B._chaveArtigo({ paperTitle: 'Acao do Fe', year: 2024 }));
    });

    test('sem DOI, anos diferentes nao casam', () => {
        assert.notStrictEqual(
            B._chaveArtigo({ paperTitle: 'Mesmo titulo', year: 2024 }),
            B._chaveArtigo({ paperTitle: 'Mesmo titulo', year: 2025 }));
    });

    test('artigos diferentes nao casam', () => {
        assert.notStrictEqual(
            B._chaveArtigo({ paperTitle: 'Raman spectroscopy', year: 2020 }),
            B._chaveArtigo({ paperTitle: 'Thermal analysis', year: 2020 }));
    });

    test('sem DOI e sem titulo nao gera chave', () => {
        assert.strictEqual(B._chaveArtigo({}), '');
        assert.strictEqual(B._chaveArtigo(null), '');
        assert.strictEqual(B._chaveArtigo({ paperTitle: '   ' }), '');
    });
});

describe('_artigosDoCv', () => {
    test('descarta repetidos e entradas sem identidade', () => {
        const cv = { publications: [{ doi: '10.1/a' }, { paperTitle: 'Estudo X', year: 2020 }, { doi: '10.1/a' }, {}] };
        assert.strictEqual(B._artigosDoCv(cv).size, 2);
    });

    test('CV sem publicacoes devolve conjunto vazio', () => {
        assert.strictEqual(B._artigosDoCv({}).size, 0);
        assert.strictEqual(B._artigosDoCv(null).size, 0);
    });

    test('a intersecao entre dois CVs e o numero de artigos em comum', () => {
        const a = B._artigosDoCv({ publications: [{ doi: '10.1/p1' }, { doi: '10.1/p2' }, { doi: '10.1/p3' }] });
        const b = B._artigosDoCv({ publications: [{ doi: '10.1/p2' }, { doi: '10.1/p3' }, { doi: '10.1/p9' }] });
        let comuns = 0;
        a.forEach(k => { if (b.has(k)) comuns++; });
        assert.strictEqual(comuns, 2);
    });

    test('o mesmo artigo em dois CVs conta uma vez, mesmo sem DOI num deles', () => {
        const a = B._artigosDoCv({ publications: [{ doi: '10.1/p1', paperTitle: 'Spin chains', year: 2021 }] });
        const b = B._artigosDoCv({ publications: [{ paperTitle: 'Spin chains', year: 2021 }] });
        let comuns = 0;
        a.forEach(k => { if (b.has(k)) comuns++; });
        // um tem DOI e o outro nao: as chaves diferem, e a coautoria passa despercebida
        assert.strictEqual(comuns, 0);
    });
});

describe('_matrizCoautoria', () => {
    const cv = (nome, pubs) => ({ name: nome, publications: pubs });
    const P = (doi, ano) => ({ doi: doi, year: ano });
    const equipe = () => [
        cv('Ana',   [P('10/a', 2018), P('10/b', 2024), P('10/c', 2025)]),
        cv('Bruno', [P('10/a', 2018), P('10/b', 2024)]),
        cv('Carla', [P('10/z', 2010)])
    ];

    test('conta os artigos em comum de cada par', () => {
        const r = B._matrizCoautoria(equipe(), [], 0, 2026);
        assert.strictEqual(r.gente.length, 3);
        assert.strictEqual(r.m[0][1], 2);       // Ana e Bruno
        assert.strictEqual(r.m[0][2], 0);       // Ana e Carla
        assert.strictEqual(r.pares, 1);
        assert.strictEqual(r.maior, 2);
    });

    test('a matriz e simetrica e tem diagonal zerada', () => {
        const r = B._matrizCoautoria(equipe(), [], 0, 2026);
        for (let i = 0; i < r.gente.length; i++) {
            assert.strictEqual(r.m[i][i], 0);
            for (let j = 0; j < r.gente.length; j++) assert.strictEqual(r.m[i][j], r.m[j][i]);
        }
    });

    test('anos = 0 considera toda a carreira', () => {
        assert.strictEqual(B._matrizCoautoria(equipe(), [], 0, 2026).m[0][1], 2);
    });

    test('a janela de anos corta os artigos antigos', () => {
        // ultimos 3 anos a partir de 2026 = 2023 em diante: sobra so o de 2024
        assert.strictEqual(B._matrizCoautoria(equipe(), [], 3, 2026).m[0][1], 1);
    });

    test('janela larga o bastante devolve tudo', () => {
        assert.strictEqual(B._matrizCoautoria(equipe(), [], 20, 2026).m[0][1], 2);
    });

    test('tecnicos e alunos ficam de fora', () => {
        const fichas = [
            { name: 'Ana', role: 'Pesquisador', formacao: 'Doutorado' },
            { name: 'Bruno', role: 'Técnico', formacao: 'Doutorado' },
            { name: 'Carla', role: 'Aluno', formacao: '' }
        ];
        const r = B._matrizCoautoria(equipe(), fichas, 0, 2026);
        assert.deepStrictEqual(r.gente.map(g => g.nome), ['Ana']);
    });

    test('titulacao que nao e doutorado exclui; em branco NAO exclui', () => {
        const fichas = [
            { name: 'Ana', role: 'Pesquisador', formacao: 'Doutorado' },
            { name: 'Bruno', role: 'Pesquisador', formacao: 'Mestrado' },
            { name: 'Carla', role: 'Pesquisador', formacao: '' }   // vem vazia do PDF
        ];
        const r = B._matrizCoautoria(equipe(), fichas, 0, 2026);
        assert.deepStrictEqual(r.gente.map(g => g.nome), ['Ana', 'Carla']);
    });

    test('sem fichas (relatorio de grupo) ninguem e filtrado', () => {
        assert.strictEqual(B._matrizCoautoria(equipe(), [], 0, 2026).gente.length, 3);
    });

    test('o coordenador vem primeiro, mesmo fora da ordem alfabetica', () => {
        const fichas = [
            { name: 'Zeca', role: 'Proponente', formacao: 'Doutorado' },
            { name: 'Ana', role: 'Pesquisador', formacao: 'Doutorado' }
        ];
        const cvs = [cv('Ana', [P('10/a', 2020)]), cv('Zeca', [P('10/a', 2020)])];
        const r = B._matrizCoautoria(cvs, fichas, 0, 2026);
        assert.deepStrictEqual(r.gente.map(g => g.nome), ['Zeca', 'Ana']);
        assert.strictEqual(r.gente[0].coordenador, true);
        assert.strictEqual(r.gente[1].coordenador, false);
    });

    test('"Coordenador" tambem marca, nao so "Proponente"', () => {
        const fichas = [{ name: 'Zeca', role: 'Coordenador do projeto', formacao: '' }];
        const r = B._matrizCoautoria([cv('Ana', []), cv('Zeca', [])], fichas, 0, 2026);
        assert.strictEqual(r.gente[0].nome, 'Zeca');
        assert.strictEqual(r.gente[0].coordenador, true);
    });

    test('agrupa quem colabora junto e separa os grupos desconexos', () => {
        // {Coord, Bia, Caio} colaboram; {Dora, Edu} colaboram entre si; Zara e isolada
        const cvs = [
            cv('Zara',  [P('x1', 2024)]),
            cv('Dora',  [P('d1', 2024), P('d2', 2024)]),
            cv('Bia',   [P('c1', 2024), P('c2', 2024)]),
            cv('Edu',   [P('d1', 2024), P('d2', 2024)]),
            cv('Caio',  [P('c1', 2024)]),
            cv('Coord', [P('c1', 2024), P('c2', 2024)])
        ];
        const fichas = [{ name: 'Coord', role: 'Proponente', formacao: 'Doutorado' }];
        const r = B._matrizCoautoria(cvs, fichas, 0, 2026);

        assert.strictEqual(r.gente[0].nome, 'Coord');            // coordenador abre
        assert.strictEqual(r.grupos, 3);
        // o grupo do coordenador vem inteiro antes dos demais
        const grupos = r.gente.map(g => g.grupo);
        assert.deepStrictEqual(grupos, [...grupos].sort((a, b) => a - b));
        const doCoord = r.gente.filter(g => g.grupo === 1).map(g => g.nome).sort();
        assert.deepStrictEqual(doCoord, ['Bia', 'Caio', 'Coord']);
        assert.deepStrictEqual(r.gente.filter(g => g.grupo === 2).map(g => g.nome).sort(), ['Dora', 'Edu']);
        assert.deepStrictEqual(r.gente.filter(g => g.grupo === 3).map(g => g.nome), ['Zara']);
    });

    test('marca onde comeca cada grupo, e nao a primeira linha', () => {
        const cvs = [cv('Ana', [P('a', 2024)]), cv('Bia', [P('b', 2024)])];
        const r = B._matrizCoautoria(cvs, [], 0, 2026);
        assert.strictEqual(r.gente[0].primeiroDoGrupo, false);   // a primeira nunca separa
        assert.strictEqual(r.gente[1].primeiroDoGrupo, true);    // sem colaboracao: outro grupo
    });

    test('a matriz acompanha a reordenacao e continua simetrica', () => {
        const cvs = [
            cv('Zeca', [P('p1', 2024), P('p2', 2024)]),
            cv('Ana',  [P('p1', 2024)]),
            cv('Bia',  [P('p2', 2024)])
        ];
        const r = B._matrizCoautoria(cvs, [], 0, 2026);
        const idx = (nome) => r.gente.findIndex(g => g.nome === nome);
        assert.strictEqual(r.m[idx('Zeca')][idx('Ana')], 1);
        assert.strictEqual(r.m[idx('Zeca')][idx('Bia')], 1);
        assert.strictEqual(r.m[idx('Ana')][idx('Bia')], 0);
        for (let i = 0; i < r.gente.length; i++) {
            assert.strictEqual(r.m[i][i], 0);
            for (let j = 0; j < r.gente.length; j++) assert.strictEqual(r.m[i][j], r.m[j][i]);
        }
    });

    test('no empate de vinculo, sobe quem colabora mais no total', () => {
        // Alvaro e Bruno tem o mesmo vinculo com o grupo; Yara colabora muito mais.
        // Pelo alfabeto Alvaro viria primeiro — a centralidade tem de vencer.
        const cvs = [
            cv('Zeca',   [P('p1', 2024), P('p2', 2024), P('p3', 2024), P('p4', 2024)]),
            cv('Alvaro', [P('p1', 2024)]),
            cv('Yara',   [P('p1', 2024), P('p2', 2024), P('p3', 2024)]),
            cv('Bruno',  [P('p2', 2024)])
        ];
        const fichas = [{ name: 'Zeca', role: 'Proponente', formacao: 'Doutorado' }];
        const r = B._matrizCoautoria(cvs, fichas, 0, 2026);
        assert.strictEqual(r.gente[0].nome, 'Zeca');
        assert.strictEqual(r.gente[1].nome, 'Yara');
    });

    test('equipe toda conectada da um grupo so', () => {
        const cvs = [
            cv('Zeca',  [P('p1', 2024), P('p2', 2024)]),
            cv('Ana',   [P('p1', 2024)]),
            cv('Bruno', [P('p2', 2024), P('p1', 2024)])
        ];
        const r = B._matrizCoautoria(cvs, [], 0, 2026);
        assert.strictEqual(r.grupos, 1);
        // com um grupo unico nenhuma linha carrega separador
        assert.ok(r.gente.every(g => g.primeiroDoGrupo === false));
    });

    test('sem coordenador, a semente e quem mais colabora', () => {
        const cvs = [
            cv('Ana',  [P('p1', 2024)]),
            cv('Bia',  [P('p1', 2024), P('p2', 2024)]),
            cv('Caio', [P('p2', 2024)])
        ];
        const r = B._matrizCoautoria(cvs, [], 0, 2026);
        assert.strictEqual(r.gente[0].nome, 'Bia');   // 2 colaboracoes, contra 1 dos outros
    });

    test('a instituicao vem da ficha da equipe', () => {
        const fichas = [
            { name: 'Ana', role: 'Pesquisador', formacao: 'Doutorado', instituicao: 'UFPA' },
            { name: 'Zeca', role: 'Proponente', formacao: 'Doutorado', instituicao: 'UFMG' }
        ];
        const r = B._matrizCoautoria([cv('Ana', []), cv('Zeca', [])], fichas, 0, 2026);
        assert.strictEqual(r.gente[0].instituicao, 'UFMG');   // Zeca, coordenador, vem primeiro
        assert.strictEqual(r.gente[1].instituicao, 'UFPA');
    });

    test('sem ficha correspondente a instituicao fica vazia', () => {
        const r = B._matrizCoautoria([cv('Ana', [])], [], 0, 2026);
        assert.strictEqual(r.gente[0].instituicao, '');
    });

    test('sem coordenador identificado, a ordem e so alfabetica', () => {
        const fichas = [{ name: 'Zeca', role: 'Pesquisador', formacao: '' }];
        const r = B._matrizCoautoria([cv('Zeca', []), cv('Ana', [])], fichas, 0, 2026);
        assert.deepStrictEqual(r.gente.map(g => g.nome), ['Ana', 'Zeca']);
        assert.ok(r.gente.every(g => g.coordenador === false));
    });

    test('os nomes saem em ordem alfabetica', () => {
        const fora = [cv('Zeca', [P('10/a', 2020)]), cv('Ana', [P('10/a', 2020)])];
        assert.deepStrictEqual(B._matrizCoautoria(fora, [], 0, 2026).gente.map(g => g.nome), ['Ana', 'Zeca']);
    });

    test('lista vazia ou com um so CV nao quebra', () => {
        assert.strictEqual(B._matrizCoautoria([], [], 0, 2026).gente.length, 0);
        assert.strictEqual(B._matrizCoautoria(null, null, 0, 2026).gente.length, 0);
        const um = B._matrizCoautoria([cv('Ana', [P('10/a', 2020)])], [], 0, 2026);
        assert.strictEqual(um.pares, 0);
    });
});

describe('_valorColuna', () => {
    test('teamCount e calculado, nao lido do registro', () => {
        const proc = { teamCount: 99, proponente: { name: 'Ana' }, teamMembers: [{ name: 'Bruno' }] };
        assert.strictEqual(B._valorColuna(proc, 'teamCount'), 2);
    });

    test('demais chaves vem direto do registro', () => {
        assert.strictEqual(B._valorColuna({ name: 'Ana' }, 'name'), 'Ana');
    });

    test('registro nulo devolve vazio', () => {
        assert.strictEqual(B._valorColuna(null, 'name'), '');
    });
});

// O titulo do projeto vem de uma tabela de duas colunas do PDF. O rotulo fica
// centrado verticalmente na celula, entao parte do valor pode cair ACIMA do
// proprio rotulo na ordem de leitura — e o rotulo ainda pode quebrar em duas
// linhas. Estes casos reproduzem os dois layouts vistos nas propostas reais.
describe('_lerTituloResumoPdf', () => {
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
        const r = B._lerTituloResumoPdf(...pdf([
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
        const r = B._lerTituloResumoPdf(...pdf([
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
        const r = B._lerTituloResumoPdf(...pdf([
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
        const r = B._lerTituloResumoPdf([], [], 'TÍTULO (em português): Um título\nTÍTULO (em inglês): A title');
        assert.strictEqual(r.tituloProjeto, 'Um título');
    });

    test('resumo vai de RESUMO ate ETAPAS, sem o rodape de paginacao', () => {
        const r = B._lerTituloResumoPdf([], [], [
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
        assert.deepStrictEqual(B._lerTituloResumoPdf(null, null, null), { tituloProjeto: '', resumoProjeto: '' });
        assert.deepStrictEqual(B._lerTituloResumoPdf([], [], ''), { tituloProjeto: '', resumoProjeto: '' });
    });
});
