/* ==========================================================
   Book Search (Home)
   ========================================================== */
$(function () {
  const PER_PAGE = 12;
  const MAX_RESULTS = 60;                       // 60 results / 12 per page = 5 pages max
  const MAX_PAGES = MAX_RESULTS / PER_PAGE;
  const FIELDS = 'key,title,author_name,first_publish_year,cover_i';

  const state = { term: '', page: 1, totalPages: 0, requestId: 0 };

  const $form = $('#searchForm');
  const $input = $('#searchInput');
  const $button = $('#searchButton');
  const $status = $('#status');
  const $bar = $('#resultsBar');
  const $summary = $('#summary');
  const $results = $('#results');
  const $pageSelect = $('#pageSelect');
  const $prev = $('#prevPage');
  const $next = $('#nextPage');

  /* Build the API request URL from the user's search term */
  function buildSearchUrl(term, page) {
    return `${OL.api}/search.json?q=${encodeURIComponent(term)}` +
           `&fields=${FIELDS}&limit=${PER_PAGE}&page=${page}`;
  }

  /* New search: always starts back at page 1 */
  function startSearch(rawTerm) {
    const term = String(rawTerm || '').trim();
    if (!term) {
      state.requestId++;                         // cancel anything still loading
      setLoading(false);
      clearResults();
      showMessage($status, 'info', 'Enter a search term',
        'Type a title, author, or subject, then select Search.');
      $input.trigger('focus');
      return;
    }
    state.term = term;
    loadPage(1);
  }

  /* Loads one page of results for the current search term */
  async function loadPage(page) {
    const requestId = ++state.requestId;       // ignore slower, older responses
    state.page = page;
    setLoading(true);

    try {
      const data = await getJSON(buildSearchUrl(state.term, page));
      if (requestId !== state.requestId) return;

      const available = Math.min(data.numFound || 0, MAX_RESULTS);
      if (available === 0) {
        clearResults();
        showMessage($status, 'info', 'No books found',
          `Nothing matched "${state.term}". Check the spelling or try different keywords.`);
        return;
      }

      state.totalPages = Math.ceil(available / PER_PAGE);
      if (page > state.totalPages) {             // e.g. an old link asking for page 5 of 2
        loadPage(state.totalPages);
        return;
      }

      const startIndex = (page - 1) * PER_PAGE;
      const docs = (data.docs || []).slice(0, available - startIndex);

      if (docs.length === 0) {
        clearResults();
        showMessage($status, 'info', 'No results on this page',
          'Open Library returned an empty page. Try page 1 or run the search again.');
        return;
      }

      $status.empty();
      renderResults(docs);
      renderSummary(startIndex, docs.length, available, data.numFound);
      renderPager();
      updateUrl();
    } catch (err) {
      if (requestId !== state.requestId) return;
      clearResults();
      showMessage($status, 'error', 'Search failed',
        `Open Library could not be reached (${err.message}). Check your connection and try again.`);
    } finally {
      if (requestId === state.requestId) setLoading(false);
    }
  }

  /* Loop through the docs array and build a card for each book */
  function renderResults(docs) {
    $results.empty();
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const metaParts = [];
      if (doc.author_name && doc.author_name.length) metaParts.push(doc.author_name[0]);
      if (doc.first_publish_year) metaParts.push(doc.first_publish_year);

      $results.append(buildBookCard({
        workId: workIdFromKey(doc.key),
        title: doc.title,
        coverId: doc.cover_i,
        meta: metaParts.join(', ')
      }));
    }
  }

  function renderSummary(startIndex, count, available, numFound) {
    let text = `Showing ${startIndex + 1}–${startIndex + count} of ${available} ` +
               `result${available === 1 ? '' : 's'} for "${state.term}"`;
    if (numFound > MAX_RESULTS) {
      text += ` (top ${MAX_RESULTS} of ${numFound.toLocaleString()} matches)`;
    }
    $summary.text(text);
  }

  /* Page dropdown + previous/next buttons */
  function renderPager() {
    $pageSelect.empty();
    for (let p = 1; p <= state.totalPages; p++) {
      $('<option>').val(p).text(p).prop('selected', p === state.page).appendTo($pageSelect);
    }
    $('#pageCount').text(state.totalPages);
    $prev.prop('disabled', state.page <= 1);
    $next.prop('disabled', state.page >= state.totalPages);
    $('#pager').prop('hidden', state.totalPages <= 1);
    $bar.prop('hidden', false);
  }

  function clearResults() {
    $results.empty();
    $bar.prop('hidden', true);
    state.totalPages = 0;
  }

  function setLoading(isLoading) {
    $button.prop('disabled', isLoading).text(isLoading ? 'Searching…' : 'Search');
    $results.attr('aria-busy', String(isLoading)).toggleClass('is-loading', isLoading);
    $pageSelect.prop('disabled', isLoading);
    if (isLoading) {
      $prev.prop('disabled', true);
      $next.prop('disabled', true);
      if (!$results.children().length) {
        showMessage($status, 'loading', 'Searching Open Library…', '');
      }
    }
  }

  /* Keep the term and page in the address bar so Back from Details restores them */
  function updateUrl() {
    const query = `?q=${encodeURIComponent(state.term)}&page=${state.page}`;
    history.replaceState(null, '', query);
  }

  /* Page changes reuse the saved term, not whatever is typed in the box now */
  function goToPage(page) {
    if (!state.term || page < 1 || page > state.totalPages || page === state.page) return;
    loadPage(page);
    const area = document.getElementById('resultsArea');
    if (area && area.scrollIntoView) area.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- Events ---------- */
  $form.on('submit', function (e) {
    e.preventDefault();
    startSearch($input.val());
  });

  $pageSelect.on('change', function () { goToPage(parseInt(this.value, 10)); });
  $prev.on('click', () => goToPage(state.page - 1));
  $next.on('click', () => goToPage(state.page + 1));

  $('.suggestions').on('click', '.chip', function () {
    const term = String($(this).data('q'));
    $input.val(term);
    startSearch(term);
  });

  /* ---------- Restore a search from the URL (e.g. Back from Details, or a subject link) ---------- */
  const params = new URLSearchParams(window.location.search);
  const savedTerm = (params.get('q') || '').trim();
  if (savedTerm) {
    let savedPage = parseInt(params.get('page'), 10);
    if (!(savedPage >= 1 && savedPage <= MAX_PAGES)) savedPage = 1;
    $input.val(savedTerm);
    state.term = savedTerm;
    loadPage(savedPage);
  }
});
