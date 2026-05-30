// report_utils.js
// Shared utility functions for generating JCR Lattes reports

window.JCRReportUtils = {
  COLORS: {
    highJcr: '#3daa43ff',
    midJcr: '#a838caff',
    lowJcr: '#E65100',
    noJcr: '#e03535ff',
    authorRank: '#3daa43ff',
    authorCount: '#666',
    footerText: '#333',
    border: '#ddd',
    borderLight: '#eee',
    backgroundHeader: '#f2f2f2',
    backgroundSubHeader: '#f9f9f9',
    alertBorder: '#ccc',
    spinnerBorder: '#f3f3f3',
    spinnerAccent: '#3498db'
  },

  GRAPH_COLORS: {
    highJcr: '#2E7D32',
    midJcr: '#1565C0',
    lowJcr: '#E65100',
    noJcr: '#C62828'
  },

  formatNum: function(num) {
    return num.toFixed(2);
  },

  getAvg: function(sum, count) {
    return count > 0 ? this.formatNum(sum / count) : '0.00';
  },

  getSoftColor: function(hex, factor = 0.85) {
    let c = hex.startsWith('#') ? hex.substring(1) : hex;
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const rgb = parseInt(c, 16);
    let r = (rgb >> 16) & 0xff;
    let g = (rgb >> 8) & 0xff;
    let b = (rgb >> 0) & 0xff;
    r = Math.round(r + (255 - r) * factor);
    g = Math.round(g + (255 - g) * factor);
    b = Math.round(b + (255 - b) * factor);
    return `rgb(${r}, ${g}, ${b})`;
  },

  calculateReportStats: function(publications, patents, events, supervisions, declaredCitations, currentYear, customYears, startYearRecent, startYearLast10, startYearCustom, highJcr, lowJcr) {
    const createStatObj = () => ({ count: 0, sum: 0 });
    const createCitationObj = () => ({ wos: [], scopus: [] });
    const createPatentObj = () => ({ total: 0, statusCounts: {} });
    const createEventObj = () => ({ total: 0, typeCounts: {} });

    const createTotalStatObj = () => ({
      count: 0,
      sum: 0,
      countWithJcr: 0,
      gcCount: 0,
      firstAuthorCount: 0,
      lastAuthorCount: 0,
      sumIfDivAuthors: 0,
      sumAuthors: 0,
      sumAuthorsNonGc: 0,
      countNonGc: 0
    });

    const stats = {
      all: { high: createStatObj(), mid: createStatObj(), low: createStatObj(), noJcr: 0, total: createTotalStatObj(), citations: createCitationObj(), patents: createPatentObj(), events: createEventObj() },
      recent: { high: createStatObj(), mid: createStatObj(), low: createStatObj(), noJcr: 0, total: createTotalStatObj(), citations: createCitationObj(), patents: createPatentObj(), events: createEventObj() },
      last10: { high: createStatObj(), mid: createStatObj(), low: createStatObj(), noJcr: 0, total: createTotalStatObj(), citations: createCitationObj(), patents: createPatentObj(), events: createEventObj() },
      custom: { high: createStatObj(), mid: createStatObj(), low: createStatObj(), noJcr: 0, total: createTotalStatObj(), citations: createCitationObj(), patents: createPatentObj(), events: createEventObj() }
    };

    let minYear = currentYear;
    let maxYear = currentYear;

    if (publications && Array.isArray(publications)) {
      for (const pub of publications) {
        if (!isNaN(pub.year)) {
          if (pub.year < minYear) minYear = pub.year;
          if (pub.year > maxYear) maxYear = pub.year;
        }
        
        const impactFactorStr = pub.impactFactor !== undefined ? pub.impactFactor : pub.jif;
        
        let isFirstAuthor = pub.isFirstAuthor;
        if (isFirstAuthor === undefined) {
            isFirstAuthor = pub.authorRank === 1;
        }
        
        let isLastAuthor = pub.isLastAuthor;
        if (isLastAuthor === undefined) {
            isLastAuthor = (pub.authorRank === pub.authorCount && !pub.hasEtAl && pub.authorCount > 1);
        }
        
        let category = 'noJcr';
        let ifVal = 0;

        if (impactFactorStr !== null && impactFactorStr !== undefined && impactFactorStr !== 0 && impactFactorStr !== '') {
          ifVal = parseFloat(impactFactorStr);
          if (ifVal > 0) {
            if (ifVal >= highJcr) category = 'high';
            else if (ifVal >= lowJcr) category = 'mid';
            else category = 'low';
          } else {
            ifVal = 0;
            category = 'noJcr';
          }
        }

        const updateStats = (periodStats) => {
          if (category === 'noJcr') {
            periodStats.noJcr++;
          } else {
            periodStats[category].count++;
            periodStats[category].sum += ifVal;
            periodStats.total.sum += ifVal;
            periodStats.total.countWithJcr++;

            if (pub.authorCount > 0) {
              periodStats.total.sumIfDivAuthors += (ifVal / pub.authorCount);
            }
          }

          if (pub.authorCount > 0) {
            periodStats.total.sumAuthors += pub.authorCount;
          }
          periodStats.total.count++;
          
          if (pub.hasEtAl) {
            periodStats.total.gcCount++;
          } else {
            periodStats.total.countNonGc++;
            if (pub.authorCount > 0) {
              periodStats.total.sumAuthorsNonGc += pub.authorCount;
            }
          }
          
          if (isFirstAuthor) {
            periodStats.total.firstAuthorCount++;
          }
          if (isLastAuthor) {
            periodStats.total.lastAuthorCount++;
          }

          if (pub.wosCitations) periodStats.citations.wos.push(pub.wosCitations);
          if (pub.scopusCitations) periodStats.citations.scopus.push(pub.scopusCitations);
        };

        updateStats(stats.all);
        if (pub.year >= startYearRecent) updateStats(stats.recent);
        if (pub.year >= startYearLast10) updateStats(stats.last10);
        if (pub.year >= startYearCustom) updateStats(stats.custom);
      }
    }

    if (patents && Array.isArray(patents)) {
        for (const patent of patents) {
          const updatePatentStats = (periodStats) => {
            periodStats.patents.total++;
            const status = patent.currentStatus || 'Desconhecido';
            periodStats.patents.statusCounts[status] = (periodStats.patents.statusCounts[status] || 0) + 1;
          };
          updatePatentStats(stats.all);
          if (patent.year >= startYearRecent) updatePatentStats(stats.recent);
          if (patent.year >= startYearLast10) updatePatentStats(stats.last10);
          if (patent.year >= startYearCustom) updatePatentStats(stats.custom);
        }
    }

    if (events && Array.isArray(events)) {
        for (const event of events) {
          const updateEventStats = (periodStats) => {
            periodStats.events.total++;
            let type = event.type || 'Desconhecido';
            type = type.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
            periodStats.events.typeCounts[type] = (periodStats.events.typeCounts[type] || 0) + 1;
          };
          updateEventStats(stats.all);
          if (event.year >= startYearRecent) updateEventStats(stats.recent);
          if (event.year >= startYearLast10) updateEventStats(stats.last10);
          if (event.year >= startYearCustom) updateEventStats(stats.custom);
        }
    }

    const processCitations = (citationObj) => {
      const calculateHIndex = (citations) => {
        citations.sort((a, b) => b - a);
        let h = 0;
        for (let i = 0; i < citations.length; i++) {
          if (citations[i] >= i + 1) h = i + 1;
          else break;
        }
        return h;
      };
      const sum = (arr) => arr.reduce((a, b) => a + b, 0);
      return {
        wos: { sum: sum(citationObj.wos), hIndex: calculateHIndex(citationObj.wos) },
        scopus: { sum: sum(citationObj.scopus), hIndex: calculateHIndex(citationObj.scopus) }
      };
    };

    return {
      all: { ...stats.all, citations: processCitations(stats.all.citations) },
      recent: { ...stats.recent, citations: processCitations(stats.recent.citations) },
      last10: { ...stats.last10, citations: processCitations(stats.last10.citations) },
      custom: { ...stats.custom, citations: processCitations(stats.custom.citations) },
      supervisions: supervisions || {},
      patents: patents || { total: 0, statusCounts: {} },
      events: events || { total: 0, typeCounts: {} },
      declaredCitations: declaredCitations || null,
      highJcr,
      lowJcr,
      minYear,
      maxYear,
      customYears
    };
  },

  generateRow: function(label, data) {
    const bgTotal = '#f8f9fa';
    const bgHigh = this.getSoftColor(this.COLORS.highJcr, 0.85);
    const bgMid = this.getSoftColor(this.COLORS.midJcr, 0.85);
    const bgLow = this.getSoftColor(this.COLORS.lowJcr, 0.85);
    const bgNone = this.getSoftColor(this.COLORS.noJcr, 0.85);

    return `
      <tr style="border-bottom: 1px solid #ddd;">
        <td style="padding: 8px; text-align: left;">${label}</td>
        
        <td style="padding: 8px; border-left: 1px solid #eee; text-align: center; background-color: ${bgTotal};"><strong>${data.total.count}</strong></td>
        
        <td style="padding: 8px; border-left: 1px solid #eee; text-align: center; background-color: #ffffff;"><strong>${this.formatNum(data.total.sum)}</strong></td>
        <td style="padding: 8px; text-align: center; background-color: #ffffff;"><strong>${this.getAvg(data.total.sum, data.total.countWithJcr)}</strong></td>
        
        <td style="padding: 8px; border-left: 1px solid #eee; text-align: center; background-color: ${bgTotal};"><strong>${data.total.firstAuthorCount}</strong></td>
        <td style="padding: 8px; border-left: 1px solid #eee; text-align: center; background-color: ${bgTotal};"><strong>${data.total.lastAuthorCount}</strong></td>
        <td style="padding: 8px; border-left: 1px solid #eee; text-align: center; background-color: ${bgTotal};" title="Média de Autores (exclui GC)"><strong>${this.getAvg(data.total.sumAuthorsNonGc, data.total.countNonGc)}</strong></td>
        <td style="padding: 8px; border-left: 1px solid #ccc; text-align: center;"><strong>${data.total.gcCount}</strong></td>

        <td style="padding: 8px; border-left: 1px solid #eee; text-align: center; background-color: ${bgHigh};"><strong>${data.high.count}</strong></td>
        <td style="padding: 8px; text-align: center; background-color: ${bgHigh};">${this.formatNum(data.high.sum)}</td>
        <td style="padding: 8px; text-align: center; background-color: ${bgHigh};">${this.getAvg(data.high.sum, data.high.count)}</td>
        
        <td style="padding: 8px; border-left: 1px solid #eee; text-align: center; background-color: ${bgMid};"><strong>${data.mid.count}</strong></td>
        <td style="padding: 8px; text-align: center; background-color: ${bgMid};">${this.formatNum(data.mid.sum)}</td>
        <td style="padding: 8px; text-align: center; background-color: ${bgMid};">${this.getAvg(data.mid.sum, data.mid.count)}</td>
        
        <td style="padding: 8px; border-left: 1px solid #eee; text-align: center; background-color: ${bgLow};"><strong>${data.low.count}</strong></td>
        <td style="padding: 8px; text-align: center; background-color: ${bgLow};">${this.formatNum(data.low.sum)}</td>
        <td style="padding: 8px; text-align: center; background-color: ${bgLow};">${this.getAvg(data.low.sum, data.low.count)}</td>
        
        <td style="padding: 8px; border-left: 1px solid #eee; text-align: center; background-color: ${bgNone};"><strong>${data.noJcr}</strong></td>
      </tr>
    `;
  },

  generateHistogramHTML: function(publications, highVal = 7.0, lowVal = 1.5) {
    highVal = parseFloat(highVal);
    lowVal = parseFloat(lowVal);
    const allJcrValues = publications
      .map(pub => {
        const val = pub.impactFactor !== undefined ? pub.impactFactor : pub.jif;
        return val !== null && val !== undefined && val !== '' ? parseFloat(val) : 0;
      });

    const jcrZeroCount = allJcrValues.filter(v => v === 0).length;
    const jcrValues = allJcrValues.filter(v => v > 0);

    if (allJcrValues.length === 0) {
      return `
        <div style="height: 100%; display: flex; flex-direction: column; padding: 15px; margin-top: 10px; background-color: ${this.COLORS.backgroundSubHeader}; border-top: 1px solid ${this.COLORS.border}; box-sizing: border-box;">
          <div style="font-weight: bold; margin-bottom: 8px; color: ${this.COLORS.footerText};">Distribuição de JCR</div>
          <div style="display: flex; flex-grow: 1; align-items: center; justify-content: center; color: #666; font-size: 0.9em;">Sem dados de JCR</div>
        </div>
      `;
    }

    let maxJcr = jcrValues.length > 0 ? Math.ceil(Math.max(...jcrValues)) : 0;
    const binSize = maxJcr > 20 ? Math.ceil(maxJcr / 20) : 1;
    const numBins = maxJcr > 0 ? Math.ceil(maxJcr / binSize) : 0;

    const bins = new Array(numBins).fill(0);
    jcrValues.forEach(val => {
      let binIndex = Math.floor(val / binSize);
      if (binIndex >= numBins) binIndex = numBins - 1;
      bins[binIndex]++;
    });

    const maxCount = Math.max(jcrZeroCount, ...bins);

    let mergedBins = [];
    let zeroStreak = [];

    function flushZeros() {
      if (zeroStreak.length > 1) {
        mergedBins.push({
          count: 0,
          rangeStart: zeroStreak[0].rangeStart,
          rangeEnd: zeroStreak[zeroStreak.length - 1].rangeEnd,
          isMerged: true
        });
      } else {
        zeroStreak.forEach(b => mergedBins.push(b));
      }
      zeroStreak = [];
    }

    bins.forEach((count, i) => {
      const b = { count, rangeStart: i * binSize, rangeEnd: (i + 1) * binSize, isMerged: false };
      if (count === 0) {
        zeroStreak.push(b);
      } else {
        flushZeros();
        mergedBins.push(b);
      }
    });
    flushZeros();

    let barsHTML = '';
    if (jcrZeroCount > 0) {
      const heightPercent = maxCount > 0 ? (jcrZeroCount / maxCount) * 100 : 0;
      barsHTML += `
        <div style="display: flex; flex-direction: column; justify-content: flex-end; align-items: center; flex: 0 0 20px; margin: 0 4px; height: 100%;">
          <div style="font-size: 0.8em; color: #666; margin-bottom: 4px;" title="${jcrZeroCount} publicações">${jcrZeroCount > 0 ? jcrZeroCount : ''}</div>
          <div style="width: 100%; background-color: ${this.GRAPH_COLORS.noJcr}; height: ${heightPercent}%; min-height: 1px; border-radius: 2px 2px 0 0;" title="JCR 0: ${jcrZeroCount} publicações"></div>
          <div style="font-size: 0.7em; color: #666; margin-top: 4px; white-space: nowrap; text-align: center;">0</div>
        </div>
      `;
    }

    mergedBins.forEach((binObj) => {
      const { count, rangeStart, rangeEnd, isMerged } = binObj;
      const label = `${rangeStart}-${rangeEnd}`;

      const binValues = count === 0 ? [] : jcrValues.filter(val => {
        let binIndex = Math.floor(val / binSize);
        if (binIndex >= numBins) binIndex = numBins - 1;
        const binOriginalStart = binIndex * binSize;
        return binOriginalStart >= rangeStart && binOriginalStart < rangeEnd;
      });

      let subBounds = [rangeStart, rangeEnd];
      if (lowVal > rangeStart && lowVal < rangeEnd) subBounds.push(lowVal);
      if (highVal > rangeStart && highVal < rangeEnd) subBounds.push(highVal);
      subBounds = [...new Set(subBounds)].sort((a, b) => a - b);

      let subBarsHTML = '';

      if (subBounds.length === 2) {
        let colorMid = rangeStart + binSize / 2;
        let color = this.GRAPH_COLORS.lowJcr;
        if (colorMid >= highVal) color = this.GRAPH_COLORS.highJcr;
        else if (colorMid >= lowVal) color = this.GRAPH_COLORS.midJcr;

        const heightPercent = maxCount > 0 ? (count / maxCount) * 100 : 0;
        subBarsHTML = `<div style="flex: 1; background-color: ${color}; height: ${heightPercent}%; min-height: ${count > 0 ? 1 : 0}px; border-radius: 2px 2px 0 0;" title="JCR ${label}: ${count} publicações"></div>`;
      } else {
        for (let j = 0; j < subBounds.length - 1; j++) {
          const subStart = subBounds[j];
          const subEnd = subBounds[j + 1];

          let subCount = 0;
          binValues.forEach(v => {
            if (j === subBounds.length - 2) {
              if (v >= subStart) subCount++;
            } else {
              if (v >= subStart && v < subEnd) subCount++;
            }
          });

          const subHeightPercent = maxCount > 0 ? (subCount / maxCount) * 100 : 0;
          const subMid = subStart + (subEnd - subStart) / 2;
          let color = this.GRAPH_COLORS.lowJcr;
          if (subMid >= highVal) color = this.GRAPH_COLORS.highJcr;
          else if (subMid >= lowVal) color = this.GRAPH_COLORS.midJcr;

          subBarsHTML += `<div style="flex: 1; background-color: ${color}; height: ${subHeightPercent}%; min-height: ${subCount > 0 ? 1 : 0}px; border-radius: 2px 2px 0 0;" title="JCR ${subStart}-${subEnd} (parte do bin ${label}): ${subCount} publicações"></div>`;
        }
      }

      barsHTML += `
        <div style="display: flex; flex-direction: column; justify-content: flex-end; align-items: center; flex: 1; margin: 0 2px; height: 100%;">
          <div style="font-size: 0.8em; color: #666; margin-bottom: 4px;" title="${count} publicações no total para ${label}">${count > 0 ? count : ''}</div>
          <div style="display: flex; flex-direction: row; align-items: flex-end; width: 100%; height: 100%;">
            ${subBarsHTML}
          </div>
          <div style="font-size: 0.7em; color: #666; margin-top: 4px; white-space: nowrap; text-align: center;">${label}</div>
        </div>
      `;
    });

    return `
      <div style="height: 100%; display: flex; flex-direction: column; padding: 15px; margin-top: 10px; background-color: ${this.COLORS.backgroundSubHeader}; border-top: 1px solid ${this.COLORS.border}; box-sizing: border-box;">
        <div style="font-weight: bold; margin-bottom: 25px; color: ${this.COLORS.footerText};">Distribuição de JCR</div>
        <div style="display: flex; align-items: flex-end; flex-grow: 1; min-height: 150px; padding-bottom: 10px; border-bottom: 1px solid ${this.COLORS.border};">
          ${barsHTML}
        </div>
      </div>
    `;
  },

  generatePapersPerYearGraphHTML: function(publications, highVal = 7.0, lowVal = 1.5) {
    highVal = parseFloat(highVal);
    lowVal = parseFloat(lowVal);
    const papersByYear = {};
    let minYear = Infinity;
    let maxYear = new Date().getFullYear();

    publications.forEach(pub => {
      if (isNaN(pub.year)) return;
      if (pub.year < minYear) minYear = pub.year;
      if (pub.year > maxYear) maxYear = pub.year;

      if (!papersByYear[pub.year]) {
        papersByYear[pub.year] = { high: 0, mid: 0, low: 0, none: 0, total: 0 };
      }

      let category = 'none';
      const impactFactorStr = pub.impactFactor !== undefined ? pub.impactFactor : pub.jif;
      
      if (impactFactorStr !== null && impactFactorStr !== undefined && impactFactorStr !== '' && impactFactorStr !== 0) {
        const ifVal = parseFloat(impactFactorStr);
        if (ifVal > 0) {
          if (ifVal >= highVal) category = 'high';
          else if (ifVal >= lowVal) category = 'mid';
          else category = 'low';
        }
      }
      papersByYear[pub.year][category]++;
      papersByYear[pub.year].total++;
    });

    if (minYear === Infinity) {
      return `
        <div style="height: 100%; display: flex; flex-direction: column; padding: 15px; margin-top: 10px; background-color: ${this.COLORS.backgroundSubHeader}; border-top: 1px solid ${this.COLORS.border}; box-sizing: border-box;">
          <div style="font-weight: bold; margin-bottom: 8px; color: ${this.COLORS.footerText};">Publicações por Ano</div>
          <div style="display: flex; flex-grow: 1; align-items: center; justify-content: center; color: #666; font-size: 0.9em;">Sem dados de publicações</div>
        </div>
      `;
    }

    const years = [];
    for (let y = minYear; y <= maxYear; y++) {
      years.push(y);
    }

    const maxTotal = Math.max(...Object.values(papersByYear).map(d => d.total));

    const span = maxYear - minYear;
    let labelInterval = 1;
    if (span > 10) labelInterval = 5;
    if (span > 25) labelInterval = 10;

    let barsHTML = '';
    years.forEach(year => {
      const data = papersByYear[year] || { high: 0, mid: 0, low: 0, none: 0, total: 0 };

      const hH = maxTotal > 0 ? (data.high / maxTotal) * 100 : 0;
      const mH = maxTotal > 0 ? (data.mid / maxTotal) * 100 : 0;
      const lH = maxTotal > 0 ? (data.low / maxTotal) * 100 : 0;
      const nH = maxTotal > 0 ? (data.none / maxTotal) * 100 : 0;

      const showLabel = (year === minYear || year === maxYear || year % labelInterval === 0);

      barsHTML += `
        <div style="display: flex; flex-direction: column; justify-content: flex-end; align-items: center; flex: 1; margin: 0 1px; height: 100%; min-width: 4px;">
          <div style="font-size: 0.7em; color: #666; margin-bottom: 2px;">${data.total > 0 ? data.total : ''}</div>
          <div style="width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; border-radius: 2px 2px 0 0; overflow: hidden; border: 1px solid rgba(0,0,0,0.05); border-bottom: none;" title="Ano ${year}: ${data.total} publicações (${data.high} alto, ${data.mid} médio, ${data.low} baixo, ${data.none} sem JCR)">
            <div style="height: ${hH}%; background-color: ${this.GRAPH_COLORS.highJcr}; width: 100%; ${hH > 0 && (mH > 0 || lH > 0 || nH > 0) ? 'border-bottom: 1px solid white;' : ''}"></div>
            <div style="height: ${mH}%; background-color: ${this.GRAPH_COLORS.midJcr}; width: 100%; ${mH > 0 && (lH > 0 || nH > 0) ? 'border-bottom: 1px solid white;' : ''}"></div>
            <div style="height: ${lH}%; background-color: ${this.GRAPH_COLORS.lowJcr}; width: 100%; ${lH > 0 && nH > 0 ? 'border-bottom: 1px solid white;' : ''}"></div>
            <div style="height: ${nH}%; background-color: ${this.GRAPH_COLORS.noJcr}; width: 100%;"></div>
            ${data.total === 0 ? '<div style="height: 1px; background-color: transparent; width: 100%;"></div>' : ''}
          </div>
          <div style="font-size: 0.65em; color: #666; margin-top: 4px; white-space: nowrap; height: 12px; line-height: 12px; text-align: center;">${showLabel ? year : ''}</div>
        </div>
      `;
    });

    return `
      <div style="height: 100%; display: flex; flex-direction: column; padding: 15px; margin-top: 10px; background-color: ${this.COLORS.backgroundSubHeader}; border-top: 1px solid ${this.COLORS.border}; box-sizing: border-box;">
        <div style="font-weight: bold; margin-bottom: 25px; color: ${this.COLORS.footerText};">Publicações por Ano</div>
        <div style="display: flex; align-items: flex-end; flex-grow: 1; min-height: 150px; padding-bottom: 10px; border-bottom: 1px solid ${this.COLORS.border};">
          ${barsHTML}
        </div>
      </div>
    `;
  },

  generateRidTableHTML: function(ridStats, researcherIdLink, isUnlocked) {
    if (!ridStats || !researcherIdLink) return '';
    
    const ridId = researcherIdLink.split('/').pop();
    
    return `
      <div id="rid-stats-table" class="rodape-cv" style="margin-top: 10px; color: ${this.COLORS.footerText}; font-size: 1.1em;">
        <table style="width: 100%; border-collapse: collapse; text-align: center; font-family: inherit; font-size: 0.9em;">
          <thead>
            <tr style="background-color: ${this.COLORS.backgroundHeader}; border-bottom: 1px solid ${this.COLORS.border};">
              <th style="padding: 8px; text-align: left;" title="Web of Science ResearcherID Profile">ResearcherID</th>
              <th style="padding: 8px; text-align: center;" title="Web of Science H-Index">H-Index</th>
              <th style="padding: 8px; text-align: center;" title="Web of Science Core Collection publications">CC Pubs</th>
              <th style="padding: 8px; text-align: center;" title="Publications indexed in Web of Science">WoS Pubs</th>
              <th style="padding: 8px; text-align: center;" title="Sum of Times Cited">Citações</th>
              <th style="padding: 8px; text-align: center;" title="Sum of Times Cited without self-citations">Citações (sem auto)</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px solid #ddd;">
              <td style="padding: 8px; text-align: left;"><a href="${researcherIdLink}" target="_blank" style="color: #1565C0; text-decoration: none;">${ridId}</a></td>
              <td style="padding: 8px; text-align: center;">${ridStats.hIndex !== null && ridStats.hIndex !== undefined ? ridStats.hIndex : '-'}</td>
              <td style="padding: 8px; text-align: center;">${ridStats.publications !== null && ridStats.publications !== undefined ? ridStats.publications : '-'}</td>
              <td style="padding: 8px; text-align: center;">${ridStats.wosPublications !== null && ridStats.wosPublications !== undefined ? ridStats.wosPublications : '-'}</td>
              <td style="padding: 8px; text-align: center;">${ridStats.sumOfTimesCited !== null && ridStats.sumOfTimesCited !== undefined ? ridStats.sumOfTimesCited : '-'}</td>
              <td style="padding: 8px; text-align: center;">${ridStats.sumOfTimesCitedWithoutSelf !== null && ridStats.sumOfTimesCitedWithoutSelf !== undefined ? ridStats.sumOfTimesCitedWithoutSelf : '-'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  },

  generateCitationTableHTML: function(stats) {
    const { all, recent, last10, custom, declaredCitations } = stats;
    
    const getVal = (periodStats, source, type) => {
      const val = periodStats.citations[source][type];
      return val !== undefined ? val : 0;
    };

    return `
      <div class="rodape-cv" style="margin-top: 10px; color: ${this.COLORS.footerText}; font-size: 1.1em;">
        <table style="width: 100%; border-collapse: collapse; text-align: center; font-family: inherit; font-size: 0.9em;">
          <thead>
            <tr style="background-color: ${this.COLORS.backgroundHeader}; border-bottom: 1px solid ${this.COLORS.border};">
              <th colspan="3" style="padding: 8px; text-align: left;">Citações</th>
              <th colspan="2" style="padding: 8px; border-left: 1px solid #ccc; text-align: center;">Web of Science</th>
              <th colspan="2" style="padding: 8px; border-left: 1px solid #ccc; text-align: center;">Scopus</th>
            </tr>
            <tr style="background-color: ${this.COLORS.backgroundSubHeader}; border-bottom: 2px solid ${this.COLORS.border}; font-size: 0.85em;">
              <th style="padding: 4px; text-align: left;">Período</th>
              <th style="padding: 4px; text-align: center; border-left: 1px solid #eee;">Total Artigos</th>
              <th style="padding: 4px; text-align: center;">Com JCR</th>
              <th style="padding: 4px; border-left: 1px solid #ccc; text-align: center;">Σ</th>
              <th style="padding: 4px; text-align: center;">h-index</th>
              <th style="padding: 4px; border-left: 1px solid #ccc; text-align: center;">Σ</th>
              <th style="padding: 4px; text-align: center;">h-index</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px solid #ddd;">
              <td style="padding: 8px; text-align: left;">Total (${stats.minYear} - ${stats.maxYear})</td>
              <td style="padding: 8px; text-align: center;">${all.total.count}</td>
              <td style="padding: 8px; text-align: center;">${all.total.countWithJcr}</td>
              <td style="padding: 8px; border-left: 1px solid #eee; text-align: center;">${getVal(all, 'wos', 'sum')}</td>
              <td style="padding: 8px; text-align: center;">${getVal(all, 'wos', 'hIndex')}</td>
              <td style="padding: 8px; border-left: 1px solid #eee; text-align: center;">${getVal(all, 'scopus', 'sum')}</td>
              <td style="padding: 8px; text-align: center;">${getVal(all, 'scopus', 'hIndex')}</td>
            </tr>
            <tr style="border-bottom: 1px solid #ddd;">
              <td style="padding: 8px; text-align: left;">Últimos 5 anos</td>
              <td style="padding: 8px; text-align: center;">${recent.total.count}</td>
              <td style="padding: 8px; text-align: center;">${recent.total.countWithJcr}</td>
              <td style="padding: 8px; border-left: 1px solid #eee; text-align: center;">${getVal(recent, 'wos', 'sum')}</td>
              <td style="padding: 8px; text-align: center;">${getVal(recent, 'wos', 'hIndex')}</td>
              <td style="padding: 8px; border-left: 1px solid #eee; text-align: center;">${getVal(recent, 'scopus', 'sum')}</td>
              <td style="padding: 8px; text-align: center;">${getVal(recent, 'scopus', 'hIndex')}</td>
            </tr>
            <tr style="border-bottom: 1px solid #ddd;">
              <td style="padding: 8px; text-align: left;">Últimos 10 anos</td>
              <td style="padding: 8px; text-align: center;">${last10.total.count}</td>
              <td style="padding: 8px; text-align: center;">${last10.total.countWithJcr}</td>
              <td style="padding: 8px; border-left: 1px solid #eee; text-align: center;">${getVal(last10, 'wos', 'sum')}</td>
              <td style="padding: 8px; text-align: center;">${getVal(last10, 'wos', 'hIndex')}</td>
              <td style="padding: 8px; border-left: 1px solid #eee; text-align: center;">${getVal(last10, 'scopus', 'sum')}</td>
              <td style="padding: 8px; text-align: center;">${getVal(last10, 'scopus', 'hIndex')}</td>
            </tr>
            <tr style="border-bottom: 1px solid #ddd;">
              <td style="padding: 8px; text-align: left;">Customizado (${stats.customYears} ${stats.customYears == 1 || stats.customYears == 0 ? 'ano' : 'anos'})</td>
              <td style="padding: 8px; text-align: center;">${custom.total.count}</td>
              <td style="padding: 8px; text-align: center;">${custom.total.countWithJcr}</td>
              <td style="padding: 8px; border-left: 1px solid #eee; text-align: center;">${getVal(custom, 'wos', 'sum')}</td>
              <td style="padding: 8px; text-align: center;">${getVal(custom, 'wos', 'hIndex')}</td>
              <td style="padding: 8px; border-left: 1px solid #eee; text-align: center;">${getVal(custom, 'scopus', 'sum')}</td>
              <td style="padding: 8px; text-align: center;">${getVal(custom, 'scopus', 'hIndex')}</td>
            </tr>
            ${declaredCitations ? `
            <tr style="background-color: ${this.COLORS.backgroundSubHeader}; font-weight: bold;">
              <td style="padding: 8px; text-align: left;">Declarado (Lattes)</td>
              <td style="padding: 8px; text-align: center;">-</td>
              <td style="padding: 8px; text-align: center;">-</td>
              <td style="padding: 8px; border-left: 1px solid #ccc; text-align: center;">${declaredCitations.wosCitations !== '' ? declaredCitations.wosCitations : '-'}</td>
              <td style="padding: 8px; text-align: center;">${declaredCitations.wosHIndex !== '' ? declaredCitations.wosHIndex : '-'}</td>
              <td style="padding: 8px; border-left: 1px solid #ccc; text-align: center;">${declaredCitations.scopusCitations !== '' ? declaredCitations.scopusCitations : '-'}</td>
              <td style="padding: 8px; text-align: center;">${declaredCitations.scopusHIndex !== '' ? declaredCitations.scopusHIndex : '-'}</td>
            </tr>` : ''}
          </tbody>
        </table>
      </div>
    `;
  },

  generateSupervisionTableHTML: function(stats, customYears) {
    const { supervisions } = stats;
    if (!supervisions || (!supervisions.inCourse && !supervisions.concluded)) return '';

    const allCategories = new Set([
      ...Object.keys(supervisions.inCourse || {}),
      ...Object.keys(supervisions.concluded || {})
    ]);

    let rows = '';
    allCategories.forEach(cat => {
      const inCourse = supervisions.inCourse[cat] || 0;
      const concludedYears = supervisions.concluded[cat] || [];
      const totalConcluded = concludedYears.length;
      
      const currentYear = new Date().getFullYear();
      const countRecent = concludedYears.filter(y => y >= currentYear - 5).length;
      const countLast10 = concludedYears.filter(y => y >= currentYear - 10).length;
      const countCustom = concludedYears.filter(y => y >= currentYear - customYears).length;

      rows += `
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 8px; text-align: left;">${cat}</td>
          <td style="padding: 8px; text-align: center; border-left: 1px solid #eee;">${inCourse}</td>
          <td style="padding: 8px; text-align: center; border-left: 1px solid #eee;">${totalConcluded}</td>
          <td style="padding: 8px; text-align: center;">${countRecent}</td>
          <td style="padding: 8px; text-align: center;">${countLast10}</td>
          <td style="padding: 8px; text-align: center;">${countCustom}</td>
        </tr>
      `;
    });

    return `
      <div class="rodape-cv" style="margin-top: 10px; color: ${this.COLORS.footerText}; font-size: 1.1em;">
        <table style="width: 100%; border-collapse: collapse; text-align: center; font-family: inherit; font-size: 0.9em;">
          <thead>
            <tr style="background-color: ${this.COLORS.backgroundHeader}; border-bottom: 1px solid ${this.COLORS.border};">
              <th style="padding: 8px; text-align: left;">Orientações</th>
              <th style="padding: 8px; text-align: center; border-left: 1px solid #ccc;">Em Andamento</th>
              <th style="padding: 8px; text-align: center; border-left: 1px solid #ccc;">Concluídas</th>
              <th style="padding: 8px; text-align: center;">5 Anos</th>
              <th style="padding: 8px; text-align: center;">10 Anos</th>
              <th style="padding: 8px; text-align: center;">${customYears} ${customYears == 1 || customYears == 0 ? 'Ano' : 'Anos'}</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  },

  generatePatentTableHTML: function(stats, customYears) {
    if (!stats.all.patents || stats.all.patents.total === 0) return '';
    
    const allStatuses = Object.keys(stats.all.patents.statusCounts).sort();
    let rowsHtml = '';

    allStatuses.forEach(status => {
      const getCount = (periodStats, s) => (periodStats.patents.statusCounts[s] || 0);

      rowsHtml += `
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 8px; text-align: left;">${status}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.all, status)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.recent, status)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.last10, status)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.custom, status)}</td>
        </tr>
      `;
    });

    rowsHtml += `
      <tr style="border-bottom: 1px solid #ddd; background-color: ${this.COLORS.backgroundSubHeader}; font-weight: bold;">
        <td style="padding: 8px; text-align: left;">Total</td>
        <td style="padding: 8px; text-align: center;">${stats.all.patents.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.recent.patents.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.last10.patents.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.custom.patents.total}</td>
      </tr>
    `;

    return `
      <div class="rodape-cv" style="margin-top: 10px; color: ${this.COLORS.footerText}; font-size: 1.1em;">
        <table style="width: 100%; border-collapse: collapse; text-align: center; font-family: inherit; font-size: 0.9em;">
          <thead>
            <tr style="background-color: ${this.COLORS.backgroundHeader}; border-bottom: 1px solid ${this.COLORS.border};">
              <th style="padding: 8px; text-align: left;">Patentes</th>
              <th style="padding: 8px; text-align: center; border-left: 1px solid #ccc;">Total</th>
              <th style="padding: 8px; text-align: center;">5 Anos</th>
              <th style="padding: 8px; text-align: center;">10 Anos</th>
              <th style="padding: 8px; text-align: center;">${customYears} ${customYears == 1 || customYears == 0 ? 'Ano' : 'Anos'}</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;
  },

  generateEventTableHTML: function(stats, customYears) {
    if (!stats.all.events || stats.all.events.total === 0) return '';
    
    const allTypes = Object.keys(stats.all.events.typeCounts).sort();
    let rowsHtml = '';

    allTypes.forEach(type => {
      const getCount = (periodStats, t) => (periodStats.events.typeCounts[t] || 0);

      rowsHtml += `
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 8px; text-align: left;">${type}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.all, type)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.recent, type)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.last10, type)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.custom, type)}</td>
        </tr>
      `;
    });

    rowsHtml += `
      <tr style="border-bottom: 1px solid #ddd; background-color: ${this.COLORS.backgroundSubHeader}; font-weight: bold;">
        <td style="padding: 8px; text-align: left;">Total</td>
        <td style="padding: 8px; text-align: center;">${stats.all.events.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.recent.events.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.last10.events.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.custom.events.total}</td>
      </tr>
    `;

    return `
      <div class="rodape-cv" style="margin-top: 10px; color: ${this.COLORS.footerText}; font-size: 1.1em;">
        <table style="width: 100%; border-collapse: collapse; text-align: center; font-family: inherit; font-size: 0.9em;">
          <thead>
            <tr style="background-color: ${this.COLORS.backgroundHeader}; border-bottom: 1px solid ${this.COLORS.border};">
              <th style="padding: 8px; text-align: left;">Participação em Eventos</th>
              <th style="padding: 8px; text-align: center; border-left: 1px solid #ccc;">Total</th>
              <th style="padding: 8px; text-align: center;">5 Anos</th>
              <th style="padding: 8px; text-align: center;">10 Anos</th>
              <th style="padding: 8px; text-align: center;">${customYears} ${customYears == 1 || customYears == 0 ? 'Ano' : 'Anos'}</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;
  }
};
