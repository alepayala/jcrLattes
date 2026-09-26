/**
 * Leitura das publicações do Currículo Lattes (visualizacv.do).
 *
 * Só LÊ: recebe o elemento de uma publicação e devolve os dados. Não escreve na
 * página, não injeta anotação, não guarda nada. A anotação visual, os atributos
 * data-* e o separador de ano continuam em content.js, que chama este módulo.
 *
 * O objetivo é que a próxima mudança de formato do Lattes se resolva aqui, num
 * arquivo pequeno e com as regras isoladas, em vez de dentro do laço que também
 * desenha a página. É o mesmo desenho de producoes_parser.js, que faz o mesmo
 * papel para a página "Produções e Orientações" do efomento.
 *
 * As funções com prefixo _ são puras (texto → dados) e por isso testáveis em
 * Node; as que recebem um elemento precisam de DOM e são verificadas abrindo um
 * currículo salvo no navegador.
 */
(function (raiz) {
    'use strict';

    // A partir de quantos autores um artigo conta como grande colaboração. O Lattes
    // lista até 20 nomes antes de escrever "et al", então quem tem "et al" tem ao
    // menos 21. Ver AUTORES_GRANDE_COLABORACAO em producoes_parser.js: as duas
    // fontes precisam concordar.
    const AUTORES_GRANDE_COLABORACAO = 21;

    function decodificarEntidades(texto) {
        return String(texto || '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ');
    }

    // "et.al" é procurado sem variações, de propósito: o Lattes escreve exatamente
    // assim, e afrouxar isso já fez artigos comuns virarem grande colaboração.
    function _ehGrandeColaboracao(texto) {
        const t = String(texto || '');
        return t.includes('et.al') || t.toUpperCase().includes('COLLABORATION');
    }

    function _anoDoTexto(texto) {
        const m = String(texto || '').match(/\b(19|20)\d{2}\b/);
        return m ? parseInt(m[0], 10) : NaN;
    }

    // Conta os autores do trecho que antecede o título. Só entram partes com
    // vírgula, porque é o que separa sobrenome de iniciais ("SILVA, J.") — sem
    // isso, restos de pontuação virariam autores.
    function _contarAutores(textoAutores) {
        const autores = [];
        String(textoAutores || '').split(';').forEach(parte => {
            const p = parte.replace(/^\d+\s*\.\s*/, '').trim();
            if (!p) return;
            if (p.startsWith('et.al') || p.toUpperCase().includes('COLLABORATION')) return;
            if (p.includes(',')) autores.push(p);
        });
        return autores;
    }

    // Posição do pesquisador na lista. Primeiro tenta o nome que o Lattes destaca em
    // negrito; se não achar, tenta os apelidos declarados no currículo.
    function _ordemDoAutor(autores, destacado, apelidos) {
        const lista = Array.isArray(autores) ? autores : [];
        if (destacado) {
            for (let i = 0; i < lista.length; i++) {
                if (lista[i].toUpperCase().includes(String(destacado).toUpperCase())) return i + 1;
            }
        }
        if (Array.isArray(apelidos) && apelidos.length > 0) {
            for (let i = 0; i < lista.length; i++) {
                const autor = lista[i].toUpperCase();
                if (apelidos.some(a => autor.includes(String(a).toUpperCase()))) return i + 1;
            }
        }
        return -1;
    }

    // O atributo cvuri carrega os metadados do artigo numa querystring.
    function _dadosDoCvuri(cvuri) {
        const texto = decodificarEntidades(cvuri);
        const fora = { titulo: '', periodico: '', issn: '', doi: '' };
        if (!texto) return fora;

        const tituloM = texto.match(/[?&]titulo=([^&]+)/);
        if (tituloM) fora.titulo = tituloM[1].trim();
        const periM = texto.match(/[?&]nomePeriodico=([^&]+)/);
        if (periM) fora.periodico = periM[1].trim();

        texto.split(/\?(?!&)|&(?=\w+)/).forEach(item => {
            if (item.includes('issn=')) {
                const issn = item.split('issn=')[1];
                if (issn && issn.length >= 8) fora.issn = issn.substring(0, 4) + '-' + issn.substring(4, 8);
            }
            if (item.includes('doi=')) fora.doi = item.split('doi=')[1];
        });
        return fora;
    }

    // O balão do JCR traz o nome do periódico e o fator de impacto num texto só:
    // "Nome (ISSN)<br />Fator de impacto (JCR 2024): 3.5"
    function _jcrDoTitulo(tituloJcr) {
        const t = String(tituloJcr || '');
        const fora = { journalName: '', jcrYear: null, impactFactor: null };
        if (!t) return fora;

        const parte = t.split(/<br/i)[0]
            .split(/ - Fator de [Ii]mpacto/)[0]
            .replace(/\s*\([0-9X\-]{4,}\)\s*$/, '')
            .trim();
        if (parte) fora.journalName = parte;

        const m = t.match(/Fator de impacto \(JCR (\d{4})\): ([\d\.]+)/);
        if (m && m[2]) {
            fora.jcrYear = m[1];
            fora.impactFactor = m[2];
        }
        return fora;
    }

    // Faixa de JCR do artigo. Recebe os limiares porque eles são configuráveis.
    //
    // Mesma conta de JCRReportUtils.faixaDeJcr, com um vocabulário diferente: aqui o
    // valor vai para o atributo data-jcr-level do DOM da página do Lattes, onde o CSS
    // e os filtros já esperam 'none'; lá o vocabulário é o das estatísticas ('noJcr').
    // Se a regra de limiar mudar, tem de mudar nos dois.
    function _faixaJcr(impactFactor, alto, baixo) {
        const v = parseFloat(impactFactor);
        if (!impactFactor || isNaN(v) || v <= 0) return 'none';
        if (v >= alto) return 'high';
        if (v >= baixo) return 'mid';
        return 'low';
    }

    // Nome que o Lattes destaca em negrito, descartando o que é numeração do item,
    // rótulo de citação ou valor numérico.
    function _autorDestacado(elemento) {
        const celula = elemento.querySelector('.layout-cell-11');
        if (!celula) return '';
        const negritos = celula.querySelectorAll('b');
        for (const b of negritos) {
            const texto = b.innerText.trim();
            if (/^\d+\.$/.test(texto)) continue;
            if (texto.includes('Citações') || texto.includes('Fator de Impacto')) continue;
            if (/^[\d\.]+$/.test(texto)) continue;
            return texto.replace(/;$/, '').trim();
        }
        return '';
    }

    // Citações ficam num <span class="numero-citacao"> logo após o ícone da base.
    function _citacoes(elemento, trechoSrc) {
        const img = elemento.querySelector(`img[src*="${trechoSrc}"]`);
        if (!img) return 0;
        const span = img.nextElementSibling;
        if (span && span.classList && span.classList.contains('numero-citacao')) {
            const n = parseInt(span.textContent, 10);
            return isNaN(n) ? 0 : n;
        }
        return 0;
    }

    /**
     * Lê UMA publicação. Devolve só dados — nenhum HTML, nenhuma escrita na página.
     *
     * opcoes.apelidos: nomes pelos quais o pesquisador assina, para achar sua ordem
     * opcoes.jcrAlto / opcoes.jcrBaixo: limiares da faixa de JCR
     */
    function lerPublicacao(elemento, opcoes) {
        if (!elemento) return null;
        const op = opcoes || {};

        const dados = {
            year: NaN,
            issn: '',
            journalName: '',
            paperTitle: '',
            impactFactor: null,
            jcrYear: null,
            wosCitations: 0,
            scopusCitations: 0,
            hasEtAl: false,
            isFirstAuthor: false,
            isLastAuthor: false,
            authorCount: 0,
            authorRank: -1,
            doi: '',
            reference: ''
        };

        // Texto limpo ANTES de qualquer anotação injetada na página.
        const bruto = elemento.innerText.replace(/\s+/g, ' ').trim();
        dados.reference = bruto;

        const spanAno = elemento.querySelector("span[class='informacao-artigo'][data-tipo-ordenacao='ano']");
        dados.year = spanAno ? parseInt(spanAno.textContent, 10) : _anoDoTexto(elemento.innerText);

        dados.hasEtAl = _ehGrandeColaboracao(elemento.innerText);

        const elemCvuri = elemento.querySelector('[cvuri]');
        const doCvuri = elemCvuri ? _dadosDoCvuri(elemCvuri.getAttribute('cvuri')) : { titulo: '', periodico: '', issn: '', doi: '' };
        dados.paperTitle = doCvuri.titulo;
        dados.journalName = doCvuri.periodico;

        // A lista de autores termina onde o título começa; sem esse corte, título e
        // periódico entrariam na contagem.
        let textoAutores = bruto;
        if (doCvuri.titulo) {
            const i = bruto.indexOf(doCvuri.titulo);
            if (i !== -1) textoAutores = bruto.substring(0, i).replace(/\s*\.\s*$/, '').trim();
        }
        const autores = _contarAutores(textoAutores);
        const ordem = _ordemDoAutor(autores, _autorDestacado(elemento), op.apelidos);

        dados.authorRank = ordem;
        // Primeiro autor conta mesmo em grande colaboração; último, não — o "et al"
        // esconde quem fecha a lista.
        if (ordem === 1) dados.isFirstAuthor = true;
        dados.authorCount = dados.hasEtAl ? Math.max(autores.length, AUTORES_GRANDE_COLABORACAO) : autores.length;
        if (ordem !== -1 && ordem === autores.length && !dados.hasEtAl && autores.length > 1) {
            dados.isLastAuthor = true;
        }

        dados.wosCitations = _citacoes(elemento, 'isi.gif');
        dados.scopusCitations = _citacoes(elemento, 'scopus.png');

        const elemJcr = elemento.querySelector('.ajaxJCR');
        if (elemJcr) {
            const doJcr = _jcrDoTitulo(elemJcr.getAttribute('original-title'));
            if (!dados.journalName) dados.journalName = doJcr.journalName;
            if (doJcr.impactFactor) {
                dados.jcrYear = doJcr.jcrYear;
                dados.impactFactor = doJcr.impactFactor;
            }
        }

        if (elemCvuri) {
            dados.issn = doCvuri.issn;
            dados.doi = doCvuri.doi;
            if (!dados.doi) {
                const elemDoi = elemento.querySelector('a.icone-doi');
                if (elemDoi && elemDoi.href) {
                    const m = elemDoi.href.match(/doi\.org\/(.+)$/);
                    if (m) dados.doi = m[1];
                }
            }
        }

        return dados;
    }

    // ------------------------------------------------------------------
    // Orientações, patentes e trabalhos em eventos
    // ------------------------------------------------------------------
    // Cada seção é um <a name="..."> seguido de irmãos até a próxima âncora. Recebem o
    // documento por parâmetro em vez de usar o global, para poderem ser apontadas a um
    // currículo salvo.

    // O ano da orientação é o ÚLTIMO do texto: o primeiro costuma ser o do início do
    // vínculo, e o que interessa é a conclusão.
    function _ultimoAno(texto) {
        const anos = String(texto || '').match(/\b(?:19|20)\d{2}\b/g);
        if (!anos || anos.length === 0) return NaN;
        return parseInt(anos[anos.length - 1], 10);
    }

    // Área e instituição saem do trecho que vem DEPOIS do último ano, em três
    // tentativas, da mais específica para a mais frouxa: "(Área) - Instituição",
    // depois "natureza - Instituição", e por fim o texto que segue "ano. ".
    function _areaEInstituicao(textoLimpo) {
        const limpo = String(textoLimpo || '');
        const fora = { area: '', institution: '' };

        let trecho = limpo;
        const anos = limpo.match(/\b(?:19|20)\d{2}\b/g);
        if (anos && anos.length > 0) {
            const ultimo = anos[anos.length - 1];
            trecho = limpo.substring(limpo.lastIndexOf(ultimo) + 4);
        }

        const comArea = trecho.match(/\(([^)]+)\)\s*-\s*([^,.]+)/);
        if (comArea) {
            fora.area = comArea[1].trim();
            fora.institution = comArea[2].trim();
            return fora;
        }

        const porNatureza = limpo.match(/(?:natureza|natureza\.)\s*-\s*([^,.]+)/);
        if (porNatureza) {
            fora.institution = porNatureza[1].trim();
            return fora;
        }

        let ultimoTrecho = null;
        const re = /\b(?:19|20)\d{2}\.\s+([^,.]+)/g;
        let m;
        while ((m = re.exec(limpo)) !== null) ultimoTrecho = m[1];
        if (ultimoTrecho) fora.institution = ultimoTrecho.trim();
        return fora;
    }

    function _ehCoorientacao(texto) {
        const t = String(texto || '');
        return t.includes('Coorientador') || t.includes('Co-orientador');
    }

    function lerOrientacoes(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const orientacoes = { inCourse: {}, concluded: {}, raw: [] };
        if (!d) return orientacoes;

        const PARAR = ['orientacoesconcluidas', 'producaobibliografica', 'producaotecnica',
                       'outraproducao', 'dadoscomplementares'];

        const secao = (nomeAncora, destino, comAno) => {
            const ancora = Array.from(d.querySelectorAll('a[name]')).find(
                a => a.getAttribute('name').toLowerCase() === nomeAncora.toLowerCase());
            if (!ancora) return;

            let irmao = ancora.nextElementSibling;
            let categoria = '';

            while (irmao) {
                if (irmao.classList && irmao.classList.contains('cita-artigos')) {
                    categoria = irmao.textContent.trim();
                } else if (irmao.classList && irmao.classList.contains('layout-cell-11')) {
                    if (categoria) {
                        const texto = irmao.innerText;
                        const limpo = texto.replace(/\s+/g, ' ').trim();
                        const chave = _ehCoorientacao(texto) ? `${categoria} (Coorientador)` : categoria;

                        if (!destino[chave]) destino[chave] = comAno ? [] : 0;

                        let ano = NaN;
                        if (comAno) {
                            ano = _ultimoAno(texto);
                            destino[chave].push(ano);
                        } else {
                            destino[chave]++;
                        }

                        const onde = _areaEInstituicao(limpo);
                        orientacoes.raw.push({
                            category: chave,
                            status: comAno ? 'Concluída' : 'Em andamento',
                            year: ano,
                            area: onde.area,
                            institution: onde.institution,
                            reference: limpo
                        });
                    }
                } else if (irmao.tagName === 'A' && irmao.hasAttribute('name')) {
                    const nome = (irmao.getAttribute('name') || '').toLowerCase();
                    if (nome && PARAR.indexOf(nome) !== -1) break;
                } else if (irmao.querySelector && irmao.querySelector('div.title-wrapper')) {
                    break;
                }
                irmao = irmao.nextElementSibling;
            }
        };

        secao('Orientacaoemandamento', orientacoes.inCourse, false);
        secao('Orientacoesconcluidas', orientacoes.concluded, true);
        return orientacoes;
    }

    // Uma patente lista várias etapas no formato "Status: dd/mm/yyyy". A data de
    // registro é descartada porque não é etapa de tramitação.
    function _etapasDaPatente(texto) {
        const etapas = [];
        const re = /([A-Za-z\u00C0-\u00FF\s]+):\s*(\d{2}\/\d{2}\/\d{4})/g;
        let m;
        while ((m = re.exec(String(texto || ''))) !== null) {
            const status = m[1].trim();
            if (status.toLowerCase() === 'data de registro') continue;
            const p = m[2].split('/');
            etapas.push({
                status: status,
                date: new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10)),
                year: parseInt(p[2], 10)
            });
        }
        return etapas;
    }

    function _numeroDoRegistro(texto) {
        const m = String(texto || '').match(/N[úu]mero do registro:\s*([^,]+)/i);
        return m ? m[1].trim() : '';
    }

    function lerPatentes(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const patentes = [];
        if (!d) return patentes;

        const ancora = d.querySelector('a[name="PatentesRegistros"]');
        if (!ancora) return patentes;

        let irmao = ancora.nextElementSibling;
        while (irmao) {
            if (irmao.classList && irmao.classList.contains('layout-cell-12') && irmao.classList.contains('data-cell')) {
                irmao.querySelectorAll('.layout-cell-11').forEach(item => {
                    const texto = item.innerText;
                    const etapas = _etapasDaPatente(texto);
                    if (etapas.length === 0) return;
                    // a etapa mais recente define a situação atual
                    etapas.sort((a, b) => b.date - a.date);
                    patentes.push({
                        currentStatus: etapas[0].status,
                        year: etapas[0].year,
                        allStages: etapas,
                        registro: _numeroDoRegistro(texto),
                        reference: texto.replace(/\s+/g, ' ').trim()
                    });
                });
            }
            irmao = irmao.nextElementSibling;
        }
        return patentes;
    }

    // Nos eventos o ano aparece antes do parêntese que abre o tipo do trabalho.
    function _anoDoEvento(texto) {
        const m = String(texto || '').match(/\b(19|20)\d{2}\b\.\s*\(/);
        return m ? parseInt(m[0], 10) : NaN;
    }

    // "Tipo de participação: Apresentação Oral. Forma de participação..." — corta no
    // que vem depois e limpa a pontuação final.
    function _tipoDeParticipacao(texto) {
        const m = String(texto || '').match(/Tipo de participação:\s*([^\n]+)/);
        if (!m) return 'Desconhecido';
        let t = m[1].replace(/<[^>]*>/g, '').trim();
        t = t.split(/(?:forma de particip|homepage)/i)[0];
        return t.replace(/[.;\s]+$/, '').trim();
    }

    function lerEventos(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        const eventos = [];
        if (!d) return eventos;

        const ancora = d.querySelector('a[name="Eventos"]');
        if (!ancora) return eventos;

        const PARAR = ['Producaobibliografica', 'Producaotecnica', 'Outraproducao', 'Dadoscomplementares'];
        let irmao = ancora.nextElementSibling;
        while (irmao) {
            if (irmao.classList && irmao.classList.contains('layout-cell-12') && irmao.classList.contains('data-cell')) {
                irmao.querySelectorAll('.layout-cell-11').forEach(item => {
                    const texto = item.innerText;
                    const ano = _anoDoEvento(texto);
                    const tipo = _tipoDeParticipacao(texto);
                    if (!isNaN(ano) && tipo !== 'Desconhecido') {
                        eventos.push({ year: ano, type: tipo, reference: texto.replace(/\s+/g, ' ').trim() });
                    }
                });
            }
            if (irmao.tagName === 'A' && irmao.hasAttribute('name')) {
                if (PARAR.indexOf(irmao.getAttribute('name')) !== -1) break;
            } else if (irmao.querySelector && irmao.querySelector('div.title-wrapper')) {
                break;
            }
            irmao = irmao.nextElementSibling;
        }
        return eventos;
    }

    // ------------------------------------------------------------------
    // Identificação do pesquisador
    // ------------------------------------------------------------------

    // Bolsa a partir da tarja do topo do currículo. Devolve "PQ 1A", "DT 2", só a
    // sigla quando o nível não aparece, ou '' quando não é bolsa de produtividade.
    // O nível explícito ("Nível: 1A") tem prioridade sobre o primeiro código solto do
    // texto, que pode ser qualquer número da frase.
    function _bolsaDoTexto(texto) {
        const t = String(texto || '');
        if (!t) return '';

        let sigla = '';
        if (t.includes('Produtividade em Pesquisa')) {
            sigla = 'PQ';
        } else if (t.includes('Produtividade em Desenvolvimento Tecnológico') || t.includes('Desen. Tec.')) {
            sigla = 'DT';
        }
        if (!sigla) return '';

        const NIVEIS = /(1A|1B|1C|1D|1|2|3|A|B|C|SR)/;
        const explicito = t.match(new RegExp('N[íi]vel\\s*[:-]?\\s*' + NIVEIS.source + '\\b', 'i'));
        let nivel = '';
        if (explicito) {
            nivel = explicito[1].toUpperCase();
        } else {
            const solto = t.match(new RegExp('\\b' + NIVEIS.source + '\\b', 'i'));
            nivel = solto ? solto[1].toUpperCase() : '';
        }
        return nivel ? `${sigla} ${nivel}` : sigla;
    }

    // "AYALA, A. P.; AYALA, ALEJANDRO" → lista de apelidos
    function _apelidosDoTexto(texto) {
        return String(texto || '').split(';').map(n => n.trim()).filter(n => n.length > 0);
    }

    // Nome, endereço do CV, ResearcherID e bolsa. Tolera as três formas em que o
    // Lattes apresenta o cabeçalho: h2.nome, div.nome (versão de impressão) e, em
    // último caso, o primeiro h2 da página.
    function lerIdentificacao(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) return { name: '', link: '' };

        let elemNome = d.querySelector("h2[class='nome']") || d.querySelector("div[class='nome']");
        if (!elemNome) {
            const h2s = d.querySelectorAll('h2');
            if (h2s.length > 0) elemNome = h2s[0];
        }
        if (!elemNome) return { name: '', link: '' };

        const name = elemNome.textContent.trim();

        // A tarja da bolsa é o SEGUNDO elemento de nome do cabeçalho.
        let fellowshipText = '';
        const todosNomes = d.querySelectorAll("h2[class='nome'], div[class='nome']");
        if (todosNomes.length > 1) fellowshipText = todosNomes[1].textContent.trim();
        const fellowshipString = _bolsaDoTexto(fellowshipText);

        let link = '';
        const elemLink = d.querySelector("ul[class='informacoes-autor']");
        if (elemLink) {
            const m = elemLink.innerText.match(/\bhttps?:\/\/\S+/gi);
            if (m) link = m[0];
        } else {
            // versão de impressão: o endereço vem solto, depois de um rótulo
            const candidatos = d.querySelectorAll('span, td, div');
            for (const el of candidatos) {
                if (el.innerText && el.innerText.includes('Endereço para acessar este CV')) {
                    link = el.innerText.match(/\bhttps?:\/\/\S+/gi)?.[0] || '';
                    break;
                }
            }
        }

        let researcherIdLink = '';
        const ancoraRid = d.querySelector('a[href*="researcherid.com/rid/"]');
        if (ancoraRid) researcherIdLink = ancoraRid.href;

        return { name, link, researcherIdLink, fellowshipText, fellowshipString };
    }

    // Nomes pelos quais o pesquisador assina, usados para achar sua posição na lista
    // de autores. O currículo traz isso em "Nome em citações bibliográficas", que
    // aparece em dois layouts: tabela (antigo) e divs (atual).
    function lerApelidos(doc) {
        const d = doc || (typeof document !== 'undefined' ? document : null);
        if (!d) return [];
        const candidatos = [];

        d.querySelectorAll('td.campos').forEach(td => {
            if (td.innerText.includes('Nome em cita')) {
                const proximo = td.nextElementSibling;
                if (proximo && proximo.classList.contains('texto')) candidatos.push(proximo.innerText);
            }
        });

        if (candidatos.length === 0) {
            d.querySelectorAll('.layout-cell-pad-5').forEach(rotulo => {
                if (!rotulo.innerText.includes('Nome em cita')) return;
                const pai = rotulo.parentElement;
                if (!pai || !pai.classList.contains('layout-cell-3')) return;
                const proximo = pai.nextElementSibling;
                if (proximo && (proximo.classList.contains('layout-cell-9') || proximo.classList.contains('layout-cell-8'))) {
                    candidatos.push(proximo.innerText);
                }
            });
        }

        return candidatos.length > 0 ? _apelidosDoTexto(candidatos[0]) : [];
    }

    raiz.JCRLattesParser = {
        AUTORES_GRANDE_COLABORACAO: AUTORES_GRANDE_COLABORACAO,
        lerPublicacao: lerPublicacao,
        lerIdentificacao: lerIdentificacao,
        lerApelidos: lerApelidos,
        lerOrientacoes: lerOrientacoes,
        lerPatentes: lerPatentes,
        lerEventos: lerEventos,
        faixaJcr: _faixaJcr,
        decodificarEntidades: decodificarEntidades,
        // expostas para teste
        _ehGrandeColaboracao: _ehGrandeColaboracao,
        _anoDoTexto: _anoDoTexto,
        _contarAutores: _contarAutores,
        _ordemDoAutor: _ordemDoAutor,
        _dadosDoCvuri: _dadosDoCvuri,
        _jcrDoTitulo: _jcrDoTitulo,
        _faixaJcr: _faixaJcr,
        _ultimoAno: _ultimoAno,
        _areaEInstituicao: _areaEInstituicao,
        _ehCoorientacao: _ehCoorientacao,
        _etapasDaPatente: _etapasDaPatente,
        _numeroDoRegistro: _numeroDoRegistro,
        _anoDoEvento: _anoDoEvento,
        _tipoDeParticipacao: _tipoDeParticipacao,
        _bolsaDoTexto: _bolsaDoTexto,
        _apelidosDoTexto: _apelidosDoTexto
    };
})(typeof window !== 'undefined' ? window : globalThis);
