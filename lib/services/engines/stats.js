// lib/services/engines/stats.js — pure descriptive-statistics helpers shared
// by the prediction engines and the analytics API routes. No dependencies,
// no side effects, safe on empty input (returns 0 / null / []).
'use strict';

/** Arithmetic mean. 0 for empty input. */
function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

/** Quantile via linear interpolation on the sorted array (0 <= q <= 1).
 *  Returns null for empty input. */
function quantile(arr, q) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Median (the 50th percentile). null for empty input. */
function median(arr) {
  return quantile(arr, 0.5);
}

/**
 * Population standard deviation — the average squared distance from the
 * mean, no Bessel correction (n, not n-1). Descriptive, not inferential:
 * we're describing the observed window, not estimating a population.
 * 0 for empty input.
 */
function std(arr) {
  if (!arr.length) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
}

/** Interquartile range = Q3 - Q1. 0 for empty input. */
function iqr(arr) {
  if (!arr.length) return 0;
  return quantile(arr, 0.75) - quantile(arr, 0.25);
}

function min(arr) {
  if (!arr.length) return null;
  return arr.reduce((m, x) => (x < m ? x : m), arr[0]);
}

function max(arr) {
  if (!arr.length) return null;
  return arr.reduce((m, x) => (x > m ? x : m), arr[0]);
}

/**
 * Wilson score interval for a binomial proportion — the honest way to quote
 * an empirical hit rate. Unlike the naive p ± z·sqrt(p(1-p)/n), the Wilson
 * interval stays inside [0,1] and behaves for small n and extreme rates.
 * Clamped to [0,1]. Returns {lower, upper} as proportions; {lower:0,upper:0}
 * when n <= 0.
 */
function wilsonCI(hits, n, z = 1.96) {
  if (!Number.isFinite(hits) || !Number.isFinite(n) || n <= 0) return { lower: 0, upper: 0 };
  const p = Math.min(1, Math.max(0, hits / n));
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const delta = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  return { lower: clamp01(center - delta), upper: clamp01(center + delta) };
}

/**
 * Even-width histogram: splits [min,max] into `bins` equal bins.
 * Returns [{binStart, binEnd, count}]. [] for empty input; a single bin
 * when all values are identical.
 */
function histogram(arr, bins = 10) {
  if (!arr.length) return [];
  const lo = min(arr);
  const hi = max(arr);
  const b = Math.max(1, Math.floor(bins) || 1);
  if (lo === hi) return [{ binStart: lo, binEnd: hi, count: arr.length }];
  const width = (hi - lo) / b;
  const out = Array.from({ length: b }, (_, i) => ({
    binStart: lo + i * width,
    binEnd: lo + (i + 1) * width,
    count: 0,
  }));
  for (const x of arr) {
    let i = Math.floor((x - lo) / width);
    if (i >= b) i = b - 1; // x === max lands in the last bin
    out[i].count += 1;
  }
  return out;
}

/**
 * Empirical CDF sampled at `points` evenly spaced x values across
 * [min,max]: [{x, p}] where p = P(X <= x). [] for empty input.
 */
function ecdf(arr, points = 100) {
  if (!arr.length) return [];
  const s = [...arr].sort((a, b) => a - b);
  const lo = s[0];
  const hi = s[s.length - 1];
  const npts = Math.max(1, Math.floor(points) || 1);
  if (lo === hi) return [{ x: lo, p: 1 }];
  const out = [];
  for (let i = 0; i < npts; i++) {
    const x = lo + ((hi - lo) * i) / (npts - 1);
    let c = 0;
    for (const v of s) { if (v <= x) c += 1; else break; }
    out.push({ x, p: c / s.length });
  }
  return out;
}

module.exports = { mean, median, std, iqr, quantile, min, max, wilsonCI, histogram, ecdf };
