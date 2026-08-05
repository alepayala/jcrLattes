// report_utils.js
// Shared utility functions for generating JCR Lattes reports

window.JCRReportUtils = {
  COLORS: {
    highJcr: '#3daa43',
    midJcr: '#a838ca',
    lowJcr: '#E65100',
    noJcr: '#e03535',
    authorRank: '#3daa43',
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
    noJcr: '#C62828',
    posDoc: '#6A1B9A'
  },

  JOURNAL_STRIP_SUFFIXES: ['(print)', '(online)','(Cambridge. Online)','(Impresso)','(Internet)','(Philadelphia, PA)','(New York)','(São Paulo. Impresso)','(London. 1996. Print)'],

  formatNum: function(num) {
    return num.toFixed(2);
  },

  getAvg: function(sum, count) {
    return count > 0 ? this.formatNum(sum / count) : '0.00';
  },

  getSoftColor: function(hex, factor = 0.85) {
    let c = hex.startsWith('#') ? hex.substring(1) : hex;
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    if (c.length === 8) c = c.substring(0, 6); // #rrggbbaa: descarta o canal alpha
    const rgb = parseInt(c, 16);
    let r = (rgb >> 16) & 0xff;
    let g = (rgb >> 8) & 0xff;
    let b = (rgb >> 0) & 0xff;
    r = Math.round(r + (255 - r) * factor);
    g = Math.round(g + (255 - g) * factor);
    b = Math.round(b + (255 - b) * factor);
    return `rgb(${r}, ${g}, ${b})`;
  },

  calculateReportStats: function(publications, patents, events, supervisions, declaredCitations, currentYear, customYears, startYearRecent, startYearLast10, startYearCustom, highJcr, lowJcr, targetAuthorRank = 1) {
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

    const targetRank = parseInt(targetAuthorRank) || 1;

    if (publications && Array.isArray(publications)) {
      for (const pub of publications) {
        if (!isNaN(pub.year)) {
          if (pub.year < minYear) minYear = pub.year;
          if (pub.year > maxYear) maxYear = pub.year;
        }
        
        const impactFactorStr = pub.impactFactor !== undefined ? pub.impactFactor : pub.jif;
        
        let isFirstAuthor = false;
        if (targetRank === 1) {
          isFirstAuthor = pub.isFirstAuthor;
          if (isFirstAuthor === undefined) {
            isFirstAuthor = pub.authorRank === 1;
          }
        } else {
          isFirstAuthor = pub.authorRank === targetRank;
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

  generateAuthorRankHistogramHTML: function(publications, highVal = 7.0, lowVal = 1.5, showLast = true, showGc = true) {
    highVal = parseFloat(highVal);
    lowVal = parseFloat(lowVal);

    const rankData = {};
    const lastData = { high: 0, mid: 0, low: 0, none: 0, total: 0 };
    const gcData = { high: 0, mid: 0, low: 0, none: 0, total: 0 };
    let maxRankFound = 1;

    publications.forEach(pub => {
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

      if (pub.hasEtAl) {
        gcData[category]++;
        gcData.total++;
      } else {
        let rank = pub.authorRank;
        if (rank === undefined || rank === null || rank < 1) {
          rank = pub.isFirstAuthor ? 1 : 1;
        }
        if (rank > maxRankFound) maxRankFound = rank;

        if (!rankData[rank]) {
          rankData[rank] = { high: 0, mid: 0, low: 0, none: 0, total: 0 };
        }
        rankData[rank][category]++;
        rankData[rank].total++;

        let isLast = pub.isLastAuthor;
        if (isLast === undefined) {
          isLast = pub.authorCount > 1 && rank === pub.authorCount;
        }
        if (isLast) {
          lastData[category]++;
          lastData.total++;
        }
      }
    });

    if (publications.length === 0) {
      return `
        <div style="height: 100%; display: flex; flex-direction: column; padding: 15px; margin-top: 10px; background-color: ${this.COLORS.backgroundSubHeader}; border-top: 1px solid ${this.COLORS.border}; box-sizing: border-box;">
          <div style="font-weight: bold; margin-bottom: 8px; color: ${this.COLORS.footerText};">Distribuição por Rank de Autoria</div>
          <div style="display: flex; flex-grow: 1; align-items: center; justify-content: center; color: #666; font-size: 0.9em;">Sem dados de publicações</div>
        </div>
      `;
    }

    const rankColumns = [];
    const limitRank = Math.max(5, Math.min(maxRankFound, 15));
    for (let r = 1; r <= limitRank; r++) {
      rankColumns.push({
        key: `rank_${r}`,
        label: `${r}º`,
        title: `${r}º Autor`,
        isSpecial: false,
        data: rankData[r] || { high: 0, mid: 0, low: 0, none: 0, total: 0 }
      });
    }

    const histogramMax = Math.max(0, ...rankColumns.map(c => c.data.total));
    const scaleMax = histogramMax > 0 ? histogramMax : Math.max(1, lastData.total, gcData.total);

    const columns = [...rankColumns];

    if (showLast !== false) {
      columns.push({
        key: 'last',
        label: 'Ult',
        title: 'Último Autor',
        isSpecial: true,
        data: lastData
      });
    }

    if (showGc !== false) {
      columns.push({
        key: 'gc',
        label: 'GC',
        title: 'Grandes Colaborações (et al.)',
        isSpecial: true,
        data: gcData
      });
    }

    let barsHTML = '';
    columns.forEach(col => {
      const data = col.data;
      let hH = 0, mH = 0, lH = 0, nH = 0;

      if (col.isSpecial && data.total > scaleMax) {
        const colTotal = data.total > 0 ? data.total : 1;
        hH = (data.high / colTotal) * 100;
        mH = (data.mid / colTotal) * 100;
        lH = (data.low / colTotal) * 100;
        nH = (data.none / colTotal) * 100;
      } else {
        hH = scaleMax > 0 ? (data.high / scaleMax) * 100 : 0;
        mH = scaleMax > 0 ? (data.mid / scaleMax) * 100 : 0;
        lH = scaleMax > 0 ? (data.low / scaleMax) * 100 : 0;
        nH = scaleMax > 0 ? (data.none / scaleMax) * 100 : 0;
      }

      const isCapped = col.isSpecial && data.total > scaleMax;

      barsHTML += `
        <div style="display: flex; flex-direction: column; justify-content: flex-end; align-items: center; flex: 1; margin: 0 2px; height: 100%; min-width: 15px;">
          <div style="font-size: 0.75em; color: ${isCapped ? '#d32f2f' : '#666'}; font-weight: ${isCapped ? 'bold' : 'normal'}; margin-bottom: 2px;" title="${data.total} publicações">${data.total > 0 ? data.total : ''}</div>
          <div style="width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; border-radius: 2px 2px 0 0; overflow: hidden; border: 1px solid rgba(0,0,0,0.05); border-bottom: none;" title="${col.title}: ${data.total} publicações (${data.high} alto, ${data.mid} médio, ${data.low} baixo, ${data.none} sem JCR)">
            <div style="height: ${hH}%; background-color: ${this.GRAPH_COLORS.highJcr}; width: 100%; ${hH > 0 && (mH > 0 || lH > 0 || nH > 0) ? 'border-bottom: 1px solid white;' : ''}"></div>
            <div style="height: ${mH}%; background-color: ${this.GRAPH_COLORS.midJcr}; width: 100%; ${mH > 0 && (lH > 0 || nH > 0) ? 'border-bottom: 1px solid white;' : ''}"></div>
            <div style="height: ${lH}%; background-color: ${this.GRAPH_COLORS.lowJcr}; width: 100%; ${lH > 0 && nH > 0 ? 'border-bottom: 1px solid white;' : ''}"></div>
            <div style="height: ${nH}%; background-color: ${this.GRAPH_COLORS.noJcr}; width: 100%;"></div>
            ${data.total === 0 ? '<div style="height: 1px; background-color: transparent; width: 100%;"></div>' : ''}
          </div>
          <div style="font-size: 0.7em; color: #666; margin-top: 4px; white-space: nowrap; height: 14px; line-height: 14px; text-align: center;">${col.label}</div>
        </div>
      `;
    });

    return `
      <div style="height: 100%; display: flex; flex-direction: column; padding: 15px; margin-top: 10px; background-color: ${this.COLORS.backgroundSubHeader}; border-top: 1px solid ${this.COLORS.border}; box-sizing: border-box;">
        <div style="font-weight: bold; margin-bottom: 25px; color: ${this.COLORS.footerText};">Distribuição por Rank de Autoria</div>
        <div style="display: flex; align-items: flex-end; flex-grow: 1; min-height: 150px; padding-bottom: 10px; border-bottom: 1px solid ${this.COLORS.border};">
          ${barsHTML}
        </div>
      </div>
    `;
  },

  generateSupervisionsPerYearGraphHTML: function(supervisionsInput) {
    let rawItems = [];
    if (Array.isArray(supervisionsInput)) {
      rawItems = supervisionsInput;
    } else if (supervisionsInput && Array.isArray(supervisionsInput.raw)) {
      rawItems = supervisionsInput.raw;
    }

    const itemsByYear = {};
    const inProgressData = {
      doutorado: { total: 0, coor: 0 },
      posdoc: { total: 0, coor: 0 },
      mestrado: { total: 0, coor: 0 },
      total: 0
    };
    const icData = { total: 0, coor: 0 };
    const outrasData = { total: 0, coor: 0, subTypes: {} };
    let minYear = Infinity;
    let maxYear = new Date().getFullYear();

    const getSupervisionType = (item) => {
      const cat = (item.category || '').toLowerCase();
      const ref = (item.reference || '').toLowerCase();

      if (cat.includes('doutorado') && !cat.includes('pos-doutorado') && !cat.includes('pós-doutorado') && !cat.includes('pos doutorado') && !cat.includes('pós doutorado')) {
        return 'doutorado';
      }
      if (cat.includes('pos-doutorado') || cat.includes('pós-doutorado') || cat.includes('pos doutorado') || cat.includes('pós doutorado') || ref.includes('pós-doutorado') || ref.includes('pos-doutorado')) {
        return 'posdoc';
      }
      if (cat.includes('mestrado')) {
        return 'mestrado';
      }
      if (cat.includes('iniciação científica') || cat.includes('iniciacao cientifica') || cat.includes('ic') || ref.includes('iniciação científica') || ref.includes('iniciacao cientifica')) {
        return 'ic';
      }
      return 'outras';
    };

    const isCoorientacao = (item) => {
      const cat = (item.category || '');
      const ref = (item.reference || '');
      return cat.includes('Coorientador') || cat.includes('Co-orientador') || ref.includes('Coorientador') || ref.includes('Co-orientador');
    };

    const getOutrasSubtypeLabel = (item) => {
      const cat = (item.category || '').toLowerCase();
      const ref = (item.reference || '').toLowerCase();

      if (cat.includes('trabalho de conclusão') || cat.includes('graduação') || cat.includes('tcc') || ref.includes('graduação')) {
        return 'TCC / Graduação';
      }
      if (cat.includes('especialização') || cat.includes('especializacao') || cat.includes('aperfeiçoamento')) {
        return 'Especialização / Aperfeiçoamento';
      }
      if (cat.includes('outra natureza') || ref.includes('outra natureza')) {
        return 'Outra natureza';
      }
      let cleanCat = item.category ? item.category.replace(/\s*\(Coorientador\)/gi, '').trim() : 'Outras';
      return cleanCat || 'Outras';
    };

    rawItems.forEach(item => {
      const type = getSupervisionType(item);
      if (!type) return;

      const isCo = isCoorientacao(item);
      const isEmAndamento = item.status === 'Em andamento' || (item.status !== 'Concluída' && isNaN(item.year));

      if (type === 'ic') {
        icData.total++;
        if (isCo) icData.coor++;
      } else if (type === 'outras') {
        outrasData.total++;
        if (isCo) outrasData.coor++;
        const sub = getOutrasSubtypeLabel(item);
        outrasData.subTypes[sub] = (outrasData.subTypes[sub] || 0) + 1;
      } else if (isEmAndamento) {
        inProgressData[type].total++;
        if (isCo) inProgressData[type].coor++;
        inProgressData.total++;
      } else {
        let year = item.year;
        if (isNaN(year) && item.reference) {
          const matches = item.reference.match(/\b(?:19|20)\d{2}\b/g);
          if (matches && matches.length > 0) {
            year = parseInt(matches[matches.length - 1]);
          }
        }

        if (isNaN(year) || year < 1900 || year > maxYear + 1) return;

        if (year < minYear) minYear = year;
        if (year > maxYear) maxYear = year;

        if (!itemsByYear[year]) {
          itemsByYear[year] = {
            doutorado: { total: 0, coor: 0 },
            posdoc: { total: 0, coor: 0 },
            mestrado: { total: 0, coor: 0 },
            total: 0
          };
        }

        itemsByYear[year][type].total++;
        if (isCo) itemsByYear[year][type].coor++;
        itemsByYear[year].total++;
      }
    });

    if (minYear === Infinity && inProgressData.total === 0 && icData.total === 0 && outrasData.total === 0) {
      return `
        <div style="height: 100%; display: flex; flex-direction: column; padding: 15px; margin-top: 10px; background-color: ${this.COLORS.backgroundSubHeader}; border-top: 1px solid ${this.COLORS.border}; box-sizing: border-box;">
          <div style="font-weight: bold; margin-bottom: 8px; color: ${this.COLORS.footerText};">Orientações por Ano</div>
          <div style="display: flex; flex-grow: 1; align-items: center; justify-content: center; color: #666; font-size: 0.9em;">Sem dados de orientações</div>
        </div>
      `;
    }

    const years = [];
    if (minYear !== Infinity) {
      for (let y = minYear; y <= maxYear; y++) {
        years.push(y);
      }
    }

    const histogramMax = Math.max(0, ...years.map(y => itemsByYear[y] ? itemsByYear[y].total : 0));
    const scaleMax = histogramMax > 0 ? histogramMax : Math.max(1, inProgressData.total, icData.total, outrasData.total);

    const span = maxYear - minYear;
    let labelInterval = 1;
    if (span > 10) labelInterval = 5;
    if (span > 25) labelInterval = 10;

    let barsHTML = '';
    years.forEach(year => {
      const data = itemsByYear[year] || {
        doutorado: { total: 0, coor: 0 },
        posdoc: { total: 0, coor: 0 },
        mestrado: { total: 0, coor: 0 },
        total: 0
      };

      const dH = scaleMax > 0 ? (data.doutorado.total / scaleMax) * 100 : 0;
      const pH = scaleMax > 0 ? (data.posdoc.total / scaleMax) * 100 : 0;
      const mH = scaleMax > 0 ? (data.mestrado.total / scaleMax) * 100 : 0;

      const showLabel = (year === minYear || year === maxYear || year % labelInterval === 0);

      const tooltipParts = [];
      if (data.posdoc.total > 0) {
        tooltipParts.push(`${data.posdoc.total} Pós-doutorado${data.posdoc.coor > 0 ? ' (' + data.posdoc.coor + ' Coor.)' : ''}`);
      }
      if (data.doutorado.total > 0) {
        tooltipParts.push(`${data.doutorado.total} Doutorado${data.doutorado.coor > 0 ? ' (' + data.doutorado.coor + ' Coor.)' : ''}`);
      }
      if (data.mestrado.total > 0) {
        tooltipParts.push(`${data.mestrado.total} Mestrado${data.mestrado.coor > 0 ? ' (' + data.mestrado.coor + ' Coor.)' : ''}`);
      }

      const tooltipText = tooltipParts.length > 0
        ? `Ano ${year}: ${data.total} orientações (${tooltipParts.join(', ')})`
        : `Ano ${year}: 0 orientações`;

      barsHTML += `
        <div style="display: flex; flex-direction: column; justify-content: flex-end; align-items: center; flex: 1; margin: 0 1px; height: 100%; min-width: 4px;">
          <div style="font-size: 0.7em; color: #666; margin-bottom: 2px;">${data.total > 0 ? data.total : ''}</div>
          <div style="width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; border-radius: 2px 2px 0 0; overflow: hidden; border: 1px solid rgba(0,0,0,0.05); border-bottom: none;" title="${tooltipText}">
            <div style="height: ${pH}%; background-color: ${this.GRAPH_COLORS.highJcr}; width: 100%; ${pH > 0 && (dH > 0 || mH > 0) ? 'border-bottom: 1px solid white;' : ''}"></div>
            <div style="height: ${dH}%; background-color: ${this.GRAPH_COLORS.midJcr}; width: 100%; ${dH > 0 && mH > 0 ? 'border-bottom: 1px solid white;' : ''}"></div>
            <div style="height: ${mH}%; background-color: ${this.GRAPH_COLORS.lowJcr}; width: 100%;"></div>
            ${data.total === 0 ? '<div style="height: 1px; background-color: transparent; width: 100%;"></div>' : ''}
          </div>
          <div style="font-size: 0.65em; color: #666; margin-top: 4px; white-space: nowrap; height: 12px; line-height: 12px; text-align: center;">${showLabel ? year : ''}</div>
        </div>
      `;
    });

    // Append Special Column: EA (Orientações em Andamento - Pós-Graduação)
    const inProgCapped = inProgressData.total > scaleMax;
    let ipDH = 0, ipPH = 0, ipMH = 0;

    if (inProgCapped) {
      const ipColTotal = inProgressData.total > 0 ? inProgressData.total : 1;
      ipPH = (inProgressData.posdoc.total / ipColTotal) * 100;
      ipDH = (inProgressData.doutorado.total / ipColTotal) * 100;
      ipMH = (inProgressData.mestrado.total / ipColTotal) * 100;
    } else {
      ipPH = scaleMax > 0 ? (inProgressData.posdoc.total / scaleMax) * 100 : 0;
      ipDH = scaleMax > 0 ? (inProgressData.doutorado.total / scaleMax) * 100 : 0;
      ipMH = scaleMax > 0 ? (inProgressData.mestrado.total / scaleMax) * 100 : 0;
    }

    const ipTooltipParts = [];
    if (inProgressData.posdoc.total > 0) {
      ipTooltipParts.push(`${inProgressData.posdoc.total} Pós-doutorado${inProgressData.posdoc.coor > 0 ? ' (' + inProgressData.posdoc.coor + ' Coor.)' : ''}`);
    }
    if (inProgressData.doutorado.total > 0) {
      ipTooltipParts.push(`${inProgressData.doutorado.total} Doutorado${inProgressData.doutorado.coor > 0 ? ' (' + inProgressData.doutorado.coor + ' Coor.)' : ''}`);
    }
    if (inProgressData.mestrado.total > 0) {
      ipTooltipParts.push(`${inProgressData.mestrado.total} Mestrado${inProgressData.mestrado.coor > 0 ? ' (' + inProgressData.mestrado.coor + ' Coor.)' : ''}`);
    }

    const ipTooltipText = `Orientações em Andamento (EA): ${inProgressData.total}${ipTooltipParts.length > 0 ? ' (' + ipTooltipParts.join(', ') + ')' : ''}`;

    barsHTML += `
      <div style="display: flex; flex-direction: column; justify-content: flex-end; align-items: center; flex: 1; margin: 0 2px; height: 100%; min-width: 15px;">
        <div style="font-size: 0.75em; color: ${inProgCapped ? '#d32f2f' : '#666'}; font-weight: ${inProgCapped ? 'bold' : 'normal'}; margin-bottom: 2px;" title="${ipTooltipText}">${inProgressData.total > 0 ? inProgressData.total : ''}</div>
        <div style="width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; border-radius: 2px 2px 0 0; overflow: hidden; border: 1px solid rgba(0,0,0,0.05); border-bottom: none;" title="${ipTooltipText}">
          <div style="height: ${ipPH}%; background-color: ${this.GRAPH_COLORS.highJcr}; width: 100%; ${ipPH > 0 && (ipDH > 0 || ipMH > 0) ? 'border-bottom: 1px solid white;' : ''}"></div>
          <div style="height: ${ipDH}%; background-color: ${this.GRAPH_COLORS.midJcr}; width: 100%; ${ipDH > 0 && ipMH > 0 ? 'border-bottom: 1px solid white;' : ''}"></div>
          <div style="height: ${ipMH}%; background-color: ${this.GRAPH_COLORS.lowJcr}; width: 100%;"></div>
          ${inProgressData.total === 0 ? '<div style="height: 1px; background-color: transparent; width: 100%;"></div>' : ''}
        </div>
        <div style="font-size: 0.7em; color: #666; margin-top: 4px; white-space: nowrap; height: 14px; line-height: 14px; text-align: center;" title="Em Andamento">EA</div>
      </div>
    `;

    // Append Special Column: IC (Iniciação Científica)
    const icCapped = icData.total > scaleMax;
    const icHeightPercent = icCapped ? 100 : (scaleMax > 0 ? (icData.total / scaleMax) * 100 : 0);
    const icTitleText = `Iniciação Científica (IC): ${icData.total} orientações${icData.coor > 0 ? ' (' + icData.coor + ' Coor.)' : ''}`;

    barsHTML += `
      <div style="display: flex; flex-direction: column; justify-content: flex-end; align-items: center; flex: 1; margin: 0 2px; height: 100%; min-width: 15px;">
        <div style="font-size: 0.75em; color: ${icCapped ? '#d32f2f' : '#666'}; font-weight: ${icCapped ? 'bold' : 'normal'}; margin-bottom: 2px;" title="${icTitleText}">${icData.total > 0 ? icData.total : ''}</div>
        <div style="width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; border-radius: 2px 2px 0 0; overflow: hidden; border: 1px solid rgba(0,0,0,0.05); border-bottom: none;" title="${icTitleText}">
          <div style="height: ${icHeightPercent}%; background-color: ${this.GRAPH_COLORS.noJcr}; width: 100%; min-height: ${icData.total > 0 ? 1 : 0}px;"></div>
        </div>
        <div style="font-size: 0.7em; color: #666; margin-top: 4px; white-space: nowrap; height: 14px; line-height: 14px; text-align: center;">IC</div>
      </div>
    `;

    // Append Special Column: Outras (Outras orientações)
    const outrasCapped = outrasData.total > scaleMax;
    const outrasHeightPercent = outrasCapped ? 100 : (scaleMax > 0 ? (outrasData.total / scaleMax) * 100 : 0);
    const subBreakdown = Object.entries(outrasData.subTypes).map(([k, v]) => `${v} ${k}`).join(', ');
    let outrasTitleText = `Outras orientações: ${outrasData.total}`;
    if (subBreakdown) outrasTitleText += ` (${subBreakdown})`;
    if (outrasData.coor > 0) outrasTitleText += ` [${outrasData.coor} Coor.]`;

    barsHTML += `
      <div style="display: flex; flex-direction: column; justify-content: flex-end; align-items: center; flex: 1; margin: 0 2px; height: 100%; min-width: 15px;">
        <div style="font-size: 0.75em; color: ${outrasCapped ? '#d32f2f' : '#666'}; font-weight: ${outrasCapped ? 'bold' : 'normal'}; margin-bottom: 2px;" title="${outrasTitleText}">${outrasData.total > 0 ? outrasData.total : ''}</div>
        <div style="width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; border-radius: 2px 2px 0 0; overflow: hidden; border: 1px solid rgba(0,0,0,0.05); border-bottom: none;" title="${outrasTitleText}">
          <div style="height: ${outrasHeightPercent}%; background-color: #7F8C8D; width: 100%; min-height: ${outrasData.total > 0 ? 1 : 0}px;"></div>
        </div>
        <div style="font-size: 0.7em; color: #666; margin-top: 4px; white-space: nowrap; height: 14px; line-height: 14px; text-align: center;" title="Outras Orientações">Out.</div>
      </div>
    `;

    return `
      <div style="height: 100%; display: flex; flex-direction: column; padding: 15px; margin-top: 10px; background-color: ${this.COLORS.backgroundSubHeader}; border-top: 1px solid ${this.COLORS.border}; box-sizing: border-box;">
        <div style="font-weight: bold; margin-bottom: 25px; color: ${this.COLORS.footerText};">Orientações por Ano</div>
        <div style="display: flex; align-items: flex-end; flex-grow: 1; min-height: 150px; padding-bottom: 10px; border-bottom: 1px solid ${this.COLORS.border};">
          ${barsHTML}
        </div>
      </div>
    `;
  },

  generateRidTableHTML: function(ridStats, researcherIdLink, isUnlocked) {
    if (!ridStats || !researcherIdLink) return '';

    const safeLink = this._safeUrl(researcherIdLink);
    const ridId = this._esc(String(researcherIdLink).split('/').pop());

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
              <td style="padding: 8px; text-align: left;">${safeLink ? `<a href="${safeLink}" target="_blank" style="color: #1565C0; text-decoration: none;">${ridId}</a>` : ridId}</td>
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
              <td style="padding: 8px; text-align: left;">Últimos 10 anos</td>
              <td style="padding: 8px; text-align: center;">${last10.total.count}</td>
              <td style="padding: 8px; text-align: center;">${last10.total.countWithJcr}</td>
              <td style="padding: 8px; border-left: 1px solid #eee; text-align: center;">${getVal(last10, 'wos', 'sum')}</td>
              <td style="padding: 8px; text-align: center;">${getVal(last10, 'wos', 'hIndex')}</td>
              <td style="padding: 8px; border-left: 1px solid #eee; text-align: center;">${getVal(last10, 'scopus', 'sum')}</td>
              <td style="padding: 8px; text-align: center;">${getVal(last10, 'scopus', 'hIndex')}</td>
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
              <td style="padding: 8px; text-align: left;">${stats.customYears} ${stats.customYears == 1 || stats.customYears == 0 ? 'ano' : 'anos'}</td>
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
              <td style="padding: 8px; border-left: 1px solid #ccc; text-align: center;">${declaredCitations.wosCitations !== '' ? this._esc(declaredCitations.wosCitations) : '-'}</td>
              <td style="padding: 8px; text-align: center;">${declaredCitations.wosHIndex !== '' ? this._esc(declaredCitations.wosHIndex) : '-'}</td>
              <td style="padding: 8px; border-left: 1px solid #ccc; text-align: center;">${declaredCitations.scopusCitations !== '' ? this._esc(declaredCitations.scopusCitations) : '-'}</td>
              <td style="padding: 8px; text-align: center;">${declaredCitations.scopusHIndex !== '' ? this._esc(declaredCitations.scopusHIndex) : '-'}</td>
            </tr>` : ''}
          </tbody>
        </table>
      </div>
    `;
  },

  generateSupervisionTableHTML: function(stats, customYears) {
    const { supervisions } = stats;
    if (!supervisions || (!supervisions.inCourse && !supervisions.concluded && (!supervisions.raw || supervisions.raw.length === 0))) return '';

    if (!supervisions.raw || supervisions.raw.length === 0) {
        // Fallback for older databases
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
              <td style="padding: 8px; text-align: left;">${this._esc(cat)}</td>
              <td style="padding: 8px; text-align: center; border-left: 1px solid #eee;">${inCourse}</td>
              <td style="padding: 8px; text-align: center; border-left: 1px solid #eee;">${totalConcluded}</td>
              <td style="padding: 8px; text-align: center;">${countLast10}</td>
              <td style="padding: 8px; text-align: center;">${countRecent}</td>
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
                  <th style="padding: 8px; text-align: center;">10 Anos</th>
                  <th style="padding: 8px; text-align: center;">5 Anos</th>
                  <th style="padding: 8px; text-align: center;">${customYears} ${customYears == 1 || customYears == 0 ? 'Ano' : 'Anos'}</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>
        `;
    }

    const currentYear = new Date().getFullYear();
    const tree = {};

    supervisions.raw.forEach(item => {
        let type = item.category || 'Outros';
        let inst = item.institution || 'Não especificada';
        let area = item.area || 'Não especificada';
        
        // Retroactively extract area and institution for old DB entries
        if (item.reference && (!item.area && !item.institution)) {
            const cleanText = item.reference;
            let searchStr = cleanText;
            const yearMatches = cleanText.match(/\b(?:19|20)\d{2}\b/g);
            if (yearMatches && yearMatches.length > 0) {
                const lastYear = yearMatches[yearMatches.length - 1];
                const lastYearIndex = cleanText.lastIndexOf(lastYear);
                searchStr = cleanText.substring(lastYearIndex + 4);
            }

            const areaInstMatch = searchStr.match(/\(([^)]+)\)\s*-\s*([^,.]+)/);
            if (areaInstMatch) {
                area = areaInstMatch[1].trim();
                inst = areaInstMatch[2].trim();
            } else {
                const natureMatch = cleanText.match(/(?:natureza|natureza\.)\s*-\s*([^,.]+)/);
                if (natureMatch) {
                    inst = natureMatch[1].trim();
                } else {
                    let lastYearMatchStr = null;
                    const regex = /\b(?:19|20)\d{2}\.\s+([^,.]+)/g;
                    let match;
                    while ((match = regex.exec(cleanText)) !== null) {
                        lastYearMatchStr = match[1];
                    }
                    if (lastYearMatchStr) {
                        inst = lastYearMatchStr.trim();
                    }
                }
            }
        }

        const typeKey = type.toLowerCase();
        const instKey = inst.toLowerCase();
        const areaKey = area.toLowerCase();

        if (!tree[typeKey]) tree[typeKey] = { name: type, institutions: {} };
        if (!tree[typeKey].institutions[instKey]) tree[typeKey].institutions[instKey] = { name: inst, areas: {} };
        if (!tree[typeKey].institutions[instKey].areas[areaKey]) {
            tree[typeKey].institutions[instKey].areas[areaKey] = {
                name: area,
                inCourse: 0,
                concluded: 0,
                recent: 0,
                last10: 0,
                custom: 0
            };
        }

        const leaf = tree[typeKey].institutions[instKey].areas[areaKey];

        if (item.status === 'Em andamento') {
            leaf.inCourse++;
        } else {
            leaf.concluded++;
            if (!isNaN(item.year)) {
                if (item.year >= currentYear - 5) leaf.recent++;
                if (item.year >= currentYear - 10) leaf.last10++;
                if (item.year >= currentYear - customYears) leaf.custom++;
            }
        }
    });

    const genId = () => 'jcr_sup_' + Math.random().toString(36).substr(2, 9);
    let rows = '';
    const sortKeys = (obj) => Object.keys(obj).sort((a,b) => obj[a].name.localeCompare(obj[b].name));

    sortKeys(tree).forEach(tKey => {
        const typeNode = tree[tKey];
        const typeId = genId();
        
        let tInCourse = 0, tConcluded = 0, tRecent = 0, tLast10 = 0, tCustom = 0;
        let instRows = '';

        sortKeys(typeNode.institutions).forEach(iKey => {
            const instNode = typeNode.institutions[iKey];
            const instId = genId();
            
            let iInCourse = 0, iConcluded = 0, iRecent = 0, iLast10 = 0, iCustom = 0;
            let areaRows = '';

            const areaKeys = sortKeys(instNode.areas);
            // If there's only one area and it's "Não especificada", don't render the area level
            const showAreas = !(areaKeys.length === 1 && instNode.areas[areaKeys[0]].name === 'Não especificada');

            areaKeys.forEach(aKey => {
                const areaNode = instNode.areas[aKey];
                
                iInCourse += areaNode.inCourse;
                iConcluded += areaNode.concluded;
                iRecent += areaNode.recent;
                iLast10 += areaNode.last10;
                iCustom += areaNode.custom;

                if (showAreas) {
                    areaRows += `
                      <tr class="child-of-${instId} child-of-${typeId}-all" style="border-bottom: 1px solid #eee; display: none; background-color: #fafafa;">
                        <td style="padding: 6px 8px 6px 40px; text-align: left; font-size: 0.9em; color: #555;">└ ${this._esc(areaNode.name)}</td>
                        <td style="padding: 6px 8px; text-align: center; border-left: 1px solid #eee;">${areaNode.inCourse}</td>
                        <td style="padding: 6px 8px; text-align: center; border-left: 1px solid #eee;">${areaNode.concluded}</td>
                        <td style="padding: 6px 8px; text-align: center;">${areaNode.last10}</td>
                        <td style="padding: 6px 8px; text-align: center;">${areaNode.recent}</td>
                        <td style="padding: 6px 8px; text-align: center;">${areaNode.custom}</td>
                      </tr>
                    `;
                }
            });

            tInCourse += iInCourse;
            tConcluded += iConcluded;
            tRecent += iRecent;
            tLast10 += iLast10;
            tCustom += iCustom;

            const instToggleScript = showAreas 
                ? `onclick="const els = document.querySelectorAll('.child-of-${instId}'); els.forEach(el => { el.style.display = el.style.display === 'none' ? 'table-row' : 'none'; }); const icon = this.querySelector('.inst-icon'); if(icon) icon.textContent = icon.textContent === '▶' ? '▼' : '▶';"` 
                : '';

            instRows += `
              <tr class="child-of-${typeId}" style="border-bottom: 1px solid #eee; display: none; background-color: #fdfdfd; ${showAreas ? 'cursor: pointer;' : ''}" ${instToggleScript}>
                <td style="padding: 6px 8px 6px 25px; text-align: left; font-size: 0.95em;">
                  ${showAreas ? '<span class="inst-icon" style="display:inline-block; width: 15px; font-size:0.8em; color:#888;">▶</span>' : '<span style="display:inline-block; width: 15px;"></span>'}
                  ${this._esc(instNode.name)}
                </td>
                <td style="padding: 6px 8px; text-align: center; border-left: 1px solid #eee;">${iInCourse}</td>
                <td style="padding: 6px 8px; text-align: center; border-left: 1px solid #eee;">${iConcluded}</td>
                <td style="padding: 6px 8px; text-align: center;">${iLast10}</td>
                <td style="padding: 6px 8px; text-align: center;">${iRecent}</td>
                <td style="padding: 6px 8px; text-align: center;">${iCustom}</td>
              </tr>
            `;
            
            if (showAreas) {
                instRows += areaRows;
            }
        });

        const typeToggleScript = `onclick="
            const els = document.querySelectorAll('.child-of-${typeId}'); 
            const isExpanding = this.querySelector('.type-icon').textContent === '▶';
            if (!isExpanding) {
                // hide all descendants
                document.querySelectorAll('.child-of-${typeId}, .child-of-${typeId}-all').forEach(el => el.style.display = 'none');
                // reset institution icons
                document.querySelectorAll('.child-of-${typeId} .inst-icon').forEach(icon => icon.textContent = '▶');
            } else {
                // show direct children
                els.forEach(el => el.style.display = 'table-row');
            }
            const icon = this.querySelector('.type-icon'); 
            if(icon) icon.textContent = isExpanding ? '▼' : '▶';
        "`;

        rows += `
          <tr style="border-bottom: 1px solid #ddd; background-color: #fff; cursor: pointer;" ${typeToggleScript}>
            <td style="padding: 8px; text-align: left; font-weight: bold;">
              <span class="type-icon" style="display:inline-block; width: 15px; font-size:0.8em; color:#555;">▶</span>
              ${this._esc(typeNode.name)}
            </td>
            <td style="padding: 8px; text-align: center; border-left: 1px solid #ccc; font-weight: bold;">${tInCourse}</td>
            <td style="padding: 8px; text-align: center; border-left: 1px solid #ccc; font-weight: bold;">${tConcluded}</td>
            <td style="padding: 8px; text-align: center; font-weight: bold;">${tLast10}</td>
            <td style="padding: 8px; text-align: center; font-weight: bold;">${tRecent}</td>
            <td style="padding: 8px; text-align: center; font-weight: bold;">${tCustom}</td>
          </tr>
        `;
        rows += instRows;
    });

    return `
      <div class="rodape-cv" style="margin-top: 10px; color: ${this.COLORS.footerText}; font-size: 1.1em;">
        <table style="width: 100%; border-collapse: collapse; text-align: center; font-family: inherit; font-size: 0.9em;">
          <thead>
            <tr style="background-color: ${this.COLORS.backgroundHeader}; border-bottom: 1px solid ${this.COLORS.border};">
              <th style="padding: 8px; text-align: left;">Orientações</th>
              <th style="padding: 8px; text-align: center; border-left: 1px solid #ccc;">Em Andamento</th>
              <th style="padding: 8px; text-align: center; border-left: 1px solid #ccc;">Concluídas</th>
              <th style="padding: 8px; text-align: center;">10 Anos</th>
              <th style="padding: 8px; text-align: center;">5 Anos</th>
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
          <td style="padding: 8px; text-align: left;">${this._esc(status)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.all, status)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.last10, status)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.recent, status)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.custom, status)}</td>
        </tr>
      `;
    });

    rowsHtml += `
      <tr style="border-bottom: 1px solid #ddd; background-color: ${this.COLORS.backgroundSubHeader}; font-weight: bold;">
        <td style="padding: 8px; text-align: left;">Total</td>
        <td style="padding: 8px; text-align: center;">${stats.all.patents.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.last10.patents.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.recent.patents.total}</td>
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
              <th style="padding: 8px; text-align: center;">10 Anos</th>
              <th style="padding: 8px; text-align: center;">5 Anos</th>
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
          <td style="padding: 8px; text-align: left;">${this._esc(type)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.all, type)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.last10, type)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.recent, type)}</td>
          <td style="padding: 8px; text-align: center;">${getCount(stats.custom, type)}</td>
        </tr>
      `;
    });

    rowsHtml += `
      <tr style="border-bottom: 1px solid #ddd; background-color: ${this.COLORS.backgroundSubHeader}; font-weight: bold;">
        <td style="padding: 8px; text-align: left;">Total</td>
        <td style="padding: 8px; text-align: center;">${stats.all.events.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.last10.events.total}</td>
        <td style="padding: 8px; text-align: center;">${stats.recent.events.total}</td>
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
              <th style="padding: 8px; text-align: center;">10 Anos</th>
              <th style="padding: 8px; text-align: center;">5 Anos</th>
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

  _esc: function(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  // Escapa e valida uma URL para uso em atributo href ('' se não for http/https)
  _safeUrl: function(url) {
    const s = String(url || '');
    return /^https?:\/\//i.test(s) ? this._esc(s) : '';
  },

  generateJournalTableHTML: function(publications, yearsCutoff, minPapers, currentYear, highJcr, lowJcr) {
    const COLORS = this.COLORS;
    const startYear = yearsCutoff > 0 ? currentYear - yearsCutoff : 0;

    const stripName = (raw) => {
      let n = raw.trim();
      let prev;
      do { prev = n; n = n.replace(/\s*\([^)]*\)\s*$/, '').trim(); } while (n !== prev);
      return n;
    };

    const pickDisplayName = (nameCounts) =>
      Object.entries(nameCounts).reduce((best, [n, c]) => c > best[1] ? [n, c] : best, ['', 0])[0];

    // Phase 1: separate buckets for ISSN, no-ISSN-with-JIF, and no-ISSN-without-JIF.
    // nameCounts keys are original-case stripped names; use .toLowerCase() when comparing across groups.
    const issnGroups  = {}; // { [issn]: { nameCounts, jif, bestIssn, count, wos, scopus } }
    const noIssnByJif = {}; // { [lk]: { [jifStr]: { nameCounts, issn, count, wos, scopus } } }
    const noIssnZero  = {}; // { [lk]: { nameCounts, issn, count, wos, scopus } }

    for (const pub of publications) {
      if (!pub.journalName) continue;
      const y = parseInt(pub.year, 10);
      if (isNaN(y) || (yearsCutoff > 0 && y < startYear)) continue;
      const stripped = stripName(pub.journalName);
      if (!stripped) continue;
      const lk = stripped.toLowerCase();
      const rawJif = pub.impactFactor !== undefined ? pub.impactFactor : pub.jif;
      const pubJif = parseFloat(rawJif) || 0;
      const issn = (pub.issn && pub.issn.trim() !== '-') ? pub.issn.trim() : '';

      if (issn) {
        if (!issnGroups[issn]) issnGroups[issn] = { nameCounts: {}, jif: 0, bestIssn: issn, count: 0, wos: 0, scopus: 0 };
        const g = issnGroups[issn];
        g.nameCounts[stripped] = (g.nameCounts[stripped] || 0) + 1;
        g.count++;
        g.wos += pub.wosCitations || 0;
        g.scopus += pub.scopusCitations || 0;
        if (pubJif > 0 && !g.jif) g.jif = pubJif;
      } else if (pubJif > 0) {
        if (!noIssnByJif[lk]) noIssnByJif[lk] = {};
        const jifStr = pubJif.toFixed(3);
        if (!noIssnByJif[lk][jifStr]) noIssnByJif[lk][jifStr] = { nameCounts: {}, issn: '', count: 0, wos: 0, scopus: 0 };
        const b = noIssnByJif[lk][jifStr];
        b.nameCounts[stripped] = (b.nameCounts[stripped] || 0) + 1;
        b.count++; b.wos += pub.wosCitations || 0; b.scopus += pub.scopusCitations || 0;
      } else {
        if (!noIssnZero[lk]) noIssnZero[lk] = { nameCounts: {}, issn: '', count: 0, wos: 0, scopus: 0 };
        const b = noIssnZero[lk];
        b.nameCounts[stripped] = (b.nameCounts[stripped] || 0) + 1;
        b.count++; b.wos += pub.wosCitations || 0; b.scopus += pub.scopusCitations || 0;
      }
    }

    // Phase 1.5: flatten no-ISSN buckets into noIssnGroups (order-independent JIF splitting).
    // Zero-JIF papers are merged into the most-populous non-zero JIF group for their name.
    // If multiple non-zero JIF groups share a name they are different journals → stay separate.
    const noIssnGroups = {};
    for (const lk of new Set([...Object.keys(noIssnByJif), ...Object.keys(noIssnZero)])) {
      const byJif = noIssnByJif[lk] || {};
      const zero  = noIssnZero[lk];
      const nonZeroKeys = Object.keys(byJif);
      const mainJifStr  = nonZeroKeys.length > 0
        ? nonZeroKeys.reduce((best, k) => byJif[k].count > byJif[best].count ? k : best)
        : null;

      for (const jifStr of nonZeroKeys) {
        const b = byJif[jifStr];
        noIssnGroups[lk + '|' + jifStr] = { nameCounts: { ...b.nameCounts }, issn: b.issn, jif: parseFloat(jifStr), count: b.count, wos: b.wos, scopus: b.scopus };
      }
      if (zero) {
        if (mainJifStr) {
          const m = noIssnGroups[lk + '|' + mainJifStr];
          m.count += zero.count; m.wos += zero.wos; m.scopus += zero.scopus;
          if (zero.issn && !m.issn) m.issn = zero.issn;
          for (const [n, c] of Object.entries(zero.nameCounts)) m.nameCounts[n] = (m.nameCounts[n] || 0) + c;
        } else {
          noIssnGroups[lk] = { nameCounts: { ...zero.nameCounts }, issn: zero.issn, jif: 0, count: zero.count, wos: zero.wos, scopus: zero.scopus };
        }
      }
    }

    // Phase 2: merge ISSN groups that share a name and have compatible JIFs (union-find).
    const issnKeys = Object.keys(issnGroups);
    const parent = Object.fromEntries(issnKeys.map(k => [k, k]));
    const find = k => { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

    for (let i = 0; i < issnKeys.length; i++) {
      const gi = issnGroups[issnKeys[i]];
      const niLower = new Set(Object.keys(gi.nameCounts).map(n => n.toLowerCase()));
      for (let j = i + 1; j < issnKeys.length; j++) {
        const gj = issnGroups[issnKeys[j]];
        if (gi.jif > 0 && gj.jif > 0 && Math.abs(gi.jif - gj.jif) > 0.001) continue;
        if (Object.keys(gj.nameCounts).some(n => niLower.has(n.toLowerCase()))) union(issnKeys[i], issnKeys[j]);
      }
    }

    const mergedIssnGroups = {};
    for (const issn of issnKeys) {
      const root = find(issn);
      if (!mergedIssnGroups[root]) mergedIssnGroups[root] = { nameCounts: {}, jif: 0, bestIssn: '', count: 0, wos: 0, scopus: 0 };
      const m = mergedIssnGroups[root], g = issnGroups[issn];
      for (const [n, c] of Object.entries(g.nameCounts)) m.nameCounts[n] = (m.nameCounts[n] || 0) + c;
      m.count += g.count; m.wos += g.wos; m.scopus += g.scopus;
      if (g.jif > 0 && !m.jif) m.jif = g.jif;
      if (g.bestIssn && !m.bestIssn) m.bestIssn = g.bestIssn;
    }
    for (const m of Object.values(mergedIssnGroups)) m.displayName = pickDisplayName(m.nameCounts);

    // Phase 2b: merge noIssnGroups entries sharing the same ISSN and compatible JIF (union-find).
    const ngKeys = Object.keys(noIssnGroups);
    const ngPar = Object.fromEntries(ngKeys.map(k => [k, k]));
    const ngFind = k => { while (ngPar[k] !== k) { ngPar[k] = ngPar[ngPar[k]]; k = ngPar[k]; } return k; };
    const ngUnion = (a, b) => { const ra = ngFind(a), rb = ngFind(b); if (ra !== rb) ngPar[ra] = rb; };
    const issnToNgKeys = {};
    for (const key of ngKeys) {
      const iss = noIssnGroups[key].issn;
      if (!iss) continue;
      if (!issnToNgKeys[iss]) issnToNgKeys[iss] = [];
      issnToNgKeys[iss].push(key);
    }
    for (const keys of Object.values(issnToNgKeys)) {
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const gi = noIssnGroups[keys[i]], gj = noIssnGroups[keys[j]];
          if (gi.jif > 0 && gj.jif > 0 && Math.abs(gi.jif - gj.jif) > 0.001) continue;
          ngUnion(keys[i], keys[j]);
        }
      }
    }
    const mergedNoIssnGroups = {};
    for (const key of ngKeys) {
      const root = ngFind(key);
      if (!mergedNoIssnGroups[root]) mergedNoIssnGroups[root] = { nameCounts: {}, issn: '', jif: 0, count: 0, wos: 0, scopus: 0 };
      const m = mergedNoIssnGroups[root], g = noIssnGroups[key];
      m.count += g.count; m.wos += g.wos; m.scopus += g.scopus;
      if (g.jif > 0 && !m.jif) m.jif = g.jif;
      if (g.issn && !m.issn) m.issn = g.issn;
      for (const [n, c] of Object.entries(g.nameCounts)) m.nameCounts[n] = (m.nameCounts[n] || 0) + c;
    }
    for (const m of Object.values(mergedNoIssnGroups)) m.displayName = pickDisplayName(m.nameCounts);

    // Phase 3: absorb no-ISSN groups into matching ISSN groups (all name variants checked);
    // remainder become standalone rows.
    const noIssnRows = [];
    for (const ng of Object.values(mergedNoIssnGroups)) {
      const ngLower = new Set(Object.keys(ng.nameCounts).map(n => n.toLowerCase()));
      let absorbed = false;
      for (const m of Object.values(mergedIssnGroups)) {
        const mLower = new Set(Object.keys(m.nameCounts).map(n => n.toLowerCase()));
        if (![...ngLower].some(n => mLower.has(n))) continue;
        if (ng.jif > 0 && m.jif > 0 && Math.abs(ng.jif - m.jif) > 0.001) continue;
        m.count += ng.count; m.wos += ng.wos; m.scopus += ng.scopus;
        if (ng.jif > 0 && !m.jif) m.jif = ng.jif;
        for (const [n, c] of Object.entries(ng.nameCounts)) m.nameCounts[n] = (m.nameCounts[n] || 0) + c;
        m.displayName = pickDisplayName(m.nameCounts);
        absorbed = true; break;
      }
      if (!absorbed) noIssnRows.push({ name: ng.displayName, issn: ng.issn || '', jif: ng.jif, count: ng.count, wos: ng.wos, scopus: ng.scopus });
    }

    const allJournals = [
      ...Object.values(mergedIssnGroups).map(m => ({ name: m.displayName, issn: m.bestIssn, jif: m.jif, count: m.count, wos: m.wos, scopus: m.scopus })),
      ...noIssnRows
    ];

    const rows = allJournals.filter(j => j.count >= minPapers).sort((a, b) => b.count - a.count || b.jif - a.jif);
    const totalOmitted = allJournals.length - rows.length;

    if (rows.length === 0) {
      const msg = allJournals.length === 0
        ? 'Nenhuma publicação com dados de periódico encontrada neste período.'
        : `Todos os ${allJournals.length} periódico(s) têm menos de ${minPapers} artigo(s). Reduza o mínimo de artigos.`;
      return `<div style="padding: 15px; color: #777; text-align: center;">${msg}</div>`;
    }

    let rowsHTML = '';
    rows.forEach((j, idx) => {
      let jifColor = '#555';
      if (j.jif > 0) {
        if (j.jif >= highJcr) jifColor = COLORS.highJcr;
        else if (j.jif >= lowJcr) jifColor = COLORS.midJcr;
        else jifColor = COLORS.lowJcr;
      }
      const bg = idx % 2 !== 0 ? `background: ${COLORS.backgroundSubHeader};` : '';
      rowsHTML += `
        <tr style="border-bottom: 1px solid ${COLORS.borderLight}; ${bg}">
          <td style="padding: 7px 8px; text-align: left; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${this._esc(j.name)}">${this._esc(j.name)}</td>
          <td style="padding: 7px 8px; text-align: center;" data-val="${j.jif}"><strong style="color: ${jifColor};">${j.jif > 0 ? j.jif.toFixed(3) : '—'}</strong></td>
          <td style="padding: 7px 8px; text-align: center;">${this._esc(j.issn) || '—'}</td>
          <td style="padding: 7px 8px; text-align: center; font-weight: bold;" data-val="${j.count}">${j.count}</td>
          <td style="padding: 7px 8px; text-align: center;" data-val="${j.wos}">${j.wos > 0 ? j.wos : '—'}</td>
          <td style="padding: 7px 8px; text-align: center;" data-val="${j.scopus}">${j.scopus > 0 ? j.scopus : '—'}</td>
        </tr>`;
    });

    const footerNote = totalOmitted > 0
      ? `<div style="padding: 8px; color: #999; font-size: 0.85em; text-align: right;">${totalOmitted} periódico(s) omitido(s) por ter(em) menos de ${minPapers} artigo(s).</div>`
      : '';

    return `
      <div style="overflow-x: auto;">
        <table id="journal-table" style="width: 100%; border-collapse: collapse; font-size: 0.9em; font-family: inherit;">
          <thead>
            <tr style="background: ${COLORS.backgroundHeader}; border-bottom: 2px solid ${COLORS.border}; user-select: none;">
              <th data-sort-col="0" data-sort-type="str" style="padding: 8px; text-align: left; cursor: pointer; white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis;">Periódico</th>
              <th data-sort-col="1" data-sort-type="num" style="padding: 8px; text-align: center; cursor: pointer; white-space: nowrap;">JCR</th>
              <th data-sort-col="2" data-sort-type="str" style="padding: 8px; text-align: center; cursor: pointer; white-space: nowrap;">ISSN</th>
              <th data-sort-col="3" data-sort-type="num" style="padding: 8px; text-align: center; cursor: pointer; white-space: nowrap;">Nº Artigos</th>
              <th data-sort-col="4" data-sort-type="num" style="padding: 8px; text-align: center; cursor: pointer; white-space: nowrap;">Cit. WoS</th>
              <th data-sort-col="5" data-sort-type="num" style="padding: 8px; text-align: center; cursor: pointer; white-space: nowrap;">Cit. Scopus</th>
            </tr>
          </thead>
          <tbody id="journal-table-body">
            ${rowsHTML}
          </tbody>
        </table>
        ${footerNote}
      </div>`;
  }
};
