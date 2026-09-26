/**
 * Leitura do PDF da proposta do piccTools (Plataforma Carlos Chagas).
 *
 * Só LÊ: recebe o PDF ou o texto já extraído dele e devolve dados. Não escreve na
 * página, não baixa nada, não guarda nada. É o mesmo papel que lattes_parser.js faz
 * para o Currículo Lattes e producoes_parser.js para a página de produções.
 *
 * O PDF da proposta não tem marcação: os campos são reconhecidos pela posição na
 * página e por rótulos no texto. É a extração mais frágil do projeto, e a que mais
 * vai sofrer quando a Plataforma mudar de formato — daí valer a pena tê-la isolada.
 *
 * As funções com prefixo _ são puras (texto → dados) e testáveis em Node. As que
 * recebem o PDF precisam do pdf.js.
 */
(function (raiz) {
    'use strict';

    // ------------------------------------------------------------------
    // Itens de texto do PDF
    // ------------------------------------------------------------------

    // Ordena por página crescente, Y decrescente e X crescente, e agrupa em linhas
    // com tolerância de 4pt. A tolerância existe porque itens da mesma linha visual
    // não têm o Y exatamente igual; mexer nela muda o que conta como "uma linha" em
    // toda a extração, então há uma implementação só.
    async function itensDoPdf(arrayBuffer) {
        const pdfjs = (typeof pdfjsLib !== 'undefined') ? pdfjsLib : null;
        if (!pdfjs) return null;
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL &&
            !pdfjs.GlobalWorkerOptions.workerSrc) {
            pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('scripts/pdf.worker.min.js');
        }
        const pdf = await pdfjs.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;

        const allPageItems = [];
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const content = await (await pdf.getPage(pageNum)).getTextContent();
            content.items.forEach(item => {
                if (item.str && item.str.trim()) {
                    allPageItems.push({ page: pageNum, x: item.transform[4], y: item.transform[5], str: item.str.trim() });
                }
            });
        }
        allPageItems.sort((a, b) => {
            if (a.page !== b.page) return a.page - b.page;
            const yDiff = b.y - a.y;
            if (Math.abs(yDiff) > 4) return yDiff;
            return a.x - b.x;
        });

        const allLines = [];
        let linha = [], yAtual = null, pagAtual = null;
        allPageItems.forEach(item => {
            if (pagAtual !== item.page || yAtual === null || Math.abs(yAtual - item.y) > 4) {
                if (linha.length) allLines.push(linha);
                linha = [item]; yAtual = item.y; pagAtual = item.page;
            } else {
                linha.push(item);
            }
        });
        if (linha.length) allLines.push(linha);

        const fullText = allLines.map(l => l.map(i => i.str).join(' ')).join('\n');
        return { allPageItems, allLines, fullText };
    }

    // Titulo (em portugues) e Resumo do projeto, a partir dos itens ja ordenados.
    //
    // O titulo esta numa tabela de duas colunas dentro do bloco PROJETO. O rotulo fica
    // centrado verticalmente na celula, entao parte do valor pode aparecer ACIMA do
    // proprio rotulo na ordenacao por coordenada — e o rotulo ainda pode quebrar em duas
    // linhas ("TITULO (em" / "portugues):"). Por isso nao da para recortar o texto linear
    // entre os rotulos: o titulo em ingles vazaria para o campo do portugues. Trabalhamos
    // com as duas colunas e cortamos os blocos no maior espaco vertical da faixa que
    // separa um rotulo do seguinte.
    //
    // Usada pela importacao das propostas (picc_content.js). Mora aqui por enquanto,
    // junto de _itensDoPdf; as duas pertencem a leitura do PDF da proposta e devem ir
    // para um leitor proprio do piccTools.
    function lerTituloResumo(allPageItems, allLines, fullText) {
        const resultado = { tituloProjeto: '', resumoProjeto: '' };
        if (!Array.isArray(allPageItems) || !Array.isArray(allLines) || !fullText) return resultado;

        const semAcento = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const iProjeto = allPageItems.findIndex(it => /^PROJETO$/i.test(String(it.str || '').trim()));
        if (iProjeto >= 0) {
            const pag = allPageItems[iProjeto].page;
            const yProjeto = allPageItems[iProjeto].y;
            const linhasPag = allLines.filter(l => l.length && l[0].page === pag && l[0].y < yProjeto);
            const linhaInicio = linhasPag.find(l => /^IN[ÍI]CIO:?$/i.test(String(l[0].str || '').trim()));
            if (linhaInicio && linhaInicio.length > 1) {
                const xValor = linhaInicio[1].x;
                const yInicio = linhaInicio[0].y;
                const rotulos = [], valores = [];
                linhasPag.filter(l => l[0].y < yInicio).forEach(l => {
                    const esq = l.filter(i => i.x < xValor - 10);
                    const dir = l.filter(i => i.x >= xValor - 10);
                    if (esq.length) rotulos.push({ y: esq[0].y, texto: esq.map(i => i.str).join(' ') });
                    if (dir.length) valores.push({ y: dir[0].y, texto: dir.map(i => i.str).join(' ') });
                });
                // Um rotulo pode ocupar ate 3 linhas da coluna da esquerda.
                const acharRotulo = (re) => {
                    for (let i = 0; i < rotulos.length; i++) {
                        for (let k = 0; k < 3 && i + k < rotulos.length; k++) {
                            const txt = rotulos.slice(i, i + k + 1).map(l => l.texto).join(' ').replace(/\s+/g, ' ').trim();
                            if (re.test(semAcento(txt))) {
                                const ys = rotulos.slice(i, i + k + 1).map(l => l.y);
                                return { yMax: Math.max.apply(null, ys), yMin: Math.min.apply(null, ys) };
                            }
                        }
                    }
                    return null;
                };
                const rotPt = acharRotulo(/^titulo\s*\(em\s*portugues\)\s*:?$/);
                const rotEn = acharRotulo(/^titulo\s*\(em\s*ingles\)\s*:?$/);
                if (rotPt && rotEn) {
                    const L = valores.slice().sort((a, b) => b.y - a.y);
                    const corte = (yAcima, yAbaixo) => {
                        let idx = -1, maiorGap = -1;
                        for (let c = 0; c < L.length - 1; c++) {
                            const fronteira = (L[c].y + L[c + 1].y) / 2;
                            if (fronteira < yAcima && fronteira > yAbaixo) {
                                const gap = L[c].y - L[c + 1].y;
                                if (gap > maiorGap) { maiorGap = gap; idx = c; }
                            }
                        }
                        return idx;
                    };
                    const ini = corte(yInicio, rotPt.yMax) + 1;   // separa do bloco INICIO/DURACAO
                    const fim = corte(rotPt.yMin, rotEn.yMax);    // separa do titulo em ingles
                    if (fim >= ini) {
                        resultado.tituloProjeto = L.slice(ini, fim + 1).map(l => l.texto).join(' ').replace(/\s+/g, ' ').trim();
                    }
                }
            }
        }
        if (!resultado.tituloProjeto) {
            const m = String(fullText).match(/T[ÍI]TULO\s*\(em\s*portugu[êe]s\)\s*:?\s*([\s\S]*?)\s*T[ÍI]TULO\s*\(em\s*ingl[êe]s\)/i);
            if (m) resultado.tituloProjeto = m[1].replace(/\s+/g, ' ').trim();
        }

        // Resumo: bloco de largura inteira entre o titulo RESUMO e ETAPAS / ATIVIDADES.
        // O rodape de paginacao se intercala no meio quando o bloco vira a pagina.
        const linhasTexto = String(fullText).split('\n').map(l => l.trim());
        const iResumo = linhasTexto.findIndex(l => /^RESUMO$/i.test(l));
        if (iResumo >= 0) {
            const corpo = [];
            for (let j = iResumo + 1; j < linhasTexto.length; j++) {
                const l = linhasTexto[j];
                if (/^ETAPAS\s*\/\s*ATIVIDADES/i.test(l)) break;
                if (/^P[áa]gina\s+\d+\s*\/\s*\d+$/i.test(l)) continue;
                if (l) corpo.push(l);
            }
            resultado.resumoProjeto = corpo.join(' ').replace(/\s+/g, ' ').trim();
        }
        return resultado;
    }


    // ------------------------------------------------------------------
    // Cabeçalho da proposta
    // ------------------------------------------------------------------

    // O edital sai do caminho do PDF (.../doc/Universal_2026/...); o texto é o
    // recurso seguinte, porque a sigla nem sempre está escrita na página.
    function _edital(pdfUrl, fullText) {
        if (pdfUrl) {
            const m = String(pdfUrl).match(/\/doc\/([^\/]+)\//i);
            if (m) return m[1];
        }
        const sigla = String(fullText || '').match(/SIGLA:\s*([^\n\r]+)/i);
        return sigla ? sigla[1].trim() : '';
    }

    function _faixa(fullText) {
        const m = String(fullText || '').match(/\bFaixa\s+([A-Za-z0-9])/i);
        return m ? m[1].toUpperCase() : '-';
    }

    function _processo(fullText) {
        const m = String(fullText || '').match(/Processo:\s*([\d\/\-]+)/i);
        return m ? m[1].trim() : '';
    }

    function _protocolo(fullText) {
        const t = String(fullText || '');
        const m = t.match(/PROPOSTA\s+(\d{16})/i) || t.match(/\b00\d{14}\b/);
        return m ? (m[1] || m[0]) : '';
    }

    function _nomeProponente(fullText) {
        const t = String(fullText || '');
        const m = t.match(/PROPONENTE[\s\S]*?NOME:\s*([^\n\r]+)/i) || t.match(/NOME:\s*([^\n\r]+)/i);
        return m ? m[1].trim() : '';
    }

    // ------------------------------------------------------------------
    // Campos de um membro da equipe
    // ------------------------------------------------------------------

    // UF a partir da instituição. Primeiro o formato "- CE -", depois a sigla solta
    // entre as 27 unidades da federação — nessa ordem, senão um "PARÁ" no meio do
    // nome poderia casar antes do campo certo.
    function _uf(instituicao) {
        const s = String(instituicao || '');
        if (!s) return '';
        const m = s.match(/-([A-Z]{2})-/i) ||
                  s.match(/,?\s*\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i);
        return m ? m[1].toUpperCase() : '';
    }

    function _ehUrlLattes(url) {
        if (!url) return false;
        return /^https?:\/\/lattes\.cnpq\.br\/\d{16}$/i.test(String(url).trim());
    }

    // A titulação vem colada a restos de outras colunas do PDF (URL do currículo,
    // rótulos, o ID de 16 dígitos). Limpa esse ruído e normaliza para um dos níveis
    // conhecidos; o que não casar com nenhum vira '' em vez de sujeira.
    function _formacao(str) {
        if (!str) return '';
        const s = String(str)
            .replace(/https?:\/\/[^\s]+/gi, '')
            .replace(/lattes\.cnpq\.br\/\d*/gi, '')
            .replace(/\b\d{16}\b/g, '')
            .replace(/\b(URL|DO|CURRÍCULO|FORMAÇÃO|TITULAÇÃO|NOME|BOLSA|INSTITUIÇÃO|DEPARTAMENTO|ÁREAS|ATUAÇÃO|PESQUISADOR|EQUIPE|TEMPO|DEDIC|PROJ|HORAS|SEMANA)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

        const NIVEIS = /\b(Doutorado|Doutor|Mestrado|Mestre|Especializa[çc][ãa]o|Especialista|Gradua[çc][ãa]o|Graduado|Bacharel|Licenciatura|Ensino\s+M[ée]dio|T[ée]cnico|P[óo]s-Doutorado)\b/i;
        const m = s.match(NIVEIS);
        if (!m) return '';

        const bruto = m[0];
        const minusculo = bruto.toLowerCase();
        if (minusculo.startsWith('pós-doutor') || minusculo.startsWith('pos-doutor')) return 'Pós-Doutorado';
        if (minusculo.startsWith('doutor')) return 'Doutorado';
        if (minusculo.startsWith('mestr')) return 'Mestrado';
        if (minusculo.startsWith('especializ') || minusculo.startsWith('especialist')) return 'Especialização';
        if (minusculo.startsWith('gradua') || minusculo.startsWith('bacharel') || minusculo.startsWith('licencia')) return 'Graduação';
        if (minusculo.startsWith('ensino')) return 'Ensino Médio';
        if (minusculo.startsWith('téc') || minusculo.startsWith('tec')) return 'Técnico';
        return bruto;
    }

    // Bolsa de produtividade válida. São duas expressões porque a letra sozinha
    // exige separador: sem isso "DTA" (análise térmica) seria lido como bolsa DT-A.
    function _ehBolsaValida(b) {
        if (!b || typeof b !== 'string') return false;
        const limpo = b.trim().replace(/\s+/g, ' ');
        if (limpo === '' || limpo === '-') return false;
        return /^(PQ|DT)\s*[-–]?\s*(1[A-D]|2|SR)$/i.test(limpo)
            || /^(PQ|DT)\s*[-–\s]\s*[A-C]$/i.test(limpo);
    }

    raiz.JCRPiccParser = {
        itensDoPdf: itensDoPdf,
        lerTituloResumo: lerTituloResumo,
        // puras, expostas para uso e para teste
        _edital: _edital,
        _faixa: _faixa,
        _processo: _processo,
        _protocolo: _protocolo,
        _nomeProponente: _nomeProponente,
        _uf: _uf,
        _ehUrlLattes: _ehUrlLattes,
        _formacao: _formacao,
        _ehBolsaValida: _ehBolsaValida
    };
})(typeof window !== 'undefined' ? window : globalThis);
