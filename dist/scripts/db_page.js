document.addEventListener('DOMContentLoaded', async () => {
    if (typeof window !== 'undefined' && window.JCRDBTools) {
        const urlParams = new URLSearchParams(window.location.search);
        const isProcessoOnly = urlParams.get('view') !== 'cvs';
        // Passa a própria janela como alvo: viewDB() escreve via document.write().
        // Com null ela chamava window.open() sem gesto do usuário — o pop-up era
        // bloqueado (alerta "permita pop-ups") ou abria uma segunda aba, deixando
        // esta página em branco.
        await window.JCRDBTools.viewDB(window, { processOnly: isProcessoOnly });
    }
});
