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

    raiz.JCRLattesParser = {
        AUTORES_GRANDE_COLABORACAO: AUTORES_GRANDE_COLABORACAO,
        lerPublicacao: lerPublicacao,
        faixaJcr: _faixaJcr,
        decodificarEntidades: decodificarEntidades,
        // expostas para teste
        _ehGrandeColaboracao: _ehGrandeColaboracao,
        _anoDoTexto: _anoDoTexto,
        _contarAutores: _contarAutores,
        _ordemDoAutor: _ordemDoAutor,
        _dadosDoCvuri: _dadosDoCvuri,
        _jcrDoTitulo: _jcrDoTitulo,
        _faixaJcr: _faixaJcr
    };
})(typeof window !== 'undefined' ? window : globalThis);
