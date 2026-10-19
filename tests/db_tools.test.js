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

describe('normalizeName', () => {
    test('remove acentos, pontuacao e caixa', () => {
        assert.strictEqual(B.normalizeName('José da Silva-Júnior'), 'jose da silva junior');
    });

    test('colapsa espacos e apara as pontas', () => {
        assert.strictEqual(B.normalizeName('  ANA   MARIA  '), 'ana maria');
    });

    test('a pontuacao vira espaco, nao some', () => {
        // "SILVA,J." nao pode virar "silvaj": juntaria sobrenome e inicial
        assert.strictEqual(B.normalizeName('SILVA,J.'), 'silva j');
    });

    test('formas Unicode diferentes do mesmo nome dao o mesmo resultado', () => {
        const composto = 'Ayala';                                   // NFC
        const decomposto = 'Ayala'.normalize('NFD');                // NFD
        assert.strictEqual(B.normalizeName(composto), B.normalizeName(decomposto));
    });

    test('entrada vazia devolve string vazia', () => {
        assert.strictEqual(B.normalizeName(''), '');
        assert.strictEqual(B.normalizeName(null), '');
        assert.strictEqual(B.normalizeName(undefined), '');
    });
});

// Recorte de "doutor da equipe", usado pela matriz de coautoria e pela acao que abre
// os CVs que faltam no banco. O contrato importante e o ultimo teste: ficha incompleta
// nao pode excluir ninguem, porque a titulacao vem do PDF e falha com frequencia.
describe('_ehDoutorDaEquipe', () => {
    test('tecnico e aluno ficam de fora', () => {
        assert.strictEqual(B._ehDoutorDaEquipe({ role: 'Técnico', formacao: 'Doutorado' }), false);
        assert.strictEqual(B._ehDoutorDaEquipe({ role: 'Aluno de Iniciação Científica', formacao: '' }), false);
        assert.strictEqual(B._ehDoutorDaEquipe({ role: 'Estudante', formacao: 'Mestrado' }), false);
        assert.strictEqual(B._ehDoutorDaEquipe({ role: 'Tecnico de laboratório', formacao: '' }), false);
    });

    test('titulacao abaixo de doutorado fica de fora', () => {
        assert.strictEqual(B._ehDoutorDaEquipe({ role: 'Pesquisador', formacao: 'Mestrado' }), false);
        assert.strictEqual(B._ehDoutorDaEquipe({ role: 'Pesquisador', formacao: 'Graduação' }), false);
    });

    test('doutor entra, inclusive o coordenador e o pos-doutorando', () => {
        assert.strictEqual(B._ehDoutorDaEquipe({ role: 'Proponente / Coordenador', formacao: 'Doutorado' }), true);
        assert.strictEqual(B._ehDoutorDaEquipe({ role: 'Pesquisador', formacao: 'Doutorado' }), true);
        assert.strictEqual(B._ehDoutorDaEquipe({ role: 'Pós-Doutorando', formacao: 'Pós-Doutorado' }), true);
    });

    test('ficha incompleta nao exclui: o visitante sem titulacao continua entrando', () => {
        assert.strictEqual(B._ehDoutorDaEquipe({ role: 'Pesquisador Estrangeiro', formacao: '' }), true);
        assert.strictEqual(B._ehDoutorDaEquipe({ role: '', formacao: '' }), true);
        assert.strictEqual(B._ehDoutorDaEquipe({}), true);
        assert.strictEqual(B._ehDoutorDaEquipe(null), true);
    });
});

// normalizeName e a base de todo casamento de nomes entre a proposta e o banco de
// CVs. Passou a ter um segundo chamador (picc_content, que antes mantinha uma copia
// literal), entao a regra precisa ficar fixada aqui.

// O Quadro Geral e a conta que ja produziu dois erros silenciosos: o coordenador
// ficando de fora do total, e "Pesquisador Estrangeiro" somando junto com
// "Pesquisador". Saiu de dentro de renderCVReport, onde estava misturada ao HTML.
describe('_ordemCategoria', () => {
    test('a ordem das colunas e fixa, com Aluno sempre por ultimo', () => {
        const cats = ['Aluno', 'Técnico', 'Pesquisador Estrangeiro', 'Colaborador', 'Pesquisador', 'Proponente / Coordenador'];
        const ordenadas = cats.slice().sort((a, b) => B._ordemCategoria(a) - B._ordemCategoria(b));
        assert.deepStrictEqual(ordenadas, [
            'Proponente / Coordenador', 'Pesquisador', 'Colaborador',
            'Pesquisador Estrangeiro', 'Técnico', 'Aluno',
        ]);
    });

    // "Pesquisador Estrangeiro" casa com "pesquisador" e com "estrangeir"; se o
    // segundo nao for testado antes, ele cai na coluna de Pesquisador.
    test('estrangeiro tem coluna propria, e nao a de pesquisador', () => {
        assert.notStrictEqual(B._ordemCategoria('Pesquisador Estrangeiro'), B._ordemCategoria('Pesquisador'));
    });

    test('categoria desconhecida fica antes de Aluno', () => {
        assert.ok(B._ordemCategoria('Consultor') < B._ordemCategoria('Aluno'));
    });

    test('ignora acento e caixa', () => {
        assert.strictEqual(B._ordemCategoria('TÉCNICO'), B._ordemCategoria('tecnico'));
    });
});

describe('_quadroDaEquipe', () => {
    const m = (nome, role, inst, srcIdx) => ({ name: nome, role, instituicao: inst, srcIdx: srcIdx === undefined ? 0 : srcIdx });
    const coord = (nome, inst) => m(nome, 'Proponente / Coordenador', inst, -1);

    test('sem o quadro do PDF, conta pelas categorias dos membros', () => {
        const r = B._quadroDaEquipe([], [coord('Ana', 'UFC'), m('Bruno', 'Pesquisador', 'UFC'), m('Carla', 'Aluno', 'UFC')], 'Ana');
        assert.strictEqual(r.origem, 'calculado a partir da equipe extraída');
        assert.deepStrictEqual(r.colunas.map(c => c.categoria), ['Proponente / Coordenador', 'Pesquisador', 'Aluno']);
        assert.strictEqual(r.total, 3);
        assert.strictEqual(r.divergente, false);
    });

    // O quadro do PDF conta so a equipe; sem esta coluna a soma fica uma pessoa
    // abaixo do total e o aviso de divergencia disparava a toa.
    test('acrescenta a coluna do coordenador quando o quadro do PDF nao o inclui', () => {
        const r = B._quadroDaEquipe(
            [{ categoria: 'Pesquisador', quantidade: 2 }],
            [coord('Ana', 'UFC'), m('Bruno', 'Pesquisador', 'UFC'), m('Carla', 'Pesquisador', 'UFC')],
            'Ana');
        assert.deepStrictEqual(r.colunas.map(c => c.categoria), ['Coordenador', 'Pesquisador']);
        assert.strictEqual(r.total, 3);
        assert.strictEqual(r.divergente, false);
    });

    test('nao duplica o coordenador quando o quadro ja tem a categoria dele', () => {
        const r = B._quadroDaEquipe(
            [{ categoria: 'Proponente', quantidade: 1 }, { categoria: 'Pesquisador', quantidade: 1 }],
            [coord('Ana', 'UFC'), m('Bruno', 'Pesquisador', 'UFC')],
            'Ana');
        assert.strictEqual(r.colunas.filter(c => B._ordemCategoria(c.categoria) === 0).length, 1);
        assert.strictEqual(r.total, 2);
    });

    test('marca divergencia quando a soma nao bate com a equipe', () => {
        const r = B._quadroDaEquipe(
            [{ categoria: 'Pesquisador', quantidade: 9 }],
            [coord('Ana', 'UFC'), m('Bruno', 'Pesquisador', 'UFC')],
            'Ana');
        assert.strictEqual(r.divergente, true);
    });

    test('a instituicao do coordenador e a sede e vem no topo', () => {
        const r = B._quadroDaEquipe([],
            [coord('Ana', 'UFPA'), m('Bruno', 'Pesquisador', 'USP'), m('Carla', 'Pesquisador', 'USP')],
            'Ana');
        assert.strictEqual(r.executora, 'UFPA');
        assert.strictEqual(r.instituicoes[0].nome, 'UFPA');
        assert.strictEqual(r.instituicoes[0].ehExecutora, true);
        // USP tem mais gente, mas a sede vem antes
        assert.strictEqual(r.instituicoes[1].nome, 'USP');
        assert.strictEqual(r.instituicoes[1].total, 2);
    });

    test('fora a sede, ordena por numero de membros e depois pelo nome', () => {
        const r = B._quadroDaEquipe([],
            [m('A', 'Pesquisador', 'Zeta'), m('B', 'Pesquisador', 'Alfa'), m('C', 'Pesquisador', 'Alfa')],
            '');
        assert.deepStrictEqual(r.instituicoes.map(i => i.nome), ['Alfa', 'Zeta']);
    });

    test('cada membro cai na coluna da sua categoria', () => {
        const r = B._quadroDaEquipe([],
            [coord('Ana', 'UFC'), m('Bruno', 'Pesquisador', 'UFC'), m('Carla', 'Aluno', 'UFC')],
            'Ana');
        const iCoord = r.colunas.findIndex(c => B._ordemCategoria(c.categoria) === 0);
        const iAluno = r.colunas.findIndex(c => B._ordemCategoria(c.categoria) === 6);
        assert.strictEqual(r.instituicoes[0].cols[iCoord], 1);
        assert.strictEqual(r.instituicoes[0].cols[iAluno], 1);
        assert.strictEqual(r.instituicoes[0].total, 3);
    });

    // O estrangeiro tem coluna propria: se caisse na de Pesquisador, a distribuicao
    // mostraria dois numa coluna e zero na outra.
    test('estrangeiro conta na coluna dele, nao na de pesquisador', () => {
        const r = B._quadroDaEquipe(
            [{ categoria: 'Pesquisador', quantidade: 1 }, { categoria: 'Pesquisador Estrangeiro', quantidade: 1 }],
            [m('Bruno', 'Pesquisador', 'UFC'), m('Hans', 'Pesquisador Estrangeiro', 'UFC')],
            '');
        const iPesq = r.colunas.findIndex(c => c.categoria === 'Pesquisador');
        const iEstr = r.colunas.findIndex(c => c.categoria === 'Pesquisador Estrangeiro');
        assert.strictEqual(r.instituicoes[0].cols[iPesq], 1);
        assert.strictEqual(r.instituicoes[0].cols[iEstr], 1);
    });

    test('membro sem instituicao entra como "-" e nao some da conta', () => {
        const r = B._quadroDaEquipe([], [m('Ana', 'Pesquisador', ''), m('Bruno', 'Pesquisador', 'UFC')], '');
        assert.deepStrictEqual(r.instituicoes.map(i => i.nome).sort(), ['-', 'UFC']);
        assert.strictEqual(r.instituicoes.reduce((s, i) => s + i.total, 0), 2);
    });

    test('equipe vazia nao quebra', () => {
        const r = B._quadroDaEquipe([], [], '');
        assert.deepStrictEqual(r.colunas, []);
        assert.deepStrictEqual(r.instituicoes, []);
        assert.strictEqual(r.divergente, false);
        assert.deepStrictEqual(B._quadroDaEquipe(null, null, null).colunas, []);
    });
});

// Este filtro define TODOS os numeros do relatorio: um erro aqui nao da erro, da
// um relatorio com o total errado. Saiu de dentro de renderCVReport.
describe('_filtrarPublicacoes', () => {
    const tudoLigado = {
        highJcr: 7, lowJcr: 1.5,
        showHighJcr: true, showMidJcr: true, showLowJcr: true, showNoJcr: true,
        showAuthorFirst: true, showAuthorLast: true, showAuthorOthers: true, showAuthorGc: true,
        targetAuthorRank: 1,
    };
    const est = (extra) => Object.assign({}, tudoLigado, extra || {});
    // publicacao do banco (jif) com 3 autores
    const pub = (jif, rank, extra) => Object.assign({ jif, authorRank: rank, authorCount: 3, hasEtAl: false }, extra || {});

    test('com todos os filtros ligados, nada e descartado', () => {
        const lista = [pub(9, 1), pub(3, 2), pub(0.5, 3), pub(0, 2)];
        assert.strictEqual(B._filtrarPublicacoes(lista, est()).length, 4);
    });

    test('cada faixa de JCR pode ser desligada sozinha', () => {
        const lista = [pub(9, 2), pub(3, 2), pub(0.5, 2), pub(0, 2)];
        assert.strictEqual(B._filtrarPublicacoes(lista, est({ showHighJcr: false })).length, 3);
        assert.strictEqual(B._filtrarPublicacoes(lista, est({ showMidJcr: false })).length, 3);
        assert.strictEqual(B._filtrarPublicacoes(lista, est({ showLowJcr: false })).length, 3);
        assert.strictEqual(B._filtrarPublicacoes(lista, est({ showNoJcr: false })).length, 3);
    });

    test('primeiro autor sai pela marca do leitor quando ela existe', () => {
        const lista = [pub(3, 2, { isFirstAuthor: true }), pub(3, 1, { isFirstAuthor: false })];
        const r = B._filtrarPublicacoes(lista, est({ showAuthorFirst: false }));
        // fica so a que a marca diz NAO ser primeiro autor, mesmo com rank 1
        assert.strictEqual(r.length, 1);
        assert.strictEqual(r[0].authorRank, 1);
    });

    // Com rank alvo diferente de 1, a posicao e comparada direto: e assim que o
    // relatorio mostra "artigos em que fulano e o 2o autor".
    test('rank alvo diferente de 1 compara a posicao, ignorando a marca', () => {
        const lista = [pub(3, 2, { isFirstAuthor: false }), pub(3, 3)];
        const r = B._filtrarPublicacoes(lista, est({ targetAuthorRank: 2, showAuthorFirst: false }));
        assert.deepStrictEqual(r.map(p => p.authorRank), [3]);
    });

    test('ultimo autor exige mais de um autor', () => {
        const solo = { jif: 3, authorRank: 1, authorCount: 1, hasEtAl: false };
        // com um autor so nao e "ultimo": some pelo filtro de primeiro, nao pelo de ultimo
        assert.strictEqual(B._filtrarPublicacoes([solo], est({ showAuthorLast: false })).length, 1);
    });

    // Em grande colaboracao o "et al" esconde quem fecha a lista, entao ninguem
    // conta como ultimo autor.
    test('grande colaboracao nao conta como ultimo autor', () => {
        const gc = { jif: 9, authorRank: 3, authorCount: 3, hasEtAl: true };
        assert.strictEqual(B._filtrarPublicacoes([gc], est({ showAuthorLast: false })).length, 1);
        assert.strictEqual(B._filtrarPublicacoes([gc], est({ showAuthorGc: false })).length, 0);
    });

    test('"outros" e o complemento: nem primeiro, nem ultimo, nem GC', () => {
        const meio = pub(3, 2);                      // 2o de 3 autores
        assert.strictEqual(B._filtrarPublicacoes([meio], est({ showAuthorOthers: false })).length, 0);
        assert.strictEqual(B._filtrarPublicacoes([meio], est()).length, 1);
    });

    test('le tambem o formato em memoria (impactFactor) quando nao ha jif', () => {
        const emMemoria = { impactFactor: '9.0', authorRank: 1, authorCount: 2, hasEtAl: false };
        assert.strictEqual(B._filtrarPublicacoes([emMemoria], est({ showHighJcr: false })).length, 0);
        assert.strictEqual(B._filtrarPublicacoes([emMemoria], est()).length, 1);
    });

    test('entrada invalida nao quebra', () => {
        assert.deepStrictEqual(B._filtrarPublicacoes(null, est()), []);
        assert.deepStrictEqual(B._filtrarPublicacoes([], est()), []);
        assert.deepStrictEqual(B._filtrarPublicacoes([null], est()), []);
    });
});

// Um pesquisador pode ser membro de uma proposta do piccTools e ter o CV salvo pelo
// usuario. O registro fica numa chave so (jcr_picc_cv:) e aparece no banco geral
// SOMENTE com inGeneralDb === true, a marca de "o usuario mandou salvar".
//
// Ter o CV analisado nao basta: abrir no Lattes o CV de um membro de equipe analisa o
// curriculo para alimentar a proposta, e isso enchia a lista pessoal de gente que o
// usuario nunca pediu para colecionar.
describe('CV do piccTools visivel no banco geral', () => {
    // Stub minimo de chrome.storage.local sobre um objeto em memoria.
    function comStorage(dados) {
        const store = Object.assign({}, dados);
        globalThis.chrome = {
            runtime: { id: 'teste', lastError: null },
            storage: {
                local: {
                    get: (_chaves, cb) => cb(Object.assign({}, store)),
                    set: (obj, cb) => { Object.assign(store, obj); cb(); },
                    remove: (chaves, cb) => {
                        (Array.isArray(chaves) ? chaves : [chaves]).forEach(k => { delete store[k]; });
                        cb();
                    }
                }
            }
        };
        return store;
    }

    // Salvo de proposito pelo usuario: leva a marca que saveCurrentCV poe.
    const salvoDeProposito = (nome, id) => ({
        name: nome, lattesId: id, hasFullCv: true, publications: [{ year: 2024 }], inGeneralDb: true
    });
    // Analisado so para alimentar a proposta: CV completo, mas sem a marca.
    const soAnalisado = (nome, id) => ({
        name: nome, lattesId: id, hasFullCv: true, publications: [{ year: 2024 }]
    });
    const esqueleto = (nome, id) => ({
        name: nome, lattesId: id, hasFullCv: false, totalPapers: 0, papersWithJcr: 0
    });

    // O caso que motivou a regra: membro de equipe com o CV analisado para a proposta.
    test('CV analisado para a proposta NAO entra na lista pessoal', async () => {
        comStorage({ 'jcr_picc_cv:id:1111111111111111': soAnalisado('Maria', '1111111111111111') });
        assert.deepStrictEqual(await B.getDB(false), []);
    });

    test('CV salvo de proposito entra na lista pessoal', async () => {
        comStorage({ 'jcr_picc_cv:id:1111111111111111': salvoDeProposito('Maria', '1111111111111111') });
        const db = await B.getDB(false);
        assert.strictEqual(db.length, 1);
        assert.strictEqual(db[0].name, 'Maria');
    });

    test('esqueleto criado pela importacao da proposta nao polui o banco geral', async () => {
        comStorage({ 'jcr_picc_cv:id:2222222222222222': esqueleto('Joao', '2222222222222222') });
        assert.deepStrictEqual(await B.getDB(false), []);
    });

    test('inGeneralDb:false esconde o registro do banco geral', async () => {
        const cv = salvoDeProposito('Ana', '3333333333333333');
        cv.inGeneralDb = false;
        comStorage({ 'jcr_picc_cv:id:3333333333333333': cv });
        assert.deepStrictEqual(await B.getDB(false), []);
    });

    test('inGeneralDb:true mostra ate um registro sem dados analisados', async () => {
        const cv = esqueleto('Paulo', '4444444444444444');
        cv.inGeneralDb = true;
        comStorage({ 'jcr_picc_cv:id:4444444444444444': cv });
        assert.strictEqual((await B.getDB(false)).length, 1);
    });

    test('nao duplica quando o mesmo CV esta nos dois bancos', async () => {
        comStorage({
            'jcr_cv:id:5555555555555555': salvoDeProposito('Rita', '5555555555555555'),
            'jcr_picc_cv:id:5555555555555555': salvoDeProposito('Rita', '5555555555555555')
        });
        assert.strictEqual((await B.getDB(false)).length, 1);
    });

    test('a proposta continua vendo so o seu banco', async () => {
        comStorage({
            'jcr_picc_cv:id:6666666666666666': salvoDeProposito('Luis', '6666666666666666'),
            'jcr_proc:proc:404040': { name: 'Projeto', isProcesso: true, processId: '404040' }
        });
        const propostas = await B.getDB(true);
        assert.strictEqual(propostas.length, 1);
        assert.strictEqual(propostas[0].processId, '404040');
    });

    test('excluir do geral nao apaga o CV de que a proposta depende', async () => {
        const chave = 'jcr_picc_cv:id:7777777777777777';
        const store = comStorage({ [chave]: salvoDeProposito('Clara', '7777777777777777') });
        const db = await B.getDB(false);
        await B.removeCVs(db);
        assert.ok(store[chave], 'o registro do picc tem de continuar no storage');
        assert.strictEqual(store[chave].inGeneralDb, false);
        assert.deepStrictEqual(await B.getDB(false), []);
    });

    test('a marca da chave do picc nao vai para o storage nem para o backup', async () => {
        comStorage({ 'jcr_picc_cv:id:8888888888888888': salvoDeProposito('Ines', '8888888888888888') });
        const cv = (await B.getDB(false))[0];
        assert.strictEqual(cv._piccOnlyKey, 'jcr_picc_cv:id:8888888888888888');
        assert.ok(!Object.keys(cv).includes('_piccOnlyKey'));
        assert.ok(!JSON.stringify(cv).includes('_piccOnlyKey'));
    });
});

// Editar pelo banco geral um registro emprestado do piccTools nao pode criar uma
// segunda copia em jcr_cv:, que depois divergiria da que a proposta usa.
describe('gravacao de CV emprestado do piccTools', () => {
    test('saveCVs grava de volta na chave de origem', async () => {
        const chave = 'jcr_picc_cv:id:9999999999999999';
        const store = {
            [chave]: { name: 'Bruno', lattesId: '9999999999999999', hasFullCv: true, publications: [{ year: 2024 }], inGeneralDb: true }
        };
        globalThis.chrome = {
            runtime: { id: 'teste', lastError: null },
            storage: {
                local: {
                    get: (_c, cb) => cb(Object.assign({}, store)),
                    set: (obj, cb) => { Object.assign(store, obj); cb(); },
                    remove: (c, cb) => { (Array.isArray(c) ? c : [c]).forEach(k => { delete store[k]; }); cb(); }
                }
            }
        };
        const cv = (await B.getDB(false))[0];
        cv.customId = 'GRUPO-1';
        await B.saveCVs([cv]);
        assert.deepStrictEqual(Object.keys(store), [chave]);
        assert.strictEqual(store[chave].customId, 'GRUPO-1');
    });
});

// Tabela "Membros do Grupo": o periodo afeta artigos, faixas, JCR, orientacoes e
// patentes; indice H e citacoes WoS sao sempre da carreira inteira.
describe('_indicadoresMembro', () => {
    const cv = {
        name: 'Ana Souza',
        publications: [
            { year: 2024, jif: 8, wosCitations: 10 },   // alto
            { year: 2023, jif: 3, wosCitations: 5 },    // medio
            { year: 2022, jif: 1, wosCitations: 1 },    // baixo
            { year: 2015, jif: 0, wosCitations: 30 },   // sem JCR, fora de 5 anos
            { year: 2010, jif: 7, wosCitations: 2 }     // alto no limiar, fora de 5 anos
        ],
        supervisions: { concluded: {
            'Tese de doutorado': [2024, 2012],
            'Dissertação de mestrado': [2021, 2023, 2005]
        } },
        rawPatents: [{ year: 2022 }, { year: 2008 }],
        wosHIndex: 3,
        wosCitations: 48
    };

    test('carreira toda (anos = 0)', () => {
        const r = B._indicadoresMembro(cv, 0, 2025, 7, 1.5);
        assert.strictEqual(r.artigos, 5);
        assert.deepStrictEqual([r.high, r.mid, r.low, r.noJcr], [2, 1, 1, 1]);
        assert.strictEqual(r.somaJcr, 19);
        assert.strictEqual(r.mediaJcr, 19 / 4);
        assert.deepStrictEqual([r.doutorados, r.mestrados, r.patentes], [2, 3, 2]);
    });

    test('ultimos 5 anos: corte em anoAtual - 5, inclusive', () => {
        const r = B._indicadoresMembro(cv, 5, 2025, 7, 1.5);
        assert.strictEqual(r.artigos, 3);
        assert.deepStrictEqual([r.high, r.mid, r.low, r.noJcr], [1, 1, 1, 0]);
        assert.strictEqual(r.somaJcr, 12);
        assert.strictEqual(r.mediaJcr, 4);
        assert.deepStrictEqual([r.doutorados, r.mestrados, r.patentes], [1, 2, 1]);
    });

    test('indice H e citacoes WoS nao mudam com o periodo', () => {
        const r = B._indicadoresMembro(cv, 1, 2030, 7, 1.5);
        assert.strictEqual(r.artigos, 0);
        assert.strictEqual(r.hWos, 3);
        assert.strictEqual(r.citacoesWos, 48);
    });

    test('registro antigo sem wosHIndex recalcula das citacoes por artigo', () => {
        const antigo = { publications: cv.publications };
        const r = B._indicadoresMembro(antigo, 0, 2025, 7, 1.5);
        assert.strictEqual(r.hWos, 3);   // 30, 10, 5, 2, 1
        assert.strictEqual(r.citacoesWos, 48);
    });

    test('sem os anos das orientacoes, usa o total guardado so na carreira toda', () => {
        const semAnos = { totalPhdOrientations: 4, totalMscOrientations: 2, totalPatents: 1 };
        const toda = B._indicadoresMembro(semAnos, 0, 2025, 7, 1.5);
        assert.deepStrictEqual([toda.doutorados, toda.mestrados, toda.patentes], [4, 2, 1]);
        const periodo = B._indicadoresMembro(semAnos, 5, 2025, 7, 1.5);
        assert.deepStrictEqual([periodo.doutorados, periodo.mestrados, periodo.patentes], [0, 0, 0]);
    });

    test('item sem ano so entra na carreira toda; media sem JCR e zero', () => {
        const c = { publications: [{ jif: 0 }, { year: 'x', jif: 0 }] };
        assert.strictEqual(B._indicadoresMembro(c, 0, 2025, 7, 1.5).artigos, 2);
        assert.strictEqual(B._indicadoresMembro(c, 5, 2025, 7, 1.5).artigos, 0);
        assert.strictEqual(B._indicadoresMembro(c, 0, 2025, 7, 1.5).mediaJcr, 0);
    });

    test('CV vazio nao quebra', () => {
        const r = B._indicadoresMembro(null, 5, 2025, 7, 1.5);
        assert.strictEqual(r.artigos, 0);
        assert.strictEqual(r.hWos, 0);
    });
});

describe('_planilhaMembros', () => {
    test('duas linhas de cabecalho, membros por nome, JCR com 2 casas', () => {
        const membros = [
            { name: 'Bruno', fellowshipString: 'PQ 2', publications: [{ year: 2024, jif: 2.345 }] },
            { name: 'Ana', fellowshipString: '-', publications: [] }
        ];
        const L = B._planilhaMembros(membros, 5, 2025, 7, 1.5);
        assert.strictEqual(L.length, 4);
        assert.strictEqual(L[0][2], 'Últimos 5 anos (2020–2025)');
        assert.ok(L[0].includes('Carreira toda'));
        assert.strictEqual(L[1].length, 16);
        assert.strictEqual(L[1][15], 'CV Lattes');
        assert.strictEqual(L[1][14], 'Atualizado');
        assert.deepStrictEqual(L[1].slice(0, 3), ['Nome', 'Bolsa', 'Artigos']);
        assert.deepStrictEqual(L[2].slice(0, 2), ['Ana', '']);
        assert.deepStrictEqual(L[3].slice(0, 3), ['Bruno', 'PQ 2', 1]);
        assert.strictEqual(L[3][7], 2.35);   // soma JCR
    });
});

describe('_linhasMembros: ordenacao', () => {
    const membros = [
        { name: 'Carla', fellowshipString: 'PQ 1A', dateAdded: '2026-03-01T12:00:00Z', publications: [{ year: 2024, jif: 2 }], wosHIndex: 10 },
        { name: 'ana', fellowshipString: '-', dateAdded: '2026-05-01T12:00:00Z', publications: [{ year: 2024, jif: 9 }, { year: 2023, jif: 1 }], wosHIndex: 5 },
        { name: 'Bruno', fellowshipString: 'PQ 2', publications: [{ year: 2024, jif: 2 }], wosHIndex: 5 }
    ];
    const nomes = (ordem) => B._linhasMembros(membros, 0, 2026, 7, 1.5, ordem).map(l => l.cv.name);

    test('sem ordem sai por nome, ignorando caixa', () => {
        assert.deepStrictEqual(nomes(), ['ana', 'Bruno', 'Carla']);
    });
    test('numero decrescente, empate por nome', () => {
        assert.deepStrictEqual(nomes({ chave: 'hWos', dir: -1 }), ['Carla', 'ana', 'Bruno']);
        assert.deepStrictEqual(nomes({ chave: 'artigos', dir: -1 }), ['ana', 'Bruno', 'Carla']);
    });
    test('numero crescente', () => {
        assert.deepStrictEqual(nomes({ chave: 'mediaJcr', dir: 1 }), ['Bruno', 'Carla', 'ana']);
    });
    test('vazio vai para o fim nas duas direcoes', () => {
        assert.deepStrictEqual(nomes({ chave: 'bolsa', dir: 1 }), ['Carla', 'Bruno', 'ana']);
        assert.deepStrictEqual(nomes({ chave: 'bolsa', dir: -1 }), ['Bruno', 'Carla', 'ana']);
        assert.deepStrictEqual(nomes({ chave: 'atualizado', dir: -1 }), ['ana', 'Carla', 'Bruno']);
        assert.deepStrictEqual(nomes({ chave: 'atualizado', dir: 1 }), ['Carla', 'ana', 'Bruno']);
    });
    test('chave desconhecida cai na ordem por nome', () => {
        assert.deepStrictEqual(nomes({ chave: 'xyz', dir: -1 }), ['ana', 'Bruno', 'Carla']);
    });
    test('planilha segue a mesma ordem e leva a data como Date', () => {
        const L = B._planilhaMembros(membros, 0, 2026, 7, 1.5, { chave: 'hWos', dir: -1 });
        assert.deepStrictEqual(L.slice(2).map(r => r[0]), ['Carla', 'ana', 'Bruno']);
        assert.ok(L[2][14] instanceof Date);
        assert.strictEqual(L[4][14], '');
    });
    test('direcao padrao: texto sobe, numero e data descem', () => {
        assert.strictEqual(B._direcaoPadraoMembros('texto'), 1);
        assert.strictEqual(B._direcaoPadraoMembros('num'), -1);
        assert.strictEqual(B._direcaoPadraoMembros('data'), -1);
    });
});

describe('_explicacaoPeriodoMembros', () => {
    test('N anos completos mais o ano em curso', () => {
        const t = B._explicacaoPeriodoMembros(5, 2026);
        assert.ok(t.startsWith('5 anos completos (2021–2025) mais o ano em curso (2026)'));
        assert.ok(t.includes('ano ≥ 2021'));
    });
    test('singular com 1 ano', () => {
        assert.ok(B._explicacaoPeriodoMembros(1, 2026).startsWith('1 ano completo (2025) mais o ano em curso (2026)'));
    });
    test('0 e a carreira toda', () => {
        assert.ok(B._explicacaoPeriodoMembros(0, 2026).startsWith('Toda a carreira'));
    });
});

describe('_planilhaMembros: link do CV Lattes', () => {
    test('nome com link e coluna CV Lattes no fim', () => {
        const L = B._planilhaMembros([{ name: 'Ana', lattesId: '1234567890123456' }], 0, 2026, 7, 1.5);
        const url = 'http://lattes.cnpq.br/1234567890123456';
        assert.deepStrictEqual(L[2][0], { texto: 'Ana', link: url });
        assert.deepStrictEqual(L[2][15], { texto: url, link: url });
    });
    test('sem lattesId (ou com lixo no campo) fica sem link', () => {
        const L = B._planilhaMembros([{ name: 'Ana' }, { name: 'Bia', lattesId: 'javascript:x' }], 0, 2026, 7, 1.5);
        assert.strictEqual(L[2][0], 'Ana');
        assert.strictEqual(L[2][15], '');
        assert.strictEqual(L[3][0], 'Bia');
        assert.strictEqual(L[3][15], '');
    });
});

// Acoes de uma linha da tabela do banco (editar/limpar ID, excluir, prioridade)
// precisam do registro exato. cvMatches aceita nomes parecidos e fazia a acao cair
// no primeiro CV parecido do banco.
describe('_mesmoRegistro', () => {
    const banco = [
        { name: 'Maria José da Silva', lattesId: '1111111111111111' },
        { name: 'Maria Silva', lattesId: '2222222222222222' },
        { name: 'Joao Souza' },
        { name: 'Joao Souza Lima' }
    ];
    const achar = (name, lattesId, processId) =>
        banco.findIndex(cv => B._mesmoRegistro(cv, name, lattesId, processId));

    test('o caso do bug: nome parecido antes no banco nao e escolhido', () => {
        // cvMatches aceitava (IDs diferentes, nomes parecidos): por isso caia na linha errada
        assert.strictEqual(B.cvMatches(banco[0], 'Maria Silva', '2222222222222222'), false);
        assert.strictEqual(achar('Maria Silva', '2222222222222222'), 1);
    });
    test('lattesId manda, mesmo com o nome escrito de outro jeito', () => {
        assert.strictEqual(achar('MARIA JOSE DA SILVA', '1111111111111111'), 0);
        assert.strictEqual(achar('Maria Silva', '9999999999999999'), -1);
    });
    test('sem lattesId: so nome identico, ignorando caixa e acentos', () => {
        assert.strictEqual(achar('joão souza', ''), 2);
        assert.strictEqual(achar('Joao Souza Lima', null), 3);
        assert.strictEqual(achar('Souza', ''), -1);
    });
    test('sem lattesId na linha nao casa registro que tem lattesId', () => {
        assert.strictEqual(achar('Maria Silva', ''), -1);
    });
    test('processId separa propostas do mesmo proponente', () => {
        const procs = [
            { processId: '401/2025-1', lattesId: '1111111111111111', name: 'Maria' },
            { processId: '402/2025-7', lattesId: '1111111111111111', name: 'Maria' }
        ];
        assert.strictEqual(procs.findIndex(p => B._mesmoRegistro(p, 'Maria', '1111111111111111', '402/2025-7')), 1);
    });
    test('linha sem nome nem ids (botoes de grupo) nao casa nada', () => {
        assert.strictEqual(achar(null, null, null), -1);
        assert.strictEqual(achar('', '', ''), -1);
    });
});

// Identidade de pesquisador. Regra: ID Lattes decide quando os dois lados tem; sem
// ID, nome compativel por palavras (nunca por letras); numa lista, ambiguo = nada.
describe('_nomesCompativeis', () => {
    test('identico, ignorando caixa, acentos e pontuacao', () => {
        assert.strictEqual(B._nomesCompativeis('José da Silva', 'JOSE DA SILVA'), true);
    });
    test('nomes do meio omitidos ou abreviados', () => {
        assert.strictEqual(B._nomesCompativeis('Maria Silva', 'Maria José da Silva'), true);
        assert.strictEqual(B._nomesCompativeis('Maria J. Silva', 'Maria José da Silva'), true);
    });
    test('sufixo de geracao nao atrapalha', () => {
        assert.strictEqual(B._nomesCompativeis('João Souza Filho', 'João Souza'), true);
        assert.strictEqual(B._nomesCompativeis('Carlos Lima Júnior', 'Carlos A. Lima'), true);
    });
    test('trecho de letras dentro de outro nome NAO e a mesma pessoa', () => {
        assert.strictEqual(B._nomesCompativeis('Ana Silva', 'Luciana Silva'), false);
        assert.strictEqual(B._nomesCompativeis('Silva', 'Maria Silva'), false);
    });
    test('nome a mais no comeco e outra pessoa', () => {
        assert.strictEqual(B._nomesCompativeis('Maria Silva', 'Ana Maria Silva'), false);
    });
    test('sobrenome diferente e outra pessoa', () => {
        assert.strictEqual(B._nomesCompativeis('Maria Silva', 'Maria Souza'), false);
    });
    test('vazio nao casa', () => {
        assert.strictEqual(B._nomesCompativeis('', ''), false);
        assert.strictEqual(B._nomesCompativeis(null, 'Ana Silva'), false);
    });
});

describe('cvMatches: ID decide', () => {
    test('IDs diferentes nunca casam, mesmo com nome identico', () => {
        assert.strictEqual(B.cvMatches({ name: 'Ana Silva', lattesId: '1111111111111111' }, 'Ana Silva', '2222222222222222'), false);
    });
    test('IDs iguais casam, mesmo com nome escrito de outro jeito', () => {
        assert.strictEqual(B.cvMatches({ name: 'A. Silva', lattesId: '1111111111111111' }, 'Ana Maria Silva', '1111111111111111'), true);
    });
    test('sem ID de um lado, vale o nome compativel', () => {
        assert.strictEqual(B.cvMatches({ name: 'Maria José da Silva', lattesId: '1111111111111111' }, 'Maria Silva', ''), true);
        assert.strictEqual(B.cvMatches({ name: 'Luciana Silva' }, 'Ana Silva', ''), false);
    });
});

describe('_acharPesquisador', () => {
    const lista = [
        { name: 'Maria José da Silva', lattesId: '1111111111111111' },
        { name: 'Maria Silva', lattesId: '2222222222222222' },
        { name: 'Pedro Alves' },
        { name: 'Pedro Henrique Alves' },
        { name: 'Joana Lima', isProcesso: true, lattesId: '3333333333333333' }
    ];

    test('ID igual vence', () => {
        assert.strictEqual(B._acharPesquisador(lista, 'qualquer', '2222222222222222'), lista[1]);
    });
    test('ID novo nao herda o registro de um nome parecido com outro ID', () => {
        // o cenario em que salvar "Maria Silva" (id novo) apagava a "Maria José da Silva"
        assert.strictEqual(B._acharPesquisador(lista, 'Maria Silva', '9999999999999999'), null);
    });
    test('sem ID e varios compativeis: fica o de nome identico', () => {
        assert.strictEqual(B._acharPesquisador(lista, 'Pedro Alves', ''), lista[2]);
    });
    test('sem ID e varios compativeis sem nome identico: nenhum', () => {
        assert.strictEqual(B._acharPesquisador(lista, 'Pedro H. Alves', ''), null);    // casa os dois Pedros
        assert.strictEqual(B._acharPesquisador(lista, 'Maria S. Silva', ''), null);        // dois Marias
    });
    test('filtro e aplicado antes', () => {
        assert.strictEqual(B._acharPesquisador(lista, 'Joana Lima', '3333333333333333', cv => !cv.isProcesso), null);
    });
    test('lista vazia ou ausente', () => {
        assert.strictEqual(B._acharPesquisador(null, 'Ana', ''), null);
    });
});

describe('_mesmoMembro', () => {
    test('IDs decidem quando os dois tem', () => {
        assert.strictEqual(B._mesmoMembro({ name: 'Ana', lattesId: '1' }, { name: 'Ana', lattesId: '2' }), false);
        assert.strictEqual(B._mesmoMembro({ name: 'Ana', lattesId: '1' }, { name: 'A. B.', lattesId: '1' }), true);
    });
    test('sem ID, so nome identico (sem a regra aproximada)', () => {
        assert.strictEqual(B._mesmoMembro({ name: 'Maria Silva' }, { name: 'MARIA SILVA', lattesId: '1' }), true);
        assert.strictEqual(B._mesmoMembro({ name: 'Maria Silva' }, { name: 'Maria J. Silva' }), false);
    });
});

// Ajuste manual com ID Lattes: o ID passa a ser o identificador principal do membro.
describe('mesclarEquipe: ID Lattes como identificador', () => {
    const ID = '1234567890123456';

    test('membro corrigido a mao com ID casa com a extracao de mesmo ID e nome diferente', () => {
        const r = B.mesclarEquipe(
            [{ name: 'M. Silva', lattesId: ID }],
            [{ name: 'Maria da Silva', lattesId: ID, editado: true }],
            []);
        assert.strictEqual(r.length, 1);
        assert.strictEqual(r[0].name, 'Maria da Silva');
    });

    test('mesmo nome com IDs diferentes sao duas pessoas', () => {
        const r = B.mesclarEquipe(
            [{ name: 'Ana Souza', lattesId: '1111111111111111' }, { name: 'Ana Souza', lattesId: '2222222222222222' }],
            [], []);
        assert.strictEqual(r.length, 2);
    });

    test('a extracao sem ID ainda casa pelo nome com o membro que recebeu ID a mao', () => {
        const r = B.mesclarEquipe(
            [{ name: 'Maria da Silva' }],
            [{ name: 'Maria da Silva', lattesId: ID, editado: true }],
            []);
        assert.strictEqual(r.length, 1);
        assert.strictEqual(r[0].lattesId, ID);
    });

    test('ID corrigido a mao vence a extracao com o ID antigo do mesmo nome', () => {
        const r = B.mesclarEquipe(
            [{ name: 'Maria da Silva', lattesId: '9999999999999999' }],
            [{ name: 'Maria da Silva', lattesId: ID, editado: true }],
            []);
        assert.strictEqual(r.length, 1);
        assert.strictEqual(r[0].lattesId, ID);
    });

    test('removido a mao pelo ID nao volta, mesmo com o nome escrito de outro jeito', () => {
        const r = B.mesclarEquipe([{ name: 'M. da Silva', lattesId: ID }], [], ['Maria da Silva', ID]);
        assert.strictEqual(r.length, 0);
    });

    test('o mesmo ID repetido na extracao entra uma vez', () => {
        const r = B.mesclarEquipe([{ name: 'Maria', lattesId: ID }, { name: 'Maria S.', lattesId: ID }], [], []);
        assert.strictEqual(r.length, 1);
    });
});

describe('_mesclarVersoesCv', () => {
    test('vence a versao mais nova, e a mais velha so completa o que falta', () => {
        const r = B._mesclarVersoesCv([
            { name: 'Ana', hasFullCv: true, totalPapers: 10, formacao: 'Doutorado', dateAdded: '2025-01-01' },
            { name: 'Ana Souza', hasFullCv: true, totalPapers: 12, dateAdded: '2026-05-01' }
        ]);
        assert.strictEqual(r.name, 'Ana Souza');
        assert.strictEqual(r.totalPapers, 12);
        assert.strictEqual(r.formacao, 'Doutorado');
    });

    test('CV completo vence esqueleto mais novo da importacao', () => {
        const r = B._mesclarVersoesCv([
            { name: 'Ana', hasFullCv: true, publications: [{ year: 2024 }], dateAdded: '2025-01-01' },
            { name: 'Ana', hasFullCv: false, publications: [], bolsa: 'PQ 2', dateAdded: '2026-05-01' }
        ]);
        assert.strictEqual(r.publications.length, 1);
        assert.strictEqual(r.bolsa, 'PQ 2');
    });

    test('IDs de grupo se somam sem repetir', () => {
        const r = B._mesclarVersoesCv([
            { name: 'A', customId: 'LAB1, LAB2', dateAdded: '2026-01-01' },
            { name: 'A', customId: 'LAB2, PPG', dateAdded: '2025-01-01' }
        ]);
        assert.strictEqual(r.customId, 'LAB1, LAB2, PPG');
    });

    test('lista vazia', () => {
        assert.strictEqual(B._mesclarVersoesCv([]), null);
    });
});

describe('unificarCvPorLattesId', () => {
    function comStorage(dados) {
        const store = Object.assign({}, dados);
        globalThis.chrome = {
            runtime: { id: 'teste', lastError: null },
            storage: { local: {
                get: (_c, cb) => cb(Object.assign({}, store)),
                set: (obj, cb) => { Object.assign(store, obj); cb(); },
                remove: (c, cb) => { (Array.isArray(c) ? c : [c]).forEach(k => { delete store[k]; }); cb(); }
            } }
        };
        return store;
    }
    const ID = '1234567890123456';

    test('esqueleto sem ID e CV ja existente com o ID viram um so, na chave do ID', async () => {
        const store = comStorage({
            'jcr_picc_cv:nm:maria da silva': { name: 'Maria da Silva', hasFullCv: false, bolsa: 'PQ 1A', dateAdded: '2026-06-01' },
            ['jcr_cv:id:' + ID]: { name: 'Maria da Silva', lattesId: ID, hasFullCv: true, publications: [{ year: 2024 }], customId: 'LAB', dateAdded: '2026-01-01' },
            'jcr_cv:id:9999999999999999': { name: 'Maria da Silva', lattesId: '9999999999999999', hasFullCv: true }
        });
        const r = await B.unificarCvPorLattesId(['Maria da Silva'], ID);
        assert.strictEqual(r.copias, 2);
        const unico = store['jcr_picc_cv:id:' + ID];
        assert.ok(unico);
        assert.strictEqual(unico.lattesId, ID);
        assert.strictEqual(unico.publications.length, 1);
        assert.strictEqual(unico.bolsa, 'PQ 1A');
        assert.strictEqual(unico.customId, 'LAB');
        assert.strictEqual(unico.inGeneralDb, true);
        assert.strictEqual(store['jcr_picc_cv:nm:maria da silva'], undefined);
        assert.strictEqual(store['jcr_cv:id:' + ID], undefined);
        // homonimo com outro ID nao e tocado
        assert.ok(store['jcr_cv:id:9999999999999999']);
    });

    test('o nome antigo do membro tambem e procurado; nome so parecido nao', async () => {
        const store = comStorage({
            'jcr_picc_cv:nm:m silva': { name: 'M Silva', hasFullCv: false },
            'jcr_picc_cv:nm:maria silva santos': { name: 'Maria Silva Santos', hasFullCv: false }
        });
        await B.unificarCvPorLattesId(['M Silva', 'Maria Silva'], ID);
        assert.ok(store['jcr_picc_cv:id:' + ID]);
        assert.strictEqual(store['jcr_picc_cv:nm:m silva'], undefined);
        assert.ok(store['jcr_picc_cv:nm:maria silva santos']);
    });

    test('ID invalido nao faz nada', async () => {
        const store = comStorage({ 'jcr_picc_cv:nm:ana': { name: 'Ana' } });
        assert.strictEqual(await B.unificarCvPorLattesId(['Ana'], '123'), null);
        assert.ok(store['jcr_picc_cv:nm:ana']);
    });
});

describe('_migrarMembroParaLattesId', () => {
    const ID = '1234567890123456';
    test('HTML guardado pelo nome passa ao ID e a exclusao do consolidado acompanha', async () => {
        const store = {
            'jcr_proc_blob:P1': { 'memberCv_nm:maria silva': '<html>cv</html>', pdf: 'x' }
        };
        globalThis.chrome = {
            runtime: { id: 'teste', lastError: null },
            storage: { local: {
                get: (_c, cb) => cb(Object.assign({}, store)),
                set: (obj, cb) => { Object.assign(store, obj); cb(); }
            } }
        };
        const proc = { processId: 'P1', excludedCvKeys: ['Maria Silva', 'Outro'] };
        await B._migrarMembroParaLattesId(proc, ['Maria Silva'], '', ID);
        assert.deepStrictEqual(proc.excludedCvKeys, ['Outro', ID]);
        assert.strictEqual(store['jcr_proc_blob:P1']['memberCv_id:' + ID], '<html>cv</html>');
        assert.strictEqual(store['jcr_proc_blob:P1']['memberCv_nm:maria silva'], undefined);
        assert.strictEqual(store['jcr_proc_blob:P1'].pdf, 'x');
    });
});

// O conteudo pesado das propostas mora fora do registro, em jcr_proc_blob:<processId>:
// PDF em base64, HTML dos pareceres, CV congelado e os CVs dos membros. Essa chave NAO
// comeca com 'jcr_proc:' (o separador e '_', nao ':'), entao escapava dos dois botoes de
// limpar e ficava no storage sem nenhuma forma de apagar.
describe('clearDB apaga tambem os blobs das propostas', () => {
    function comStorage() {
        const store = {
            'jcr_cv:id:1111111111111111': { name: 'CV pessoal', lattesId: '1111111111111111', publications: [] },
            'jcr_picc_cv:id:2222222222222222': { name: 'CV de membro', lattesId: '2222222222222222' },
            'jcr_proc:proc:404040': { name: 'Proposta', isProcesso: true, processId: '404040' },
            'jcr_proc_blob:404040': { cvHtml: '<html>pesado</html>', pdfData: 'JVBERi0...' },
            'jcr_lattes_settings': { highJcr: 7 }
        };
        globalThis.chrome = {
            runtime: { id: 'teste', lastError: null },
            storage: { local: {
                get: (_c, cb) => cb(Object.assign({}, store)),
                set: (o, cb) => { Object.assign(store, o); cb && cb(); },
                remove: (c, cb) => { (Array.isArray(c) ? c : [c]).forEach(k => { delete store[k]; }); cb && cb(); }
            } }
        };
        return store;
    }

    test('limpar as propostas leva o blob junto', async () => {
        const store = comStorage();
        await B.clearDB(true, true);            // silencioso, so propostas
        assert.ok(!store['jcr_proc_blob:404040'], 'o blob tem de sair com a proposta');
        assert.ok(!store['jcr_proc:proc:404040']);
        assert.ok(!store['jcr_picc_cv:id:2222222222222222']);
        // o banco pessoal nao e tocado por esse botao
        assert.ok(store['jcr_cv:id:1111111111111111']);
    });

    test('limpar tudo leva o blob junto', async () => {
        const store = comStorage();
        await B.clearDB(true, false);           // silencioso, tudo
        assert.ok(!store['jcr_proc_blob:404040'], 'o blob tem de sair na limpeza geral');
        assert.ok(!store['jcr_cv:id:1111111111111111']);
        assert.ok(!store['jcr_proc:proc:404040']);
    });

    // As configuracoes nao sao dados: limpar o banco nao pode zerar os limiares de JCR.
    test('as configuracoes sobrevivem aos dois botoes', async () => {
        const a = comStorage();
        await B.clearDB(true, true);
        assert.ok(a['jcr_lattes_settings']);
        const b = comStorage();
        await B.clearDB(true, false);
        assert.ok(b['jcr_lattes_settings']);
    });
});
