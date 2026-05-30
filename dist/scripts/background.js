function extractMetrics() {
    const pageUrl = window.location.href;
    const pageTitle = document.title;
    console.log(`[RID Extraction Script] Injected and started on: ${pageUrl} (${pageTitle})`);
    
    return new Promise((resolve) => {
        try {
            let attempts = 0;
            const interval = setInterval(() => {
                try {
                    attempts++;
                    
                    const blocks = document.querySelectorAll('.wat-author-metric-inline-block');
                    if (blocks.length > 0) {
                        const stats = {
                            hIndex: null,
                            publications: null,
                            wosPublications: null,
                            sumOfTimesCited: null,
                            sumOfTimesCitedWithoutSelf: null,
                            beamplotPercentile: null
                        };

                        blocks.forEach(block => {
                            const valueEl = block.querySelector('.wat-author-metric');
                            const descEl = block.querySelector('.wat-author-metric-descriptor');
                            const subDescEl = block.querySelector('.wat-author-metric-sub-descriptor');

                            if (valueEl && descEl) {
                                const valText = valueEl.textContent.trim().replace(/,/g, '');
                                const val = parseInt(valText, 10);
                                const desc = descEl.textContent.trim();
                                const subDesc = subDescEl ? subDescEl.textContent.trim() : '';

                                if (/^H-Index$/i.test(desc)) {
                                    stats.hIndex = isNaN(val) ? 0 : val;
                                } else if (/^Publications$/i.test(desc)) {
                                    stats.publications = isNaN(val) ? 0 : val;
                                } else if (/^Sum of Times Cited$/i.test(desc)) {
                                    if (/without self-citations/i.test(subDesc)) {
                                        stats.sumOfTimesCitedWithoutSelf = isNaN(val) ? 0 : val;
                                    } else if (!subDesc) {
                                        stats.sumOfTimesCited = isNaN(val) ? 0 : val;
                                    }
                                }
                            }
                        });

                        const summaryItems = document.querySelectorAll('.summary-item');
                        summaryItems.forEach(item => {
                            const labelEl = item.querySelector('.summary-label');
                            const countEl = item.querySelector('.summary-count');
                            if (labelEl && countEl) {
                                const labelText = labelEl.textContent.trim();
                                if (/^Publications indexed in Web of Science$/i.test(labelText)) {
                                    const valText = countEl.textContent.trim().replace(/,/g, '');
                                    const val = parseInt(valText, 10);
                                    stats.wosPublications = isNaN(val) ? 0 : val;
                                }
                            }
                        });

                        const beamplotImgs = document.querySelectorAll('image[aria-label*="annualCitationDot"]');
                        console.log(`[RID Extraction Script] Found ${beamplotImgs.length} beamplot images with 'annualCitationDot'.`);
                        
                        if (beamplotImgs.length > 0) {
                            const beamplotImg = beamplotImgs[beamplotImgs.length - 1];
                            const ariaLabel = beamplotImg.getAttribute('aria-label');
                            console.log(`[RID Extraction Script] Last beamplot image aria-label:`, ariaLabel);
                            
                            const bpMatch = ariaLabel ? ariaLabel.match(/x,\s*([\d.]+)/i) : null;
                            if (bpMatch) {
                                stats.beamplotPercentile = parseFloat(bpMatch[1]);
                                console.log(`[RID Extraction Script] Extracted percentile:`, stats.beamplotPercentile);
                            } else {
                                console.log(`[RID Extraction Script] Failed to parse percentile from aria-label.`);
                            }
                        } else {
                            const allImages = document.querySelectorAll('image');
                            console.log(`[RID Extraction Script] Total <image> elements on page: ${allImages.length}`);
                            if (allImages.length > 0) {
                                const labels = Array.from(allImages).slice(-5).map(img => img.getAttribute('aria-label'));
                                console.log(`[RID Extraction Script] Last 5 <image> aria-labels:`, labels);
                            }
                            
                            // Let's also check for specific elements that Highcharts or similar libraries might use
                            const genericElements = document.querySelectorAll('[aria-label*="citation"]');
                            console.log(`[RID Extraction Script] Total elements with 'citation' in aria-label: ${genericElements.length}`);
                            if (genericElements.length > 0) {
                                const gLabels = Array.from(genericElements).slice(-5).map(el => el.getAttribute('aria-label'));
                                console.log(`[RID Extraction Script] Last 5 'citation' aria-labels:`, gLabels);
                            }
                        }
                        
                        // Wait for critical stats, wosPublications, and the beamplot percentile.
                        // Highcharts may take a few seconds to render the beamplot image elements.
                        // We allow up to 30 attempts (15 seconds) before giving up and using whatever we have.
                        const hasCriticalStats = stats.sumOfTimesCited !== null;
                        const hasWosPubs = stats.wosPublications !== null;
                        const hasBeamplot = stats.beamplotPercentile !== null;
                        
                        // Check if beamplot is locked behind premium access (user logged out or lacks subscription)
                        const premiumOverlay = document.querySelector('.overlay-message');
                        const isPremiumLocked = premiumOverlay && premiumOverlay.textContent.includes('premium feature');
                        if (isPremiumLocked) {
                            console.log(`[RID Extraction Script] Premium feature overlay detected. Beamplot will not load.`);
                        }

                        // If beamplot or wosPublications don't show up within 15 attempts (7.5s), we stop waiting.
                        const isReady = hasCriticalStats && 
                                        (hasWosPubs || attempts > 15) && 
                                        (hasBeamplot || isPremiumLocked || attempts > 15);
                                        
                        // Absolute max 20 attempts (10s) once critical stats are found, to avoid hanging if logged out.
                        if (isReady || attempts > 20) {
                            console.log(`[RID Extraction Script] Finalizing with stats:`, stats);
                            clearInterval(interval);
                            resolve({ success: true, stats, url: pageUrl });
                        }
                    } else if (attempts > 50) { // 25 seconds timeout
                        console.error(`[RID Extraction Script] Timeout on ${pageUrl}. Title: ${pageTitle}`);
                        clearInterval(interval);
                        resolve({ 
                            success: false, 
                            error: "Timeout waiting for metrics to render.",
                            url: pageUrl,
                            title: pageTitle,
                            bodySnippet: document.body.innerText.substring(0, 500)
                        });
                    }
                } catch (e) {
                    console.error(`[RID Extraction Script] Error during interval:`, e);
                    clearInterval(interval);
                    resolve({ success: false, error: e.message, url: pageUrl });
                }
            }, 500);
        } catch (e) {
            console.error(`[RID Extraction Script] Fatal error:`, e);
            resolve({ success: false, error: e.message, url: pageUrl });
        }
    });
}

 chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'fetch_rid_stats' && request.url) {
        console.log(`[RID Extraction Service Worker] Request started for URL: ${request.url}`);
        
        let tabId = null;
        let extractionStarted = false;
        let cleanupDone = false;

        const cleanup = (targetTabId, listener) => {
            if (cleanupDone) return;
            cleanupDone = true;
            if (listener) chrome.tabs.onUpdated.removeListener(listener);
            if (targetTabId) chrome.tabs.remove(targetTabId).catch(() => {});
        };

        const processTab = (targetTabId, url, listener) => {
            if (extractionStarted) return;
            
            if (url.includes('webofscience.com') || url.includes('researcherid.com')) {
                console.log(`[RID Extraction Service Worker] Target reached: ${url}. Injecting script...`);
                extractionStarted = true;
                
                setTimeout(() => {
                    chrome.scripting.executeScript({
                        target: { tabId: targetTabId },
                        func: extractMetrics
                    }, (results) => {
                        if (chrome.runtime.lastError || !results || !results[0]) {
                            const err = chrome.runtime.lastError?.message || "Execution failed";
                            console.error("[RID Extraction Service Worker] Error:", err);
                            sendResponse({ success: false, error: err });
                        } else {
                            console.log(`[RID Extraction Service Worker] Success:`, results[0].result);
                            sendResponse(results[0].result);
                        }
                        cleanup(targetTabId, listener);
                    });
                }, 1500); // Increased buffer to 1.5s
            }
        };

        let listener = (updatedTabId, changeInfo, updatedTab) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                processTab(tabId, updatedTab.url, listener);
            }
        };

        chrome.tabs.onUpdated.addListener(listener);

        chrome.tabs.create({ url: request.url, active: false }, (tab) => {
            tabId = tab.id;
            
            // Safety timeout
            setTimeout(() => {
                if (!extractionStarted) {
                    console.error("[RID Extraction Service Worker] Tab load timeout (30s).");
                    sendResponse({ success: false, error: "Tab load timeout (30s)." });
                    cleanup(tabId, listener);
                }
            }, 30000);
        });

        return true; 
    }
});
