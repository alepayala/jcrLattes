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

    // ------------------------------------------------------------------
    // Instituições e anexos
    // ------------------------------------------------------------------

    // Linha que tem cara de nome de instituição: "Nome da Instituição - SIGLA, UF,
    // País". A checagem pelo formato existe porque a ordenação por coordenada
    // intercala rodapés de paginação e restos de tabela entre o rótulo e o valor,
    // então não dá para confiar na posição.
    function _pareceInstituicao(linha) {
        const l = String(linha || '');
        return !!l && l.length > 5 && l.length < 200 &&
            /\s[-–]\s/.test(l) &&
            /,\s*[A-Za-zÀ-ÿ.]+\.?$/.test(l) &&
            !/(DETALHAMENTO|JUSTIFICATIVA|VALOR|ITEM|QTD|TOTAL|DURA[ÇC][ÃA]O|BENEF[ÍI]CIO|R\$)/i.test(l);
    }

    // Instituição Executora/Sede, do bloco "INSTITUIÇÕES ENVOLVIDAS". O valor pode vir
    // na mesma linha do rótulo ou abaixo dele; a busca para em "Colaboradora" e nos
    // blocos de orçamento, para não pegar a instituição errada.
    function _instituicaoExecutora(fullText) {
        const linhas = String(fullText || '').split('\n').map(l => l.trim());
        const i = linhas.findIndex(l => /^Executora\s*\/\s*Sede\b/i.test(l));
        if (i < 0) return '';

        const mesmaLinha = linhas[i].replace(/^Executora\s*\/\s*Sede\s*:?\s*/i, '').trim();
        if (_pareceInstituicao(mesmaLinha)) return mesmaLinha;

        for (let j = i + 1; j < Math.min(linhas.length, i + 25); j++) {
            const l = linhas[j];
            if (!l) continue;
            if (/^(Colaboradora|RECURSOS|CUSTEIO|CAPITAL|BOLSAS|[ÁA]REAS\s+DO)/i.test(l)) break;
            if (_pareceInstituicao(l)) return l;
        }
        return '';
    }

    // Anexos da proposta: pares "Tipo - URL" dentro do bloco DOCUMENTOS ANEXOS. Os
    // currículos vão para o fim da lista, porque o que o revisor abre primeiro é o
    // projeto de pesquisa.
    function _anexos(fullText) {
        const texto = String(fullText || '');
        const lista = [];

        // ".pd" no fim acontece quando o PDF corta a extensão ao quebrar a linha
        const arrumarUrl = (u) => {
            const s = String(u || '').trim();
            return /\.pd$/i.test(s) ? s.replace(/\.pd$/i, '.pdf') : s;
        };

        const bloco = texto.match(/DOCUMENTOS\s+ANEXOS[\s\S]*?(?=DECLARAÇÃO|$)/i);
        if (bloco) {
            const re = /([A-Za-zÀ-ÖØ-öø-ÿ\s]+)\s+-\s+(https?:\/\/anexosform\.cnpq\.br\/doc\/[^\s\n\r"';\)]+)/gi;
            let m;
            while ((m = re.exec(bloco[0])) !== null) {
                const tipo = m[1].replace(/DOCUMENTOS\s+ANEXOS|ARQUIVO|TAMANHO|URL/gi, '').replace(/\s+/g, ' ').trim();
                lista.push({ type: tipo || 'Anexo', url: arrumarUrl(m[2]) });
            }
        }

        // Quando o bloco não casa, ainda vale pegar um endereço solto.
        if (lista.length === 0) {
            const solto = texto.match(/(https?:\/\/anexosform\.cnpq\.br\/doc\/[^\s\n\r"';\)]+)/i);
            if (solto) lista.push({ type: 'Anexo', url: arrumarUrl(solto[1]) });
        }

        const ehCurriculo = (a) => {
            const t = (a.type || '').toLowerCase();
            return t.includes('currículo') || t.includes('curriculo');
        };
        lista.sort((a, b) => {
            const ca = ehCurriculo(a), cb = ehCurriculo(b);
            if (ca && !cb) return 1;
            if (!ca && cb) return -1;
            return 0;
        });
        return lista;
    }

    // ------------------------------------------------------------------
    // Equipe
    // ------------------------------------------------------------------

    // Le os membros da equipe a partir dos itens de texto do PDF. Esta e a extracao
    // mais fragil do projeto: nao ha marcacao nenhuma, os campos sao reconhecidos
    // pela coordenada X e os blocos de membro sao delimitados pelo "URL DO CURRICULO"
    // que fecha cada um. Um erro aqui nao aparece como falha — aparece como um membro
    // com a bolsa ou a instituicao do vizinho.
    function lerEquipe(allPageItems) {
        const itens = Array.isArray(allPageItems) ? allPageItems : [];
        if (itens.length === 0) return [];
        const allPageItemsLocal = itens;
    // 6. Extract Team Members using strict column coordinates & subheader bounds
    const equipeIdx = allPageItemsLocal.findIndex(item => item.str === 'EQUIPE' || item.str === 'Pesquisador' || item.str.includes('MEMBROS DA EQUIPE'));
    let teamMembers = [];
    let memberBlockEndIndices = [];

    allPageItemsLocal.forEach((item, idx) => {
        if (idx > equipeIdx) {
            if (item.str === 'URL') {
                const next1 = allPageItemsLocal[idx + 1]?.str || '';
                const next2 = allPageItemsLocal[idx + 2]?.str || '';
                if (next1 === 'DO' || next2 === 'CURRÍCULO' || next1 === 'CURRÍCULO') {
                    const lastIdx = memberBlockEndIndices[memberBlockEndIndices.length - 1];
                    if (lastIdx === undefined || idx - lastIdx > 5) {
                        memberBlockEndIndices.push(idx);
                    }
                }
            } else if (item.str.includes('lattes.cnpq.br/') || item.str.includes('visualizacv.do')) {
                const lastIdx = memberBlockEndIndices[memberBlockEndIndices.length - 1];
                if (lastIdx === undefined || idx - lastIdx > 5) {
                    memberBlockEndIndices.push(idx);
                }
            }
        }
    });

    // Limites das colunas derivados do cabecalho que se repete em cada bloco de membro
    // (NOME | FORMACAO/TITULACAO | BOLSA | INSTITUICAO/DEPARTAMENTO | AREAS DE ATUACAO).
    // Antes eram fixos (45/160/225/258/400) e quebravam em PDFs com outra margem: num
    // deles o nome comeca em x=34 e seus primeiros pedacos caiam fora da faixa do nome,
    // produzindo nomes truncados ("Lucas Anhezini de Araujo" -> "Anhezini de").
    const colunas = (() => {
        const padrao = { nome: 45, formacao: 160, bolsa: 225, inst: 258, areas: 400 };
        if (equipeIdx < 0) return padrao;

        const acharX = (re) => {
            for (let j = equipeIdx; j < allPageItemsLocal.length; j++) {
                if (re.test(allPageItemsLocal[j].str.trim())) return allPageItemsLocal[j].x;
            }
            return null;
        };

        const xNome = acharX(/^NOME$/i);
        const xForm = acharX(/^(FORMA|TITULA)/i);
        let xInst = acharX(/^(INSTITUI|DEPARTAMENTO)/i);
        let xBolsa = acharX(/^BOLSA/i);
        let xAreas = acharX(/^([ÁA]REAS|ATUA)/i);

        // Sem os dois marcos da esquerda nao ha como derivar: mantem o comportamento anterior
        if (xNome === null || xForm === null || !(xNome < xForm)) return padrao;

        // INSTITUICAO costuma ficar a ~42% do caminho entre FORMACAO e AREAS
        if ((xInst === null || xInst <= xForm) && xAreas !== null && xAreas > xForm) {
            xInst = xForm + (xAreas - xForm) * 0.42;
        }
        if (xInst === null || xInst <= xForm) return padrao;

        // BOLSA fica entre formacao e instituicao; se o rotulo nao aparecer, estima
        if (xBolsa === null || xBolsa <= xForm || xBolsa >= xInst) xBolsa = xForm + (xInst - xForm) * 0.55;
        if (xAreas === null || xAreas <= xInst) xAreas = xInst + 140;

        const folga = 6;   // itens podem comecar poucos pontos a esquerda do rotulo

        // LIMITACAO CONHECIDA: o cabecalho se repete a cada bloco de membro e NAO fica
        // sempre no mesmo x — numa mesma proposta houve blocos com INSTITUICAO em 412 e
        // outros em 398, e nas 12 propostas de amostra o desvio dentro do mesmo PDF vai
        // de 0 a 17 pontos. Como as colunas sao derivadas uma unica vez, do primeiro
        // cabecalho, um bloco deslocado mais que a folga perde os pedacos que comecam na
        // margem e pode engolir o traco da coluna vizinha: "European Organization for /
        // Nuclear Research-CERN--Suica-" virou "Organization for - Research-CERN--Suica".
        //
        // Alargar a faixa (fronteiras no meio do vao) corrige esse caso, mas mudou a
        // instituicao extraida de 46 dos 155 membros da amostra, e nao ha como validar
        // isso fora do navegador: o pdf.js quebra os itens de texto de forma diferente
        // do que se consegue simular. Como o estrago potencial e maior que o ganho — o
        // nome sai truncado, e corrigi-lo a mao pelo lapis da tabela de equipe leva
        // segundos — a faixa continua conservadora. O caminho certo, quando houver
        // tempo, e derivar as colunas POR BLOCO de membro em vez de uma vez so.
        return {
            nome: xNome - folga,
            formacao: xForm - folga,
            bolsa: xBolsa - folga,
            inst: xInst - folga,
            areas: xAreas - folga
        };
    })();

    let currentCategory = 'Pesquisador';

    memberBlockEndIndices.forEach((endIdx, i) => {
        const prevBound = i > 0 ? memberBlockEndIndices[i-1] + 1 : (equipeIdx >= 0 ? equipeIdx + 1 : 0);

        let cvLink = '';
        let lattesId = '';

        // Find Lattes URL if available in this block
        const endItemStr = allPageItemsLocal[endIdx]?.str || '';
        const endNextStr = allPageItemsLocal[endIdx + 3]?.str || allPageItemsLocal[endIdx + 1]?.str || '';
        const combinedUrlStr = endItemStr + ' ' + endNextStr;
        const linkMatch = combinedUrlStr.match(/https?:\/\/[^\s"'<>\)]+/i) || endItemStr.match(/https?:\/\/[^\s"'<>\)]+/i);
        if (linkMatch) {
            const urlCandidate = linkMatch[0].trim();
            const lattesIdMatch = urlCandidate.match(/lattes\.cnpq\.br\/(\d{16})/i);
            if (lattesIdMatch) {
                lattesId = lattesIdMatch[1];
                cvLink = `http://lattes.cnpq.br/${lattesId}`;
            }
        }

        if (!_ehUrlLattes(cvLink)) {
            cvLink = '';
            lattesId = '';
        }

        // Find subheader TEMPO DEDIC / RESPONSABILIDADE for this member
        let subHeaderIdx = -1;
        for (let j = prevBound; j < endIdx; j++) {
            const item = allPageItemsLocal[j];
            if (item.str.startsWith('TEMPO') || item.str.startsWith('RESPONSABILIDADE')) {
                subHeaderIdx = j;
                break;
            }
        }

        const sectionABound = subHeaderIdx >= 0 ? subHeaderIdx : endIdx;

        // Check if there is a Category header before sectionABound
        for (let j = prevBound; j < sectionABound; j++) {
            const item = allPageItemsLocal[j];
            if (item.x < 100) {
                // O composto e testado ANTES do simples. O PDF quebra "Pesquisador
                // Estrangeiro" em dois itens de texto, e testando o simples primeiro
                // o "Pesquisador" casava sozinho, o ramo de combinacao nunca era
                // alcancado e o estrangeiro entrava como pesquisador comum — o que
                // fazia a coluna Pesquisador da distribuicao somar os dois grupos.
                const COMPOSTA = /^(Pesquisador\s+Estrangeiro|Pesquisador\s+Colaborador|Aluno\s+de\s+Inicia[çc][ãa]o\s+Cient[íi]fica)$/i;
                const SIMPLES = /^(Pesquisador\s+Estrangeiro|Pesquisador|Aluno|Colaborador|P[óo]s-Doutorando|T[ée]cnico|Especialista)$/i;
                const proximo = allPageItemsLocal[j + 1]?.str || '';
                const combinado = (item.str + ' ' + proximo).replace(/\s+/g, ' ').trim();
                if (COMPOSTA.test(combinado)) {
                    currentCategory = combinado;
                } else if (SIMPLES.test(item.str.trim())) {
                    // cobre tambem o caso em que a categoria composta vem num item so
                    currentCategory = item.str.trim();
                }
            }
        }

        let nameParts = [];
        let formacaoParts = [];
        let bolsaParts = [];
        let instParts = [];

        for (let j = prevBound; j < sectionABound; j++) {
            const item = allPageItemsLocal[j];
            const upperStr = item.str.toUpperCase();
            if (upperStr.startsWith('NOME') || upperStr.startsWith('FORMAÇÃO') || upperStr.startsWith('TITULAÇÃO') ||
                upperStr.startsWith('BOLSA') || upperStr.startsWith('INSTITUIÇÃO') || upperStr.startsWith('DEPARTAMENTO') ||
                upperStr.startsWith('ÁREAS') || upperStr.startsWith('ATUAÇÃO') || upperStr.startsWith('EQUIPE') ||
                upperStr.startsWith('PESQUISADOR') || upperStr.startsWith('ALUNO') || upperStr.startsWith('COLABORADOR') ||
                upperStr.startsWith('PÁGINA') || upperStr.startsWith('URL') || upperStr === 'DO' || upperStr === 'CURRÍCULO' || item.str === 'DE') {
                continue;
            }

            // A URL do curriculo pode vir como item proprio na mesma coluna do nome
            // (formato em que "URL DO CURRICULO" e o link ficam na mesma linha).
            // Sem este filtro o link era concatenado ao nome do membro.
            const txtItem = item.str.trim().toLowerCase();
            if (txtItem.startsWith('http://') || txtItem.startsWith('https://') || txtItem.includes('lattes.cnpq.br')) {
                continue;
            }

            // Colunas delimitadas pelos X do cabecalho (ver "colunas" acima)
            if (item.x >= colunas.nome && item.x < colunas.formacao) nameParts.push(item.str);
            else if (item.x >= colunas.formacao && item.x < colunas.bolsa) formacaoParts.push(item.str);
            else if (item.x >= colunas.bolsa && item.x < colunas.inst) bolsaParts.push(item.str);
            else if (item.x >= colunas.inst && item.x < colunas.areas) instParts.push(item.str);
        }

        const name = nameParts.join(' ').replace(/\s+/g, ' ').trim();
        const rawFormacao = formacaoParts.join(' ').replace(/\s+/g, ' ').trim();
        const formacao = _formacao(rawFormacao);
        const rawBolsa = bolsaParts.join(' ').replace(/\s+/g, ' ').trim();
        const bolsa = _ehBolsaValida(rawBolsa) ? rawBolsa : '-';
        let instituicao = instParts.join(' ').replace(/\s+/g, ' ').trim();
        instituicao = instituicao.replace(/-\s*$/, '').trim();

        // Ignore garbage blocks or section headers like "Quadro Geral", "Resumo", etc.
        const isInvalidName = !name || 
            /^(Quadro|Quadro\s+Geral|Resumo|Categoria|Propomos|Projeto|Palavras|Objetivos|Metodologia|Cronograma|Orçamento|Referência|Declaração|Comitê|CNPq)/i.test(name) ||
            name.toUpperCase().includes('QUADRO GERAL') ||
            name.toUpperCase().includes('CATEGORIA RESUMO') ||
            name.length > 80;

        if (!isInvalidName && (name || cvLink)) {
            teamMembers.push({
                name: name,
                formacao: formacao,
                cvLink: cvLink,
                lattesId: lattesId,
                bolsa: bolsa,
                categoria: currentCategory,
                instituicao: instituicao,
                isVisible: true
            });
        }
    });

        return teamMembers;
    }

    // ---- Quadro Geral: totais por categoria informados no proprio PDF ----
    //   Quadro Geral
    //   CATEGORIA        NUMERO DE PARTICIPANTES
    //   Pesquisador      5
    //   Aluno            10
    // O numero pode vir no MESMO item de texto da categoria ("Pesquisador 5") ou numa
    // coluna a direita, com y proximo — tratamos os dois casos por coordenada.
    function lerQuadroGeral(allPageItems) {
        const itens = Array.isArray(allPageItems) ? allPageItems : [];
        const quadroGeral = [];

        const iQg = itens.findIndex(it => /^Quadro\s+Geral\b/i.test(it.str.trim()));
        if (iQg >= 0) {
            const pagina = itens[iQg].page;
            const yTopo = itens[iQg].y;
            let yFim = yTopo - 120;   // limite inferior do bloco

            // ...ou ate o inicio da secao seguinte, se ela vier antes
            for (let k = 0; k < itens.length; k++) {
                const it = itens[k];
                if (it.page !== pagina || it.y >= yTopo) continue;
                if (/^(RESUMO|PALAVRAS|OBJETIVO|METODOLOGIA)/i.test(it.str.trim())) {
                    yFim = Math.max(yFim, it.y);
                    break;
                }
            }

            const bloco = itens.filter(it => it.page === pagina && it.y < yTopo && it.y > yFim);
            const categorias = [];   // { y, texto }
            const numeros = [];      // { y, valor }

            bloco.forEach(it => {
                const t = it.str.trim();
                if (!t) return;
                if (/^(CATEGORIA|N[ÚU]MERO|DE|PARTICIPANTES)$/i.test(t)) return;   // cabecalho
                if (/^N[ÚU]MERO\s+DE\s+PARTICIPANTES$/i.test(t)) return;
                if (/^\d+$/.test(t)) { numeros.push({ y: it.y, valor: parseInt(t, 10) }); return; }

                const juntos = t.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.\-]*?)\s+(\d+)$/);
                if (juntos) {
                    quadroGeral.push({ categoria: juntos[1].replace(/\s+/g, ' ').trim(), quantidade: parseInt(juntos[2], 10) });
                    return;
                }
                if (/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.\-]*$/.test(t) && t.length <= 40) {
                    categorias.push({ y: it.y, x: it.x, texto: t.replace(/\s+/g, ' ').trim() });
                }
            });

            // Layout em duas colunas: casa cada LINHA de categoria com o numero de y
            // proximo. Os pedacos de uma mesma linha sao juntados antes: o PDF quebra
            // "Pesquisador Estrangeiro" em dois itens de texto com o mesmo y, e casar
            // cada pedaco com o numero da linha criava duas categorias — "Pesquisador"
            // e "Estrangeiro" —, ambas com a mesma quantidade, inflando o total.
            if (quadroGeral.length === 0) {
                const linhasCat = [];
                categorias.forEach(c => {
                    const alvo = linhasCat.find(l => Math.abs(l.y - c.y) <= 4);
                    if (alvo) alvo.partes.push(c);
                    else linhasCat.push({ y: c.y, partes: [c] });
                });
                linhasCat.forEach(l => {
                    const texto = l.partes
                        .slice()
                        .sort((a, b) => a.x - b.x)      // remonta a linha na ordem de leitura
                        .map(p => p.texto)
                        .join(' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    const n = numeros.find(v => Math.abs(v.y - l.y) <= 4);
                    if (texto && n) quadroGeral.push({ categoria: texto, quantidade: n.valor });
                });
            }
        }
        return quadroGeral;
    }

    // Instituicao de vinculo e titulacao do proponente, do cabecalho da pagina 1. O
    // bloco e uma tabela de duas colunas — rotulo a esquerda, valor a direita — e a
    // instituicao costuma ocupar varias linhas, entao a leitura acumula ate encontrar
    // o rotulo da secao seguinte. Devolve { instituicao, formacao }.
    function lerProponente(allLines) {
        const linhas = Array.isArray(allLines) ? allLines : [];
    let propInstLines = [];
    let page1PropFormacao = '';
    const page1Lines = linhas.filter(lineItems => lineItems.length > 0 && lineItems[0].page === 1);

    let isInstSection = false;
    page1Lines.forEach(lineItems => {
        const col1Str = lineItems.filter(i => i.x < 140).map(i => i.str).join(' ').trim().toUpperCase();
        const col2Str = lineItems.filter(i => i.x >= 140).map(i => i.str).join(' ').trim();

        if (col1Str.includes('FORMAÇÃO') || col1Str.includes('TITULAÇÃO')) {
            if (col2Str) page1PropFormacao = _formacao(col2Str);
        }

        const isInstLabel = col1Str === 'INSTITUIÇÃO' || col1Str === 'VÍNCULO:' || col1Str === 'INSTITUIÇÃO VÍNCULO:' || col1Str === 'VÍNCULO';

        if (isInstLabel) {
            isInstSection = true;
            if (col2Str) propInstLines.push(col2Str);
        } else if (isInstSection) {
            if (col1Str.includes('CHAMADA') || col1Str.includes('NOME') || col1Str.includes('COMITÊ') ||
                col1Str.includes('PROJETO') || col1Str.includes('SIGLA') || col1Str.includes('EQUIPE') ||
                col1Str.includes('PALAVRAS') || col1Str.includes('RESUMO') || col1Str.includes('CPF')) {
                isInstSection = false;
            } else if (col2Str) {
                propInstLines.push(col2Str);
            } else {
                isInstSection = false;
            }
        }
    });

    const propInst = propInstLines.join(' ').replace(/\s+/g, ' ').trim();

        return { instituicao: propInst, formacao: page1PropFormacao };
    }

    // ------------------------------------------------------------------
    // Planilha de julgamento
    // ------------------------------------------------------------------

    // Descobre em que coluna esta cada campo, a partir dos textos do cabecalho da
    // tabela de propostas. Recebe os textos ja extraidos — quem le o DOM e
    // picc_content — e devolve os indices.
    //
    // E o ponto mais fragil da leitura da planilha: a posicao das colunas muda
    // conforme o comite e conforme o que o usuario habilita na propria pagina, entao
    // nada pode ser fixo. Quando a Plataforma mudar os rotulos, e aqui que se ajusta.
    //
    // A ORDEM dos testes importa: "parecer tecnico" e verificado DEPOIS de "parecer
    // ad hoc" porque os dois comecam com "parecer", e o primeiro roubaria a coluna do
    // segundo. "proponente" exclui "uf" pelo mesmo motivo, ja que existe cabecalho
    // "UF do proponente".
    function colunasDaPlanilha(textosDoCabecalho) {
        const col = {
            processo: -1, proponente: -1, uf: -1, instituicao: -1,
            chamada: -1, parecerAdHoc: -1, parecerTecnico: -1, acoes: -1
        };

        // A PRIMEIRA ocorrencia vence: se um rotulo aparecer duas vezes, a coluna da
        // esquerda e a que vale. Sem isto, um cabecalho repetido levaria a leitura
        // para a coluna mais a direita, que costuma ser um resumo ou um total.
        (Array.isArray(textosDoCabecalho) ? textosDoCabecalho : []).forEach((bruto, idx) => {
            const texto = String(bruto || '').trim().toLowerCase();
            const jaAchou = (campo) => col[campo] !== -1;
            if (texto.includes('processo') || texto.includes('nº do processo') || texto.includes('n° do processo')) {
                if (!jaAchou('processo')) col.processo = idx;
            } else if (texto.includes('proponente') && !texto.includes('uf')) {
                if (!jaAchou('proponente')) col.proponente = idx;
            } else if (texto.includes('uf')) {
                if (!jaAchou('uf')) col.uf = idx;
            } else if (texto.includes('institui')) {
                if (!jaAchou('instituicao')) col.instituicao = idx;
            } else if (texto.includes('chamada') || texto.includes('edital')) {
                if (!jaAchou('chamada')) col.chamada = idx;
            } else if (texto.includes('parecer ad') || texto.includes('parecer adhoc') || texto.includes('parecer ad-hoc')) {
                if (!jaAchou('parecerAdHoc')) col.parecerAdHoc = idx;
            } else if (texto.includes('parecer téc') || texto.includes('parecer tec')) {
                if (!jaAchou('parecerTecnico')) col.parecerTecnico = idx;
            } else if (texto.includes('açõ') || texto.includes('acoes')) {
                if (!jaAchou('acoes')) col.acoes = idx;
            }
        });

        // Posicoes historicas, para o caso de o cabecalho nao ser reconhecido. So
        // valem para os quatro campos que sempre existiram na mesma ordem; os demais
        // ficam em -1 e quem le trata a ausencia.
        if (col.processo === -1) col.processo = 1;
        if (col.proponente === -1) col.proponente = 2;
        if (col.uf === -1) col.uf = 3;
        if (col.instituicao === -1) col.instituicao = 4;

        return col;
    }

    raiz.JCRPiccParser = {
        itensDoPdf: itensDoPdf,
        colunasDaPlanilha: colunasDaPlanilha,
        lerTituloResumo: lerTituloResumo,
        lerEquipe: lerEquipe,
        lerQuadroGeral: lerQuadroGeral,
        lerProponente: lerProponente,
        // puras, expostas para uso e para teste
        _edital: _edital,
        _faixa: _faixa,
        _processo: _processo,
        _protocolo: _protocolo,
        _nomeProponente: _nomeProponente,
        _ehUrlLattes: _ehUrlLattes,
        _formacao: _formacao,
        _ehBolsaValida: _ehBolsaValida,
        _pareceInstituicao: _pareceInstituicao,
        _instituicaoExecutora: _instituicaoExecutora,
        _anexos: _anexos
    };
})(typeof window !== 'undefined' ? window : globalThis);
