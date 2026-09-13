#!/usr/bin/env node
'use strict';
// Hook PostToolUse: verifica a sintaxe de um .js do projeto apos Edit/Write.
//
// Cumpre a diretiva de .agents/AGENTS.md ("rode node -c automaticamente apos
// modificar arquivos JavaScript") de forma deterministica, sem depender de o
// modelo lembrar de faze-lo.
//
// Le o payload do hook em stdin. Sai 0 e calado para tudo que nao for um .js
// nosso; sai 2 quando a sintaxe quebra, o que devolve a mensagem de erro ao
// modelo para correcao imediata.
//
// Registrado em .claude/settings.json, que o invoca como
// ${CLAUDE_PROJECT_DIR}/.claude/hooks/check-js.js — caminho relativo ao
// projeto, para funcionar em qualquer clone.

const { spawnSync } = require('child_process');
const path = require('path');

// Bundles vendorizados do PDF.js: minificados, enormes e nao editados a mao.
const IGNORADOS = new Set(['pdf.min.js', 'pdf.worker.min.js']);

let entrada = '';
process.stdin.on('data', (parte) => { entrada += parte; });
process.stdin.on('end', () => {
    let alvo = '';
    try {
        const payload = JSON.parse(entrada || '{}');
        alvo = (payload.tool_input && payload.tool_input.file_path)
            || (payload.tool_response && payload.tool_response.filePath)
            || '';
    } catch (e) {
        process.exit(0); // payload inesperado nao deve travar o fluxo
    }

    if (!/\.js$/i.test(alvo)) process.exit(0);
    if (IGNORADOS.has(path.basename(alvo))) process.exit(0);

    // process.execPath: usa o mesmo node que executa este script, sem depender do PATH
    const r = spawnSync(process.execPath, ['--check', alvo], { encoding: 'utf8' });
    if (r.status === 0) process.exit(0);

    process.stderr.write('Erro de sintaxe em ' + alvo + '\n' + (r.stderr || r.stdout || ''));
    process.exit(2);
});
