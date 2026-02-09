// Survivor Science Podcast Archive — Main JS

// ─── Mobile Navigation Toggle ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');

  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', links.classList.contains('open'));
    });

    // Close nav when clicking outside
    document.addEventListener('click', (e) => {
      if (!toggle.contains(e.target) && !links.contains(e.target)) {
        links.classList.remove('open');
      }
    });
  }

  // ─── Episode Search ─────────────────────────────────────────────────────
  const searchInput = document.getElementById('episode-search');
  const grid = document.getElementById('episodes-grid');
  const noResults = document.getElementById('no-results');

  if (searchInput && grid) {
    const cards = Array.from(grid.querySelectorAll('.episode-card'));

    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      let visibleCount = 0;

      cards.forEach(card => {
        const title = card.querySelector('.episode-card-title')?.textContent.toLowerCase() || '';
        const desc = card.querySelector('.episode-card-desc')?.textContent.toLowerCase() || '';
        const match = !query || title.includes(query) || desc.includes(query);
        card.style.display = match ? '' : 'none';
        if (match) visibleCount++;
      });

      if (noResults) {
        noResults.style.display = visibleCount === 0 ? '' : 'none';
      }
    });
  }
});
