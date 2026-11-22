/* ==========================================================
   Milestone 4: Book Explorer (Open Library SPA)
   Builds on Milestone 3. New in this version:
   - Mustache.js templates render every list, the details panel,
     the pager, and status messages (see the <script type="text/template">
     blocks in index.html).
   - Grid View / List View for search results and the collection.
   - Tabs to move between Search Results and the collection
     without losing either one.
   Every API request still uses jQuery AJAX, and nothing reloads the page.
   ========================================================== */
$(function () {
  'use strict';

  /* ---------- Settings ---------- */
  const API = 'https://openlibrary.org';
  const COVERS = 'https://covers.openlibrary.org/b/id/';
  const MAX_RESULTS = 50;              // first 50 results only
  const PER_PAGE = 10;                 // 10 per view, so at most 5 views
  const MAX_SUBJECTS = 10;
  const COLLECTION = { slug: 'science_fiction', label: 'the Science Fiction collection', limit: 10 };
  const SEARCH_FIELDS = 'key,title,author_name,first_publish_year,cover_i,edition_count,language';
  const TIMEOUT = 15000;
  const VIEW_KEY = 'm4-book-view';

  /* Open Library language codes -> readable names (anything else shows as the code) */
  const LANGUAGES = {
    eng: 'English', spa: 'Spanish', fre: 'French', ger: 'German', ita: 'Italian', por: 'Portuguese',
    rus: 'Russian', jpn: 'Japanese', chi: 'Chinese', ara: 'Arabic', dut: 'Dutch', kor: 'Korean',
    pol: 'Polish', swe: 'Swedish', tur: 'Turkish', heb: 'Hebrew', hin: 'Hindi', gre: 'Greek',
    lat: 'Latin', cze: 'Czech', dan: 'Danish', fin: 'Finnish', nor: 'Norwegian', hun: 'Hungarian'
  };

  /* ---------- Templates (read once from index.html) ---------- */
  const TPL = {
    books: $('#bookListTemplate').html(),
    coverFallback: $('#coverFallbackTemplate').html(),
    pager: $('#pagerTemplate').html(),
    details: $('#detailsTemplate').html(),
    message: $('#messageTemplate').html()
  };
  // Parsing ahead of time makes each later render faster
  $.each(TPL, function (name, tpl) { Mustache.parse(tpl); });

  /* ---------- App state ---------- */
  const state = {
    term: '',
    results: [],          // up to 50 books from the last successful search
    numFound: 0,
    page: 1,
    searching: false,
    collection: [],
    selectedId: null,
    view: 'grid',
    tab: 'collection',
    detailsRequest: null
  };
  const detailsCache = {};      // workId -> { work, authors }
  const booksById = {};         // workId -> card data, so a click can find its book

  /* ---------- Element references ---------- */
  const $form = $('#searchForm');
  const $input = $('#searchInput');
  const $button = $('#searchButton');
  const $searchStatus = $('#searchStatus');
  const $results = $('#results');
  const $resultsStatus = $('#resultsStatus');
  const $summary = $('#resultsSummary');
  const $indicator = $('#pageIndicator');
  const $pager = $('#pager');
  const $collection = $('#collection');
  const $collectionStatus = $('#collectionStatus');
  const $details = $('#details');
  const $detailsPanel = $('#detailsPanel');

  /* ==========================================================
     Shared helpers
     ========================================================== */

  /* Every request goes through jQuery AJAX with the same timeout and JSON handling */
  function ajaxJSON(url, data) {
    return $.ajax({ url: url, data: data, dataType: 'json', timeout: TIMEOUT });
  }

  /* Turns a failed request into a message a user can act on */
  function describeError(xhr, textStatus) {
    if (textStatus === 'timeout') return 'Open Library took too long to respond.';
    if (textStatus === 'parsererror') return 'Open Library sent back data the app could not read.';
    if (xhr && xhr.status === 404) return 'Open Library has no record for this item.';
    if (xhr && xhr.status >= 500) return `Open Library is having trouble right now (error ${xhr.status}).`;
    if (xhr && xhr.status === 0) return 'Open Library could not be reached. Check your internet connection.';
    return `The request failed${xhr && xhr.status ? ` (error ${xhr.status})` : ''}.`;
  }

  /* Renders a status box from the message template */
  function showMessage($target, type, heading, text, retry) {
    const role = (type === 'error' || type === 'warning') ? 'alert' : 'status';
    $target.html(Mustache.render(TPL.message, { type: type, role: role, heading: heading, text: text, retry: !!retry }));
    if (retry) $target.find('.retry').on('click', retry);
  }

  function workIdFromKey(key) {
    return String(key || '').split('/').pop();
  }

  /* default=false makes Open Library return 404 instead of a blank image,
     so the fallback template can take over */
  function coverUrl(id, size) {
    return id ? `${COVERS}${id}-${size}.jpg?default=false` : '';
  }

  /* Work records keep covers in an array where -1 means "no image" */
  function firstCoverId(covers) {
    if (!Array.isArray(covers)) return null;
    for (let i = 0; i < covers.length; i++) {
      if (covers[i] > 0) return covers[i];
    }
    return null;
  }

  function languageNames(codes, max) {
    if (!Array.isArray(codes) || !codes.length) return '';
    const names = $.map(codes, function (c) { return LANGUAGES[c] || c; });
    const shown = names.slice(0, max).join(', ');
    return names.length > max ? `${shown} and ${names.length - max} more` : shown;
  }

  function shortList(arr, max) {
    if (!Array.isArray(arr) || !arr.length) return '';
    const shown = arr.slice(0, max).join(', ');
    return arr.length > max ? `${shown} and ${arr.length - max} more` : shown;
  }

  function authorLine(names) {
    if (!names.length) return 'Author not listed';
    return names.length > 2 ? `${names[0]}, ${names[1]}, and others` : names.join(' and ');
  }

  /* A failed cover image swaps itself for the placeholder template.
     Image errors don't bubble, so this listens in the capture phase. */
  document.addEventListener('error', function (e) {
    const img = e.target;
    if (img && img.classList && img.classList.contains('cover-img')) {
      $(img).replaceWith(Mustache.render(TPL.coverFallback, { title: img.getAttribute('data-title') || 'Untitled' }));
    }
  }, true);

  /* ---------- Card data ----------
     Search docs and subject works name their fields differently,
     so both are normalized into the same shape for the shared template. */
  function toSearchBook(doc) {
    if (!doc || !doc.key) return null;              // $.map drops nulls
    const authors = Array.isArray(doc.author_name) ? doc.author_name : [];
    const book = {
      workId: workIdFromKey(doc.key),
      title: doc.title || 'Untitled',
      authors: authors,
      authorLine: authorLine(authors),
      year: doc.first_publish_year || '',
      editions: doc.edition_count ? `${doc.edition_count} edition${doc.edition_count === 1 ? '' : 's'}` : '',
      languages: languageNames(doc.language, 3),
      coverId: doc.cover_i || null,
      source: 'Search Results'
    };
    book.coverUrl = coverUrl(book.coverId, 'M');
    book.hasCover = !!book.coverId;
    return book;
  }

  function toCollectionBook(work) {
    if (!work || !work.key) return null;
    const authors = $.map(Array.isArray(work.authors) ? work.authors : [], function (a) { return (a && a.name) || null; });
    const book = {
      workId: workIdFromKey(work.key),
      title: work.title || 'Untitled',
      authors: authors,
      authorLine: authorLine(authors),
      year: work.first_publish_year || '',
      editions: work.edition_count ? `${work.edition_count} edition${work.edition_count === 1 ? '' : 's'}` : '',
      languages: '',
      coverId: work.cover_id || null,
      source: COLLECTION.label
    };
    book.coverUrl = coverUrl(book.coverId, 'M');
    book.hasCover = !!book.coverId;
    return book;
  }

  /* Renders a list of cards with the shared Mustache template */
  function renderBooks($list, books) {
    const view = $.map(books, function (b) {
      booksById[b.workId] = b;
      return $.extend({}, b, { selected: b.workId === state.selectedId });
    });
    $list.html(Mustache.render(TPL.books, { books: view }));
  }

  /* ==========================================================
     Tabs: Search Results and the collection
     Both lists stay in the page; switching only shows or hides them,
     so results, pagination, and the collection are all preserved.
     ========================================================== */
  function showTab(name, focusTab) {
    state.tab = name;
    $('.tab').each(function () {
      const on = $(this).data('tab') === name;
      $(this).toggleClass('is-active', on).attr({ 'aria-selected': String(on), tabindex: on ? '0' : '-1' });
      $('#' + $(this).attr('aria-controls')).prop('hidden', !on);
    });
    if (focusTab) $(`#tab-${name}`).trigger('focus');
  }

  $('.tab').on('click', function () { showTab($(this).data('tab')); });

  /* Arrow keys move between tabs, the standard pattern for a tab list */
  $('.tabs').on('keydown', '.tab', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    showTab(state.tab === 'results' ? 'collection' : 'results', true);
  });

  $('[data-goto-tab]').on('click', function () { showTab($(this).data('goto-tab')); });

  /* ==========================================================
     Grid View / List View
     One class on each list controls the layout, so switching is
     instant and keeps the same page, selection, and scroll position.
     ========================================================== */
  function setView(view) {
    state.view = view === 'list' ? 'list' : 'grid';
    $('.book-list').removeClass('view-grid view-list').addClass('view-' + state.view);
    $('.view-btn').each(function () {
      const on = $(this).data('view') === state.view;
      $(this).toggleClass('is-active', on).attr('aria-pressed', String(on));
    });
    try { localStorage.setItem(VIEW_KEY, state.view); } catch (e) { /* storage blocked: still works for this visit */ }
  }

  $('.view-btn').on('click', function () { setView($(this).data('view')); });

  /* ==========================================================
     Book search
     ========================================================== */
  $form.on('submit', function (e) {
    e.preventDefault();                 // stay on this page, no reload
    if (state.searching) return;        // block overlapping submissions

    const term = $.trim($input.val());
    const error = validateTerm(term);
    if (error) {
      showMessage($searchStatus, 'warning', error.heading, error.text);
      $input.addClass('invalid').attr('aria-invalid', 'true').trigger('focus');
      return;
    }
    $input.removeClass('invalid').removeAttr('aria-invalid');
    $searchStatus.empty();
    runSearch(term);
  });

  $input.on('input', function () {
    if ($(this).hasClass('invalid')) {
      $(this).removeClass('invalid').removeAttr('aria-invalid');
      $searchStatus.empty();
    }
  });

  function validateTerm(term) {
    if (!term) return { heading: 'Enter a search term', text: 'Type a book title or keywords, then select Search.' };
    if (term.length < 2) return { heading: 'Search term is too short', text: 'Use at least 2 characters so Open Library can find matches.' };
    if (!/[a-z0-9]/i.test(term)) return { heading: 'Search term needs letters or numbers', text: `"${term}" only contains symbols. Try a title or keyword.` };
    return null;
  }

  /* One request gets up to 50 results; the five views are built locally,
     so changing pages never calls the API again */
  function runSearch(term) {
    setSearching(true);
    showTab('results');
    $results.attr('aria-busy', 'true').addClass('is-loading');
    showMessage($resultsStatus, 'loading', 'Searching Open Library…', `Looking for "${term}".`);

    ajaxJSON(`${API}/search.json`, { q: term, fields: SEARCH_FIELDS, limit: MAX_RESULTS })
      .done(function (data) {
        const docs = (data && Array.isArray(data.docs)) ? data.docs : [];

        // A new search always replaces the old results and resets to page 1
        state.term = term;
        state.page = 1;
        state.numFound = data && data.numFound ? data.numFound : docs.length;
        state.results = $.map(docs.slice(0, MAX_RESULTS), toSearchBook);

        if (!state.results.length) {
          clearResults();
          showMessage($resultsStatus, 'info', 'No books found',
            `Nothing matched "${term}". Check the spelling or try different keywords.`);
          return;
        }
        $resultsStatus.empty();
        $('#resultsCount').text(state.results.length);
        renderPage(1);
      })
      .fail(function (xhr, textStatus) {
        clearResults();
        showMessage($resultsStatus, 'error', 'Search failed',
          describeError(xhr, textStatus) + ' Your search term is still in the box.',
          function () { runSearch(term); });
      })
      .always(function () {
        setSearching(false);
        $results.attr('aria-busy', 'false').removeClass('is-loading');
      });
  }

  function setSearching(isOn) {
    state.searching = isOn;
    $button.prop('disabled', isOn).text(isOn ? 'Searching…' : 'Search');
    $input.prop('readonly', isOn);
    // Lock the pager while searching; afterwards only enable buttons that lead to a real page
    $pager.find('.page-btn').each(function () {
      const p = Number($(this).attr('data-page'));
      $(this).prop('disabled', isOn || p < 1 || p > totalPages());
    });
  }

  function clearResults() {
    state.results = [];
    $results.empty();
    $('#resultsCount').text('');
    $summary.prop('hidden', true);
    $indicator.prop('hidden', true);
    $pager.prop('hidden', true).empty();
  }

  /* ==========================================================
     Pagination (10 per view, from the saved results)
     ========================================================== */
  function totalPages() {
    return Math.ceil(state.results.length / PER_PAGE);
  }

  function renderPage(page) {
    const pages = totalPages();
    state.page = Math.min(Math.max(page, 1), pages);
    const start = (state.page - 1) * PER_PAGE;
    const pageBooks = state.results.slice(start, start + PER_PAGE);

    renderBooks($results, pageBooks);

    $indicator.text(`Page ${state.page} of ${pages}`).prop('hidden', false);
    let summary = `Showing ${start + 1}–${start + pageBooks.length} of ${state.results.length} ` +
                  `result${state.results.length === 1 ? '' : 's'} for "${state.term}"`;
    if (state.numFound > MAX_RESULTS) {
      summary += ` (first ${MAX_RESULTS} of ${Number(state.numFound).toLocaleString()} matches)`;
    }
    $summary.text(summary).prop('hidden', false);

    if (pages <= 1) { $pager.prop('hidden', true).empty(); return; }
    const pageList = [];
    for (let p = 1; p <= pages; p++) pageList.push({ number: p, total: pages, current: p === state.page });
    $pager.html(Mustache.render(TPL.pager, {
      pages: pageList,
      hasPrev: state.page > 1, prevPage: state.page - 1,
      hasNext: state.page < pages, nextPage: state.page + 1
    })).prop('hidden', false);
  }

  $pager.on('click', '.page-btn', function () {
    const page = Number($(this).attr('data-page'));
    if (!page || page === state.page || state.searching) return;
    renderPage(page);
    scrollToEl($('#panel-results'));
  });

  /* ==========================================================
     Details on demand
     ========================================================== */
  $('.lists').on('click', '.book-card', function () {
    const book = booksById[$(this).data('id')];
    selectBook(book);
  });

  function selectBook(book) {
    if (!book || !book.workId) return;
    state.selectedId = book.workId;
    $('.book-card').removeClass('is-selected').removeAttr('aria-pressed')
      .filter(`[data-id="${book.workId}"]`).addClass('is-selected').attr('aria-pressed', 'true');

    // Cancel a slower request for a book the user already moved on from
    if (state.detailsRequest) state.detailsRequest.abort();

    if (detailsCache[book.workId]) {
      renderDetails(book, detailsCache[book.workId]);
      focusDetails();
      return;
    }

    showMessage($details, 'loading', 'Loading book details…', `Getting "${book.title}" from Open Library.`);
    focusDetails();

    const request = ajaxJSON(`${API}/works/${encodeURIComponent(book.workId)}.json`);
    state.detailsRequest = request;

    request
      .then(followRedirect)
      .then(function (work) {
        return loadAuthors(work, book).then(function (authors) { return { work: work, authors: authors }; });
      })
      .done(function (result) {
        if (state.selectedId !== book.workId) return;   // user picked another book meanwhile
        detailsCache[book.workId] = result;
        renderDetails(book, result);
      })
      .fail(function (xhr, textStatus) {
        if (textStatus === 'abort' || state.selectedId !== book.workId) return;
        showMessage($details, 'error', 'Could not load book details',
          describeError(xhr, textStatus), function () { selectBook(book); });
      })
      .always(function () {
        if (state.detailsRequest === request) state.detailsRequest = null;
      });
  }

  /* Some works were merged into others; Open Library answers with a redirect record */
  function followRedirect(work) {
    if (work && work.type && work.type.key === '/type/redirect' && work.location) {
      return ajaxJSON(`${API}${work.location}.json`);
    }
    return $.Deferred().resolve(work).promise();
  }

  /* Reuse author names from the list data when we have them,
     otherwise look up to 3 author records from the work's keys */
  function loadAuthors(work, book) {
    if (book.authors && book.authors.length) return $.Deferred().resolve(book.authors).promise();
    const keys = $.map(Array.isArray(work.authors) ? work.authors : [], function (a) {
      return (a && a.author && a.author.key) || (a && a.key) || null;
    }).slice(0, 3);
    if (!keys.length) return $.Deferred().resolve([]).promise();

    const names = [];
    const lookups = $.map(keys, function (key, i) {
      const done = $.Deferred();
      ajaxJSON(`${API}${key}.json`)
        .done(function (a) { if (a && a.name) names[i] = a.name; })
        .always(function () { done.resolve(); });     // one failed author never breaks the panel
      return done.promise();
    });
    return $.when.apply($, lookups).then(function () { return $.grep(names, Boolean); });
  }

  /* Description arrives as plain text OR as { type, value } */
  function getDescription(desc) {
    let text = '';
    if (typeof desc === 'string') text = desc;
    else if (desc && typeof desc === 'object' && typeof desc.value === 'string') text = desc.value;
    return text
      .split(/\r?\n-{3,}\r?\n/)[0]                         // drop "contained in" lists
      .replace(/^\s*\[\d+\]:.*$/gm, '')                     // drop markdown link definitions
      .replace(/\(\[source\]\[\d+\]\)/gi, '')
      .replace(/\[([^\]]+)\]\[\d+\]/g, '$1')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
      .trim();
  }

  /* Builds the details view model, then the template does the rest */
  function renderDetails(book, result) {
    const work = result.work || {};
    const workId = workIdFromKey(work.key) || book.workId;
    const title = work.title || book.title || 'Untitled';
    const coverId = firstCoverId(work.covers) || book.coverId;
    const description = getDescription(work.description);

    const view = {
      source: book.source,
      title: title,
      subtitle: work.subtitle || '',
      workId: workId,
      hasAuthors: result.authors.length > 0,
      authorText: result.authors.length ? 'by ' + result.authors.join(', ') : 'Author information is not available.',
      published: work.first_publish_date || book.year || 'Not listed',
      editions: book.editions,
      languages: book.languages,
      places: shortList(work.subject_places, 4),
      times: shortList(work.subject_times, 4),
      people: shortList(work.subject_people, 4),
      paragraphs: description ? $.grep($.map(description.split(/\r?\n\s*\r?\n/), $.trim), Boolean) : [],
      subjects: Array.isArray(work.subjects) ? work.subjects.slice(0, MAX_SUBJECTS) : [],
      coverUrl: coverUrl(coverId, 'L'),
      hasCover: !!coverId
    };
    $details.html(Mustache.render(TPL.details, view));
  }

  /* On narrow screens the details sit below the lists, so scroll to them */
  function focusDetails() {
    if (window.matchMedia('(max-width: 900px)').matches) scrollToEl($detailsPanel);
  }

  function scrollToEl($el) {
    const offset = $('header').css('position') === 'sticky' ? $('header').outerHeight() + 12 : 12;
    const top = $el.offset().top - offset;
    if (Math.abs($(window).scrollTop() - top) > 40) $('html, body').animate({ scrollTop: top }, 250);
  }

  /* "Back to the list" returns to the selected card (handy on phones) */
  $details.on('click', '.back-to-list', function () {
    const $card = $(`#panel-${state.tab} .book-card.is-selected`);
    const $target = $card.length ? $card : $(`#panel-${state.tab}`);
    scrollToEl($target);
    if ($card.length) $card.trigger('focus');
  });

  /* ==========================================================
     Predefined collection (Open Library Subjects API)
     ========================================================== */
  function loadCollection() {
    showMessage($collectionStatus, 'loading', 'Loading Science Fiction books…', '');
    $collection.attr('aria-busy', 'true').empty();
    $('#collectionCount').text('');

    ajaxJSON(`${API}/subjects/${COLLECTION.slug}.json`, { limit: COLLECTION.limit })
      .done(function (data) {
        const works = (data && Array.isArray(data.works)) ? data.works.slice(0, COLLECTION.limit) : [];
        state.collection = $.map(works, toCollectionBook);
        if (!state.collection.length) {
          showMessage($collectionStatus, 'info', 'This collection is empty right now',
            'Open Library returned no Science Fiction books. Try again later.', loadCollection);
          return;
        }
        $collectionStatus.empty();
        renderBooks($collection, state.collection);
        $('#collectionCount').text(state.collection.length);
      })
      .fail(function (xhr, textStatus) {
        showMessage($collectionStatus, 'error', 'The collection could not be loaded',
          describeError(xhr, textStatus), loadCollection);
      })
      .always(function () { $collection.attr('aria-busy', 'false'); });
  }

  /* ---------- Start up ---------- */
  let savedView = 'grid';
  try { savedView = localStorage.getItem(VIEW_KEY) || 'grid'; } catch (e) { /* use the default */ }
  setView(savedView);
  showTab('collection');
  showMessage($resultsStatus, 'info', 'No search yet', 'Search above and your results will appear here, 10 books per page.');
  showMessage($details, 'info', 'No book selected', 'Select a book from the search results or the Science Fiction collection to see its details here.');
  loadCollection();
});
