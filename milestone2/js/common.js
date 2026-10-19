/* ==========================================================
   Milestone 2 shared helpers (used by all three pages)
   ========================================================== */

const OL = {
  api: 'https://openlibrary.org',
  covers: 'https://covers.openlibrary.org/b/id/'
};

/* Cover image URL. default=false makes Open Library return a 404
   instead of a blank 1x1 image, so our placeholder can take over. */
function coverUrl(coverId, size) {
  return `${OL.covers}${coverId}-${size || 'M'}.jpg?default=false`;
}

/* "/works/OL45804W" -> "OL45804W" */
function workIdFromKey(key) {
  return String(key || '').split('/').pop();
}

function detailsUrl(workId) {
  return 'details.html?id=' + encodeURIComponent(workId);
}

/* fetch() wrapper that throws on HTTP errors (404, 500, etc.) */
async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/* Gets a work record and follows Open Library redirects for merged works */
async function fetchWork(workId) {
  let work = await getJSON(`${OL.api}/works/${workId}.json`);
  if (work.type && work.type.key === '/type/redirect' && work.location) {
    work = await getJSON(`${OL.api}${work.location}.json`);
  }
  return work;
}

/* Work records store covers in an array; -1 means "no image" */
function firstCoverId(covers) {
  if (!Array.isArray(covers)) return null;
  return covers.find(id => id > 0) || null;
}

/* Work records only hold author keys, so each name needs its own request */
async function getAuthorNames(authors, max) {
  if (!Array.isArray(authors)) return [];
  const keys = authors
    .map(a => (a && a.author && a.author.key) || (a && a.key))
    .filter(Boolean)
    .slice(0, max || 3);
  const results = await Promise.allSettled(keys.map(key => getJSON(`${OL.api}${key}.json`)));
  return results
    .filter(r => r.status === 'fulfilled' && r.value && r.value.name)
    .map(r => r.value.name);
}

/* Cover image with a styled placeholder when no cover exists or it fails to load */
function buildCover(coverId, title, size) {
  const $frame = $('<div class="cover">');
  const makePlaceholder = () => $('<div class="cover-placeholder">')
    .append($('<span class="ph-title">').text(title || 'Untitled'))
    .append($('<span class="ph-note">').text('No cover available'));

  if (coverId) {
    $('<img>')
      .attr({ src: coverUrl(coverId, size), alt: `Cover of ${title || 'this book'}`, loading: 'lazy' })
      .on('error', function () { $(this).replaceWith(makePlaceholder()); })
      .appendTo($frame);
  } else {
    $frame.append(makePlaceholder());
  }
  return $frame;
}

/* One book card, shared by the search results and the bookshelf */
function buildBookCard(book) {
  const href = detailsUrl(book.workId);
  const $card = $('<li class="book-card">');

  $('<a class="cover-link">')
    .attr({ href: href, tabindex: '-1', 'aria-hidden': 'true' })
    .append(buildCover(book.coverId, book.title, 'M'))
    .appendTo($card);

  const $body = $('<div class="book-body">').appendTo($card);
  $('<h2 class="book-title">')
    .append($('<a>').attr('href', href).text(book.title || 'Untitled'))
    .appendTo($body);
  if (book.meta) $('<p class="book-meta">').text(book.meta).appendTo($body);

  return $card;
}

/* Status box for loading, empty, no-result, and error states */
function showMessage($target, type, heading, text) {
  const $box = $('<div class="message">')
    .addClass('message-' + type)
    .attr('role', type === 'error' ? 'alert' : 'status');
  $('<p class="message-heading">').text(heading).appendTo($box);
  if (text) $('<p class="message-text">').text(text).appendTo($box);
  $target.empty().append($box);
  return $box;
}
