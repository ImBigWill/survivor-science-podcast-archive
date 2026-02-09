#!/usr/bin/env node

/**
 * Survivor Science Podcast Archive - Static Site Generator
 *
 * Usage:
 *   node build.js                    # Fetch from Buzzsprout RSS URL
 *   node build.js --file feed.rss    # Read from local RSS file
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const RSS_URL = 'https://www.buzzsprout.com/2117363.rss';
const OUTPUT_DIR = __dirname;

// ─── RSS Fetching ───────────────────────────────────────────────────────────

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'SurvivorScienceArchiveBuilder/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchURL(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ─── XML Parsing (simple, no dependencies) ──────────────────────────────────

function getTagContent(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

function getCDATA(text) {
  const match = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return match ? match[1].trim() : text.replace(/<[^>]+>/g, '').trim();
}

function getAttr(xml, tag, attr) {
  const regex = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']*)["']`, 'i');
  const match = xml.match(regex);
  return match ? match[1] : '';
}

function getAllItems(xml) {
  const items = [];
  const regex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    items.push(match[1]);
  }
  return items;
}

function parseEpisode(itemXml) {
  const title = getCDATA(getTagContent(itemXml, 'title'));
  const description = getCDATA(getTagContent(itemXml, 'description'));
  const pubDate = getTagContent(itemXml, 'pubDate');
  const duration = getTagContent(itemXml, 'itunes:duration');
  const episode = getTagContent(itemXml, 'itunes:episode');
  const season = getTagContent(itemXml, 'itunes:season');
  const explicit = getTagContent(itemXml, 'itunes:explicit');
  const summary = getCDATA(getTagContent(itemXml, 'itunes:summary') || getTagContent(itemXml, 'description'));

  // Audio URL from enclosure
  const audioUrl = getAttr(itemXml, 'enclosure', 'url');

  // Episode image
  const episodeImage = getAttr(itemXml, 'itunes:image', 'href');

  // Buzzsprout episode ID from GUID or audio URL
  const guid = getTagContent(itemXml, 'guid');
  let buzzsproutId = '';
  const idMatch = audioUrl.match(/episodes\/(\d+)/);
  if (idMatch) buzzsproutId = idMatch[1];

  // Extract episode number from title if not in itunes:episode
  let episodeNum = episode;
  if (!episodeNum) {
    const numMatch = title.match(/^(\d+)\./);
    if (numMatch) episodeNum = numMatch[1];
  }

  return {
    title: title.replace(/^\d+\.\s*/, ''), // Remove leading number
    fullTitle: title,
    description,
    summary,
    pubDate,
    date: new Date(pubDate),
    duration: formatDuration(duration),
    durationRaw: duration,
    episode: episodeNum,
    season: season || '1',
    explicit: explicit === 'true' || explicit === 'yes',
    audioUrl,
    episodeImage,
    buzzsproutId,
    guid,
  };
}

function formatDuration(seconds) {
  const s = parseInt(seconds, 10);
  if (isNaN(s)) return seconds; // Already formatted as HH:MM:SS
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

function formatDate(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]}. ${date.getDate()}, ${date.getFullYear()}`;
}

function slugify(title, episode) {
  if (episode) return episode;
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ─── HTML Templates ─────────────────────────────────────────────────────────

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripHtml(text) {
  return text.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}

function cleanDescription(text) {
  // Remove Buzzsprout "Send us a text" fan mail prefix
  return text.replace(/^Send us a text\s*/i, '');
}

function truncate(text, maxLen = 200) {
  const plain = cleanDescription(stripHtml(text));
  if (plain.length <= maxLen) return plain;
  return plain.substring(0, maxLen).replace(/\s+\S*$/, '') + '...';
}

function faviconHTML(prefix = '') {
  return `
  <link rel="apple-touch-icon" sizes="180x180" href="${prefix}images/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="${prefix}images/favicon-32x32.png">`;
}

function navHTML(activePage = 'home') {
  return `
  <!-- Top Banner -->
  <div class="top-banner">
    <a href="https://survivorscience.com" target="_blank" rel="noopener">Go to Main Survivor Science Site</a>
  </div>

  <!-- Navigation -->
  <nav class="main-nav">
    <div class="nav-container">
      <a href="index.html" class="nav-logo">
        <img src="images/podcast-artwork.jpg" alt="Survivor Science" class="nav-logo-img">
        <span class="nav-logo-text">Survivor Science</span>
      </a>
      <button class="nav-toggle" aria-label="Toggle navigation">
        <span></span><span></span><span></span>
      </button>
      <div class="nav-links">
        <a href="index.html" class="${activePage === 'home' ? 'active' : ''}">Home</a>
        <a href="about.html" class="${activePage === 'about' ? 'active' : ''}">About</a>
        <a href="episodes.html" class="${activePage === 'episodes' ? 'active' : ''}">Episodes</a>
        <a href="https://survivorscience.com/contact" target="_blank" rel="noopener">Contact</a>
        <div class="nav-social">
          <a href="https://twitter.com/SurvivorSciHQ" target="_blank" rel="noopener" aria-label="Twitter"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>
          <a href="https://www.linkedin.com/in/willschmierer/" target="_blank" rel="noopener" aria-label="LinkedIn"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a>
          <a href="https://www.tiktok.com/@SurvivorScienceHQ" target="_blank" rel="noopener" aria-label="TikTok"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg></a>
          <a href="https://www.instagram.com/SurvivorScienceHQ/" target="_blank" rel="noopener" aria-label="Instagram"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg></a>
          <a href="https://www.youtube.com/@SurvivorScienceHQ" target="_blank" rel="noopener" aria-label="YouTube"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg></a>
        </div>
      </div>
    </div>
  </nav>`;
}

function footerHTML() {
  return `
  <footer class="site-footer">
    <div class="footer-container">
      <div class="footer-about">
        <div class="footer-logo">Survivor Science</div>
        <p>The Survivor Science Podcast is about sharing the struggles, successes, and science behind, navigating your second chance at life!</p>
        <p>We are building a community of survivors of all kinds to learn, grow, share and connect from each other and individual experiences to help others learn what works as well!</p>
        <p>Whether it's tips for managing daily tasks or advice for how to stay motivated, we've got you covered on the road to recovery. You don't have to go out alone!</p>
      </div>
      <div class="footer-links">
        <div class="footer-col">
          <a href="episodes.html">Episodes</a>
          <a href="about.html">About</a>
        </div>
        <div class="footer-col">
          <a href="https://survivorscience.com/contact" target="_blank" rel="noopener">Contact</a>
          <a href="https://survivorscience.com" target="_blank" rel="noopener">Main Site</a>
        </div>
      </div>
      <div class="footer-social">
        <a href="https://twitter.com/SurvivorSciHQ" target="_blank" rel="noopener" aria-label="Twitter"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>
        <a href="https://www.linkedin.com/in/willschmierer/" target="_blank" rel="noopener" aria-label="LinkedIn"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a>
        <a href="https://www.tiktok.com/@SurvivorScienceHQ" target="_blank" rel="noopener" aria-label="TikTok"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg></a>
        <a href="https://www.instagram.com/SurvivorScienceHQ/" target="_blank" rel="noopener" aria-label="Instagram"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg></a>
        <a href="https://www.youtube.com/@SurvivorScienceHQ" target="_blank" rel="noopener" aria-label="YouTube"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg></a>
      </div>
    </div>
    <div class="footer-bottom">
      <span>&copy; Survivor Science</span>
    </div>
  </footer>`;
}

function sidebarHTML(episodes) {
  const recentEps = episodes.slice(0, 10);
  return `
    <aside class="sidebar">
      <div class="sidebar-listen">
        <h3>LISTEN ON</h3>
        <ul class="listen-links">
          <li><a href="https://podcasts.apple.com/us/podcast/survivor-science/id1667418261" target="_blank" rel="noopener"><svg width="20" height="20" viewBox="0 0 24 24" fill="#872ec4"><path d="M5.34 0A5.328 5.328 0 000 5.34v13.32A5.328 5.328 0 005.34 24h13.32A5.328 5.328 0 0024 18.66V5.34A5.328 5.328 0 0018.66 0zm6.525 2.568c2.336 0 4.448.902 6.056 2.587 1.076 1.126 1.772 2.445 2.064 3.93.122.62-.26 1.22-.853 1.342a1.088 1.088 0 01-1.283-.856c-.213-1.078-.72-2.038-1.506-2.86C14.985 5.29 13.4 4.58 11.676 4.6c-1.724.02-3.3.753-4.622 2.18-.79.852-1.27 1.826-1.454 2.91-.152.614-.762.988-1.36.836a1.102 1.102 0 01-.834-1.363c.258-1.494.924-2.833 1.978-3.983 1.582-1.727 3.672-2.655 6.04-2.612zm.18 3.252c1.604.008 3.064.678 4.1 1.804.712.774 1.156 1.678 1.333 2.696.112.638-.316 1.244-.948 1.356a1.102 1.102 0 01-1.282-.88 3.124 3.124 0 00-.764-1.538c-.59-.644-1.426-1.025-2.348-1.035-.928-.012-1.772.352-2.376.984-.434.454-.732.992-.87 1.57-.165.606-.79.964-1.398.798a1.1 1.1 0 01-.79-1.398 5.36 5.36 0 011.503-2.706c.984-1.024 2.33-1.632 3.782-1.654zm-.032 4.804c1.172-.012 2.156.924 2.156 2.124-.002.396-.124.768-.328 1.09l-.004.01-.016.02c-.04.06-.082.117-.127.17l-1.486 3.03c-.248.554-.842.71-1.312.482a.986.986 0 01-.478-1.316l.008-.018 1.112-2.272-.034-.002a2.138 2.138 0 01-.663-.358 2.103 2.103 0 01-.796-1.638c-.008-1.196.798-2.31 1.968-2.322z"/></svg> Apple Podcasts</a></li>
          <li><a href="https://open.spotify.com/show/1Pn79nkerjQ7vXK0V2Wfif" target="_blank" rel="noopener"><svg width="20" height="20" viewBox="0 0 24 24" fill="#1DB954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg> Spotify</a></li>
          <li><a href="https://rss.buzzsprout.com/2117363.rss" target="_blank" rel="noopener"><svg width="20" height="20" viewBox="0 0 24 24" fill="#f26522"><path d="M6.503 20.752c0 1.794-1.456 3.248-3.251 3.248-1.796 0-3.252-1.454-3.252-3.248 0-1.794 1.456-3.248 3.252-3.248 1.795.001 3.251 1.454 3.251 3.248zm-6.503-12.572v4.811c6.05.062 10.96 4.966 11.022 11.009h4.817c-.062-8.71-7.118-15.758-15.839-15.82zm0-8.18v4.819c12.951.115 23.424 10.617 23.5 23.581h4.82c-.077-15.683-12.818-28.395-28.32-28.4z"/></svg> RSS Feed</a></li>
        </ul>
      </div>
      <div class="sidebar-recent">
        <h3>RECENT EPISODES</h3>
        <ul class="recent-episodes-list">
          ${recentEps.map(ep => `
          <li><a href="episodes/${ep.episode}.html">${ep.episode ? ep.episode + '. ' : ''}${ep.title}</a></li>
          `).join('')}
        </ul>
        <a href="episodes.html" class="see-all">See all &rarr;</a>
      </div>
    </aside>`;
}

function listenOnHTML() {
  return `
  <div class="listen-on-buttons">
    <a href="https://podcasts.apple.com/us/podcast/survivor-science/id1667418261" target="_blank" rel="noopener" class="listen-btn"><svg width="20" height="20" viewBox="0 0 24 24" fill="#872ec4"><path d="M5.34 0A5.328 5.328 0 000 5.34v13.32A5.328 5.328 0 005.34 24h13.32A5.328 5.328 0 0024 18.66V5.34A5.328 5.328 0 0018.66 0zm6.525 2.568c2.336 0 4.448.902 6.056 2.587 1.076 1.126 1.772 2.445 2.064 3.93.122.62-.26 1.22-.853 1.342a1.088 1.088 0 01-1.283-.856c-.213-1.078-.72-2.038-1.506-2.86C14.985 5.29 13.4 4.58 11.676 4.6c-1.724.02-3.3.753-4.622 2.18-.79.852-1.27 1.826-1.454 2.91-.152.614-.762.988-1.36.836a1.102 1.102 0 01-.834-1.363c.258-1.494.924-2.833 1.978-3.983 1.582-1.727 3.672-2.655 6.04-2.612zm.18 3.252c1.604.008 3.064.678 4.1 1.804.712.774 1.156 1.678 1.333 2.696.112.638-.316 1.244-.948 1.356a1.102 1.102 0 01-1.282-.88 3.124 3.124 0 00-.764-1.538c-.59-.644-1.426-1.025-2.348-1.035-.928-.012-1.772.352-2.376.984-.434.454-.732.992-.87 1.57-.165.606-.79.964-1.398.798a1.1 1.1 0 01-.79-1.398 5.36 5.36 0 011.503-2.706c.984-1.024 2.33-1.632 3.782-1.654zm-.032 4.804c1.172-.012 2.156.924 2.156 2.124-.002.396-.124.768-.328 1.09l-.004.01-.016.02c-.04.06-.082.117-.127.17l-1.486 3.03c-.248.554-.842.71-1.312.482a.986.986 0 01-.478-1.316l.008-.018 1.112-2.272-.034-.002a2.138 2.138 0 01-.663-.358 2.103 2.103 0 01-.796-1.638c-.008-1.196.798-2.31 1.968-2.322z"/></svg> Apple Podcasts</a>
    <a href="https://open.spotify.com/show/1Pn79nkerjQ7vXK0V2Wfif" target="_blank" rel="noopener" class="listen-btn"><svg width="20" height="20" viewBox="0 0 24 24" fill="#1DB954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg> Spotify</a>
  </div>`;
}

function generateHomePage(episodes, podcastMeta) {
  const latest = episodes[0];
  const recent = episodes.slice(0, 6);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Survivor Science Podcast Archive</title>
  <meta name="description" content="${escapeHtml(cleanDescription(stripHtml(podcastMeta.description)))}">
  <meta property="og:title" content="Survivor Science Podcast Archive">
  <meta property="og:description" content="${escapeHtml(cleanDescription(stripHtml(podcastMeta.description)))}">
  <meta property="og:image" content="images/og-image.png">
  <meta property="og:type" content="website">
  ${faviconHTML()}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  ${navHTML('home')}

  <!-- Hero Section -->
  <section class="hero">
    <div class="hero-container">
      <div class="hero-content">
        <span class="hero-label">LATEST EPISODE</span>
        <h1 class="hero-title">${latest.episode ? latest.episode + '. ' : ''}${escapeHtml(latest.title)}</h1>
        <p class="hero-description">${escapeHtml(truncate(latest.description, 250))}</p>
        <a href="episodes/${latest.episode}.html" class="btn-play">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
          Play Latest Episode
        </a>
      </div>
      <div class="hero-artwork">
        <img src="images/podcast-artwork.jpg" alt="Survivor Science Podcast Artwork">
      </div>
    </div>
  </section>

  <!-- Recent Episodes -->
  <section class="recent-episodes">
    <div class="recent-container">
      <div class="recent-main">
        <div class="section-header">
          <h2>Recent Episodes</h2>
          <a href="episodes.html" class="view-all">View all &rarr;</a>
        </div>
        <div class="episode-grid">
          ${recent.map(ep => episodeCardHTML(ep)).join('')}
        </div>
      </div>
      ${sidebarHTML(episodes)}
    </div>
  </section>

  ${footerHTML()}
  <script src="js/main.js"></script>
</body>
</html>`;
}

function episodeCardHTML(ep) {
  return `
          <article class="episode-card">
            <a href="episodes/${ep.episode}.html" class="episode-card-image">
              <img src="${ep.episodeImage || 'images/podcast-artwork.jpg'}" alt="${escapeHtml(ep.fullTitle)}" loading="lazy">
            </a>
            <div class="episode-card-content">
              <time class="episode-date">${formatDate(ep.date)}</time>
              <h3 class="episode-card-title">
                <a href="episodes/${ep.episode}.html">${ep.episode ? ep.episode + '. ' : ''}${escapeHtml(ep.title)}</a>
              </h3>
              <p class="episode-card-desc">${escapeHtml(truncate(ep.description, 180))}</p>
              <a href="episodes/${ep.episode}.html" class="episode-listen-link">&rarr; Listen to the Episode</a>
            </div>
          </article>`;
}

function generateEpisodesPage(episodes) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>All Episodes - Survivor Science Podcast Archive</title>
  <meta name="description" content="Browse all episodes of the Survivor Science podcast.">
  ${faviconHTML()}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  ${navHTML('episodes')}

  <section class="episodes-hero">
    <h1>Episodes</h1>
  </section>

  <section class="episodes-list-section">
    <div class="episodes-container">
      <div class="episodes-search">
        <input type="text" id="episode-search" placeholder="Search episodes..." aria-label="Search episodes">
        <svg class="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      </div>
      <div class="episode-grid episode-grid-full" id="episodes-grid">
        ${episodes.map(ep => episodeCardHTML(ep)).join('')}
      </div>
      <p class="no-results" id="no-results" style="display:none;">No episodes found matching your search.</p>
    </div>
  </section>

  ${footerHTML()}
  <script src="js/main.js"></script>
</body>
</html>`;
}

function generateEpisodePage(ep, episodes, allEpisodes) {
  const epIndex = allEpisodes.findIndex(e => e.episode === ep.episode);
  const prevEp = allEpisodes[epIndex + 1]; // older
  const nextEp = allEpisodes[epIndex - 1]; // newer

  // Buzzsprout player embed
  const playerEmbed = ep.buzzsproutId
    ? `<div class="buzzsprout-player"><iframe src="https://www.buzzsprout.com/2117363/${ep.buzzsproutId}?client_source=small_player&iframe=true" loading="lazy" width="100%" height="200" frameborder="0" scrolling="no" title="Survivor Science, ${escapeHtml(ep.fullTitle)}"></iframe></div>`
    : `<audio controls preload="none" class="episode-audio"><source src="${ep.audioUrl}" type="audio/mpeg">Your browser does not support the audio element.</audio>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(ep.fullTitle)} - Survivor Science Podcast</title>
  <meta name="description" content="${escapeHtml(truncate(ep.description, 160))}">
  <meta property="og:title" content="${escapeHtml(cleanDescription(stripHtml(ep.fullTitle)))}">
  <meta property="og:description" content="${escapeHtml(truncate(ep.description, 160))}">
  <meta property="og:image" content="${ep.episodeImage || 'images/podcast-artwork.jpg'}">
  <meta property="og:type" content="article">
  ${faviconHTML('../')}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../css/style.css">
</head>
<body>
  ${navHTML('episodes').replace(/href="(?!http|#|mailto)/g, 'href="../').replace(/src="(?!http|#|mailto)/g, 'src="../')}

  <article class="episode-detail">
    <div class="episode-detail-container">
      <div class="episode-detail-main">
        <time class="episode-date">${formatDate(ep.date)}</time>
        <h1 class="episode-detail-title">${ep.episode ? ep.episode + '. ' : ''}${escapeHtml(ep.title)}</h1>

        <div class="episode-meta">
          ${ep.duration ? `<span class="episode-duration">${ep.duration}</span>` : ''}
          ${ep.season ? `<span class="episode-season">Season ${ep.season}</span>` : ''}
        </div>

        <div class="episode-artwork-large">
          <img src="${ep.episodeImage || '../images/podcast-artwork.jpg'}" alt="${escapeHtml(ep.fullTitle)}">
        </div>

        ${playerEmbed}

        ${listenOnHTML()}

        <div class="episode-show-notes">
          <h2>Show Notes</h2>
          <div class="show-notes-content">
            ${ep.description.replace(/^Send us a text/i, '')}
          </div>
        </div>

        <nav class="episode-nav">
          ${prevEp ? `<a href="${prevEp.episode}.html" class="episode-nav-link episode-nav-prev">&larr; Episode ${prevEp.episode}</a>` : '<span></span>'}
          <a href="../episodes.html" class="episode-nav-link episode-nav-all">All Episodes</a>
          ${nextEp ? `<a href="${nextEp.episode}.html" class="episode-nav-link episode-nav-next">Episode ${nextEp.episode} &rarr;</a>` : '<span></span>'}
        </nav>
      </div>

      ${sidebarHTML(allEpisodes).replace(/href="episodes\//g, 'href="')}
    </div>
  </article>

  ${footerHTML().replace(/href="(?!http|#|mailto)/g, 'href="../').replace(/src="(?!http|#|mailto)/g, 'src="../')}
  <script src="../js/main.js"></script>
</body>
</html>`;
}

function generateAboutPage(podcastMeta, episodes) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>About - Survivor Science Podcast Archive</title>
  <meta name="description" content="About the Survivor Science podcast and host Will Schmierer.">
  ${faviconHTML()}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  ${navHTML('about')}

  <section class="about-hero">
    <h1>About</h1>
  </section>

  <section class="about-content">
    <div class="about-container">
      <div class="about-text">
        <p>What's up Everybody! I'm Will, aka The Lovable Survivor</p>

        <p>So, picture this: it's 2019, I'm 37 and just minding my own business when BAM - I become a young stroke survivor. If that wasn't enough, a couple of months later in February 2020, I get hit with another surprise - a Multiple Sclerosis diagnosis! And let's not forget that was right before the pandemic shook things up just a little bit.</p>

        <p>Now, as a stroke survivor, father, husband, and solopreneur I've made it my mission to help others going through a similar situation. Because let's be real, recovering from a major life event like a stroke or anything similar is no walk in the park. It's tough, overwhelming and can leave you feeling lost on where to go next. But fear not, the big man's got your back!! I'm here to help you go from "Good Enough" to "Unstoppable AF"!</p>

        <p>Sure, there are a ton of doctors, therapists and people with good intentions out there but let me tell you, the best advice and lessons come from those who have been in your shoes. And guess what? That's me! Now, I don't have all the answers, but I've spent the last three years researching, brainstorming and experimenting to find out what works and what doesn't. And now, I want to share my struggles and successes with you to help you make the most of your second chance.</p>

        <p>Now, I'm not gonna sugarcoat it. There are no shortcuts or magic pills when it comes to recovery. But by sharing stories, interviews and my own personal experience, you'll be able to find what really works for you in your journey. So let's do this together and build a show and community of resilient survivors looking to take back control of their lives and make the most of their second chance!</p>
      </div>
    </div>
  </section>

  ${footerHTML()}
  <script src="js/main.js"></script>
</body>
</html>`;
}

// ─── Main Build Function ────────────────────────────────────────────────────

async function build() {
  console.log('Survivor Science Podcast Archive Builder');
  console.log('========================================\n');

  // Get RSS content
  let rssContent;
  const fileArg = process.argv.indexOf('--file');

  if (fileArg !== -1 && process.argv[fileArg + 1]) {
    const filePath = process.argv[fileArg + 1];
    console.log(`Reading RSS from file: ${filePath}`);
    rssContent = fs.readFileSync(filePath, 'utf-8');
  } else {
    console.log(`Fetching RSS from: ${RSS_URL}`);
    rssContent = await fetchURL(RSS_URL);
  }

  console.log(`RSS content length: ${rssContent.length} characters\n`);

  // Parse podcast metadata
  const channelMatch = rssContent.match(/<channel>([\s\S]*?)<item>/);
  const channelXml = channelMatch ? channelMatch[1] : '';

  const podcastMeta = {
    title: getCDATA(getTagContent(channelXml, 'title')) || 'Survivor Science',
    description: getCDATA(getTagContent(channelXml, 'description')) || 'Stroke recovery is brutal. It takes discipline, obsession, and endless hours of work.',
    author: getTagContent(channelXml, 'itunes:author') || 'Will Schmierer',
    image: getAttr(channelXml, 'itunes:image', 'href') || '',
    link: getTagContent(channelXml, 'link') || 'https://podcast.survivorscience.com',
  };

  console.log(`Podcast: ${podcastMeta.title}`);
  console.log(`Author: ${podcastMeta.author}`);
  if (podcastMeta.image) {
    console.log(`Artwork: ${podcastMeta.image}`);
  }

  // Parse episodes
  const items = getAllItems(rssContent);
  console.log(`\nFound ${items.length} episodes in RSS feed`);

  const episodes = items.map(parseEpisode).sort((a, b) => {
    // Sort by episode number descending (newest first)
    const numA = parseInt(a.episode) || 0;
    const numB = parseInt(b.episode) || 0;
    if (numA !== numB) return numB - numA;
    return b.date - a.date;
  });

  episodes.forEach(ep => {
    console.log(`  ${ep.episode ? 'Ep ' + ep.episode : '?'}: ${ep.title} (${formatDate(ep.date)})`);
  });

  // Download artwork if we have a URL
  const artworkPath = path.join(OUTPUT_DIR, 'images', 'podcast-artwork.jpg');
  if (podcastMeta.image && !fs.existsSync(artworkPath)) {
    console.log('\nDownloading podcast artwork...');
    try {
      const artworkData = await fetchBinary(podcastMeta.image);
      fs.writeFileSync(artworkPath, artworkData);
      console.log('Artwork saved to images/podcast-artwork.jpg');
    } catch (err) {
      console.log(`Could not download artwork: ${err.message}`);
      console.log('Please manually save artwork to images/podcast-artwork.jpg');
    }
  }

  // Generate pages
  console.log('\nGenerating HTML pages...');

  // Homepage
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), generateHomePage(episodes, podcastMeta));
  console.log('  index.html');

  // Episodes listing page
  fs.writeFileSync(path.join(OUTPUT_DIR, 'episodes.html'), generateEpisodesPage(episodes));
  console.log('  episodes.html');

  // About page
  fs.writeFileSync(path.join(OUTPUT_DIR, 'about.html'), generateAboutPage(podcastMeta, episodes));
  console.log('  about.html');

  // Individual episode pages
  const episodesDir = path.join(OUTPUT_DIR, 'episodes');
  if (!fs.existsSync(episodesDir)) fs.mkdirSync(episodesDir, { recursive: true });

  for (const ep of episodes) {
    const filename = `${ep.episode || slugify(ep.title)}.html`;
    fs.writeFileSync(
      path.join(episodesDir, filename),
      generateEpisodePage(ep, episodes, episodes)
    );
    console.log(`  episodes/${filename}`);
  }

  console.log(`\nBuild complete! ${episodes.length} episode pages generated.`);
  console.log('Open index.html in your browser to preview.');
}

function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBinary(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
