'use strict';
// Carrega os scripts da extensao em Node.
//
// Eles sao <script> comuns: nao usam module.exports, apenas atribuem o seu
// objeto a `window` (producoes_parser.js aceita globalThis quando nao ha
// window). Basta, portanto, oferecer um `window` que aponte para o proprio
// global antes do require. Nenhum dos tres toca em chrome.* ou document.*
// no nivel superior, entao o carregamento nao precisa de mais nenhum stub.
const path = require('path');

const DIST = path.join(__dirname, '..', '..', 'dist', 'scripts');

function carregar(arquivo) {
    if (!globalThis.window) globalThis.window = globalThis;
    require(path.join(DIST, arquivo));
    return globalThis;
}

module.exports = {
    producoes: () => carregar('producoes_parser.js').JCRProducoes,
    relatorio: () => carregar('report_utils.js').JCRReportUtils,
    // db_tools depende de report_utils em tempo de execucao (faixaDeJcr, valorJcr,
    // calculateReportStats). No manifest ele vem antes; aqui tambem.
    banco: () => { carregar('report_utils.js'); return carregar('db_tools.js').JCRDBTools; },
    lattes: () => carregar('lattes_parser.js').JCRLattesParser,
    picc: () => carregar('picc_parser.js').JCRPiccParser
};
