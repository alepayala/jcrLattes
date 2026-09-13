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
