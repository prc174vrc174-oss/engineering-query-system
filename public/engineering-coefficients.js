(function (global) {
  'use strict';

  var materials = ['SPHC', 'SPCC', 'SGCC', 'SECC', 'SPTE', 'SK', 'SUS', 'AL'];
  var commonLists = {
    SPHC: [1.6, 2, 2.3, 2.5, 2.6, 2.8, 3, 3.2, 3.5, 4, 4.5, 5, 6, 7, 8, 9, 10, 12],
    SPCC: [0.5, 0.6, 0.4, 0.8, 1, 1.2, 1.5, 1.6, 1.8, 2, 2.3, 2.5, 2.6, 3],
    SGCC: [0.5, 0.6, 0.8, 1, 1.2, 1.5, 1.6, 2, 2.3, 2.5, 3, 3.2, 4],
    SECC: [0.5, 0.6, 0.8, 1, 1.2, 1.4, 1.5, 1.6, 2],
    SPTE: [0.15, 0.2, 0.3, 0.4, 0.5, 0.8],
    SK: [0.5, 0.8, 1, 1.2, 1.5, 1.6, 1.8, 2, 2.3, 2.5, 2.8, 3, 3.2, 3.5, 4, 4.5, 5, 6],
    SUS: [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1, 1.2, 1.5, 1.6, 2, 2.5, 3, 4, 5, 6, 8],
    AL: [0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 1.6, 2, 2.3, 2.5, 3, 3.2, 4, 5, 6]
  };

  var bendRows = [
    [0.1,  {SPHC:'0',SPCC:'0',SGCC:'0',SECC:'0',SPTE:'0',SK:'**',SUS:'0',AL:'0'}],
    [0.25, {SPHC:'**',SPCC:'**',SGCC:'**',SECC:'**',SPTE:'**',SK:'**',SUS:0.2,AL:'**'}],
    [0.3,  {SPHC:0.33,SPCC:0.33,SGCC:0.33,SECC:0.33,SPTE:0.33,SK:'**',SUS:0.33,AL:0.33}],
    [0.4,  {SPHC:0.4,SPCC:0.4,SGCC:0.4,SECC:0.4,SPTE:0.4,SK:'**',SUS:0.3,AL:0.4}],
    [0.5,  {SPHC:0.4,SPCC:0.4,SGCC:0.4,SECC:0.4,SPTE:0.4,SK:'**',SUS:0.3,AL:0.4}],
    [0.7,  {SPHC:0.4,SPCC:0.4,SGCC:0.4,SECC:0.4,SPTE:0.4,SK:'**',SUS:0.3,AL:0.4}],
    [1,    {SPHC:0.4,SPCC:0.4,SGCC:0.4,SECC:0.4,SPTE:0.4,SK:'**',SUS:0.33,AL:0.4}],
    [1.2,  {SPHC:0.4,SPCC:0.4,SGCC:0.4,SECC:0.4,SPTE:0.4,SK:'**',SUS:0.33,AL:0.4}],
    [1.5,  {SPHC:0.4,SPCC:0.4,SGCC:0.4,SECC:0.4,SPTE:0.4,SK:'**',SUS:0.33,AL:0.4}],
    [2,    {SPHC:0.4,SPCC:0.4,SGCC:0.4,SECC:0.4,SPTE:0.4,SK:'**',SUS:0.33,AL:0.4}],
    [2.3,  {SPHC:0.4,SPCC:0.4,SGCC:0.4,SECC:0.4,SPTE:0.4,SK:'**',SUS:'**',AL:0.4}],
    [2.5,  {SPHC:0.36,SPCC:0.36,SGCC:0.36,SECC:0.36,SPTE:0.36,SK:'**',SUS:0.3,AL:0.38}],
    [2.6,  {SPHC:0.4,SPCC:0.4,SGCC:0.4,SECC:0.4,SPTE:0.4,SK:'**',SUS:'**',AL:'**'}],
    [2.8,  {SPHC:0.33,SPCC:0.33,SGCC:0.33,SECC:0.33,SPTE:0.33,SK:'**',SUS:'**',AL:'**'}],
    [3,    {SPHC:0.37,SPCC:0.37,SGCC:0.37,SECC:0.37,SPTE:0.37,SK:'**',SUS:0.27,AL:0.4}],
    [3.2,  {SPHC:0.33,SPCC:0.33,SGCC:0.33,SECC:0.33,SPTE:0.33,SK:'**',SUS:'**',AL:0.4}],
    [3.5,  {SPHC:0.4,SPCC:0.4,SGCC:0.4,SECC:0.4,SPTE:0.4,SK:'**',SUS:0.3,AL:0.4}],
    [4,    {SPHC:0.35,SPCC:0.35,SGCC:0.35,SECC:0.35,SPTE:0.35,SK:'**',SUS:0.25,AL:0.41}],
    [4.5,  {SPHC:0.34,SPCC:0.34,SGCC:0.34,SECC:0.34,SPTE:0.34,SK:'**',SUS:'**',AL:'**'}],
    [5,    {SPHC:0.32,SPCC:0.32,SGCC:0.32,SECC:0.32,SPTE:0.32,SK:'**',SUS:0.24,AL:0.4}],
    [6,    {SPHC:0.35,SPCC:0.35,SGCC:0.35,SECC:0.35,SPTE:0.35,SK:'**',SUS:0.29,AL:0.385}],
    [7,    {SPHC:0.38,SPCC:0.38,SGCC:0.38,SECC:0.38,SPTE:0.38,SK:'**',SUS:0.34,AL:'**'}],
    [8,    {SPHC:0.38,SPCC:0.38,SGCC:0.38,SECC:0.38,SPTE:0.38,SK:'**',SUS:0.34,AL:'**'}]
  ];

  var reverseRows = [
    [0.5, {SPHC:0.3,SPCC:0.3,SGCC:0.3,SECC:0.3,SPTE:0.3,SUS:0.3,AL:0.2}],
    [0.8, {SPHC:0.3,SPCC:0.3,SGCC:0.3,SECC:0.3,SPTE:0.3,SUS:0.3,AL:0.3}],
    [1,   {SPHC:0.4,SPCC:0.4,SGCC:0.4,SECC:0.4,SPTE:0.4,SUS:0.4,AL:0.4}],
    [1.2, {SPHC:0.5,SPCC:0.5,SGCC:0.5,SECC:0.5,SPTE:0.5,SUS:0.5,AL:0.35}],
    [1.5, {SPHC:0.8,SPCC:0.8,SGCC:0.8,SECC:0.8,SPTE:0.8,SUS:0.8,AL:0.35}],
    [1.6, {SPHC:0.86,SPCC:0.86,SGCC:0.86,SECC:0.86,SPTE:0.86,SUS:0.86,AL:0.35}],
    [2,   {SPHC:1.1,SPCC:1.1,SGCC:1.1,SECC:1.1,SPTE:1.1,SUS:1.1,AL:1}]
  ];

  var rFactorRows = [[0.1, 0], [0.2, 0.5], [2.3, 0.4], [10, 0.4]];

  function number(value) {
    if (value === null || value === undefined || value === '' || value === '**') return NaN;
    var parsed = parseFloat(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function approximate(rows, target) {
    var value = number(target);
    if (!Number.isFinite(value)) return null;
    var best = null;
    rows.forEach(function (row) {
      if (row[0] <= value) best = row;
    });
    return best;
  }

  function thicknesses(material) {
    var list = commonLists[material] || [];
    return Array.from(new Set(list.map(String))).sort(function (a, b) { return number(a) - number(b); });
  }

  function materialOptions() {
    return [{value:'', label:''}].concat(materials.map(function (value) {
      return {value:value, label:value === 'SK' ? 'SK（僅用於簡模）' : value};
    }));
  }

  function thicknessOptions(material) {
    return [{value:'', label:''}].concat(thicknesses(material).map(function (value) {
      return {value:value, label:material === 'SUS' && value === '1.6' ? '1.6（叫不到料）' : value};
    }));
  }

  function hasThickness(material, thickness) {
    return thicknesses(material).indexOf(String(thickness || '')) >= 0;
  }

  function lookup(material, thickness) {
    var t = number(thickness);
    var bend = approximate(bendRows, t);
    var reverse = approximate(reverseRows, t);
    var rate = number(bend && bend[1] ? bend[1][material] : NaN);
    var m = Number.isFinite(t) && Number.isFinite(rate) ? t * rate : NaN;
    var bd = Number.isFinite(t) && Number.isFinite(m) ? 2 * t - m : NaN;
    var f = number(reverse && reverse[1] ? reverse[1][material] : NaN);
    var rFactor = approximate(rFactorRows, t);
    var kf = number(rFactor ? rFactor[1] : NaN);
    return {rate:rate, m:m, bd:bd, f:f, kf:kf};
  }

  global.EngineeringCoefficients = Object.freeze({
    materials: materials.slice(),
    materialOptions: materialOptions,
    thicknesses: thicknesses,
    thicknessOptions: thicknessOptions,
    hasThickness: hasThickness,
    lookup: lookup
  });
})(window);
