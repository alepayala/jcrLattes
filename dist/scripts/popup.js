document.addEventListener('DOMContentLoaded', async () => {
    const btnPropostas = document.getElementById('btn-open-propostas');
    const btnCvs = document.getElementById('btn-open-cvs');

    const checkCaMemberAuth = () => {
        return new Promise((resolve) => {
            if (typeof chrome === 'undefined' || !chrome.storage?.local) { resolve(false); return; }
            chrome.storage.local.get(['jcr_ca_member_auth'], (result) => {
                if (chrome.runtime?.lastError || !result || !result['jcr_ca_member_auth']) {
                    resolve(false);
                    return;
                }
                const auth = result['jcr_ca_member_auth'];
                if (auth && auth.isCaMember === true && auth.validUntil && Date.now() < auth.validUntil) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
        });
    };

    const isCaValid = await checkCaMemberAuth();

    if (btnPropostas) {
        if (isCaValid) {
            btnPropostas.style.display = 'flex';
        } else {
            btnPropostas.style.display = 'none';
        }
    }

    if (btnPropostas) {
        btnPropostas.addEventListener('click', () => {
            if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
                chrome.tabs.create({ url: chrome.runtime.getURL('db.html?view=propostas') });
            }
        });
    }

    if (btnCvs) {
        btnCvs.addEventListener('click', () => {
            if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
                chrome.tabs.create({ url: chrome.runtime.getURL('db.html?view=cvs') });
            }
        });
    }
});
