/* ==========================================================
   Milestone 3: Open Library Single Page Application
   Search, pagination, book details, and a subject collection
   all live on index.html. Every API call uses jQuery AJAX.
   ========================================================== */
$(function () {
  'use strict';

  /* ---------- Settings ---------- */
  const API = 'https://openlibrary.org';
  const COVERS = 'https://covers.openlibrary.org/b/id/';
  const MAX_RESULTS = 50;          // first 50 results only
  const PER_PAGE = 10;             // 10 per view, so at most 5 views
  const MAX_SUBJECTS = 10;
  const COLLECTION = { slug: 'science_fiction', label: 'Science Fiction', limit: 10 };
  const SEARCH_FIELDS = 'key,title,author_name,first_publish_year,cover_i';
  const TIMEOUT = 15000;

  /* ---------- App state ---------- */
  const state = {
    term: '',
    results: [],        // up to 50 books from the last successful search
    page: 1,
    searching: false,
    selectedId: null,
    detailsRequest: null
  };
  const detailsCache = {};   // workId -> { work, authors } so repeat clicks skip the API

  /* ---------- Element references ---------- */
  const $form = $('#searchForm');
  const $input = $('#searchInput');
  const $button = $('#searchButton');
  const $searchStatus = $('#searchStatus');
  const $resultsStatus = $('#resultsStatus');
  const $results = $('#results');
  const $summary = $('#resultsSummary');
  const $indicator = $('#pageIndicator');
  const $pager = $('#pager');
  const $detailsPanel = $('#detailsPanel');
  const $detailsStatus = $('#detailsStatus');
  const $details = $('#details');
  const $collection = $('#collection');
  const $collectionStatus = $('#collectionStatus');

  /* ==========================================================
     Shared helpers
     ========================================================== */

  /* One wrapper so every request has the same timeout and JSON handling */
  function ajaxJSON(url, data) {
    return $.ajax({ url: url, data: data, dataType: 'json', timeout: TIMEOUT });
  }

  /* Turns a failed jqXHR into a message a user can act on */
  function describeError(xhr, textStatus) {
    if (textStatus === 'timeout') return 'Open Library took too long to respond.';
    if (textStatus === 'parsererror') return 'Open Library sent back data the app could not read.';
    if (xhr && xhr.status === 404) return 'Open Library has no record for this item.';
    if (xhr && xhr.status >= 500) return `Open Library is having trouble right now (error ${xhr.status}).`;
    if (xhr && xhr.status === 0) return 'Open Library could not be reached. Check your internet connection.';
    return `The request failed${xhr && xhr.status ? ` (error ${xhr.status})` : ''}.`;
  }

  /* Status box used for loading, empty, validation, and error states */
  function showMessage($target, type, heading, text, retry) {
    const $box = $('<div class="message">')
      .addClass('message-' + type)
      .attr('role', type === 'error' || type === 'warning' ? 'alert' : 'status');
    $('<p class="message-heading">').text(heading).appendTo($box);
    if (text) $('<p class="message-text">').text(text).appendTo($box);
    if (retry) {
      $('<button type="button" class="retry">').text('Try again').on('click', retry).appendTo($box);
    }
    $target.empty().append($box);
  }

  /* "/works/OL45804W" -> "OL45804W" */
  function workIdFromKey(key) {
    return String(key || '').split('/').pop();
  }

  /* default=false makes Open Library return 404 instead of a blank image,
     so the placeholder can take over */
  function coverUrl(id, size) {
    return `${COVERS}${id}-${size}.jpg?default=false`;
  }

  /* Work records keep covers in an array where -1 means "no image" */
  function firstCoverId(covers) {
    if (!Array.isArray(covers)) return null;
    for (let i = 0; i < covers.length; i++) {
      if (covers[i] > 0) return covers[i];
    }
    return null;
  }

  /* Cover image, or a book-shaped placeholder when there is none or it fails */
  function buildCover(coverId, title, size) {
    const $frame = $('<div class="cover">');
    const placeholder = () => $('<div class="cover-placeholder">')
      .append($('<span class="ph-title">').text(title || 'Untitled'))
      .append($('<span class="ph-note">').text('No cover available'));

    if (coverId) {
      $('<img>')
        .attr({ src: coverUrl(coverId, size), alt: `Cover of ${title || 'this book'}`, loading: 'lazy' })
        .on('error', function () { $(this).replaceWith(placeholder()); })
        .appendTo($frame);
    } else {
      $frame.append(placeholder());
    }
    return $frame;
  }

  /* One selectable card. Search results and the collection both use it,
     so they look and behave the same. */
  function buildBookCard(book, source) {
    const $button = $('<button type="button" class="book-card">')
      .attr('aria-label', `Show details for ${book.title}`)
      .data('book', book)
      .data('source', source)
      .toggleClass('is-selected', book.workId === state.selectedId)
      .append(buildCover(book.coverId, book.title, 'M'));

    const $body = $('<span class="book-body">').appendTo($button);
    $('<span class="book-title">').text(book.title).appendTo($body);
    $('<span class="book-meta">').text(book.meta || 'Author not listed').appendTo($body);

    return $('<li>').append($button);
  }

  /* ==========================================================
     Task 2: Book search
     ========================================================== */
  $form.on('submit', function (e) {
    e.preventDefault();               // stay on this page, no reload
    if (state.searching) return;      // block overlapping submissions

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
    if (!term) {
      return { heading: 'Enter a search term', text: 'Type a book title or keywords, then select Search.' };
    }
    if (term.length < 2) {
      return { heading: 'Search term is too short', text: 'Use at least 2 characters so Open Library can find matches.' };
    }
    if (!/[a-z0-9]/i.test(term)) {
      return { heading: 'Search term needs letters or numbers', text: `"${term}" only contains symbols. Try a title or keyword.` };
    }
    return null;
  }

  /* One request gets up to 50 results; pages are then built locally,
     so changing pages never calls the API again */
  function runSearch(term) {
    setSearching(true);
    showMessage($resultsStatus, 'loading', 'Searching Open Library…', `Looking for "${term}".`);
    $results.attr('aria-busy', 'true').addClass('is-loading');

    ajaxJSON(`${API}/search.json`, { q: term, fields: SEARCH_FIELDS, limit: MAX_RESULTS })
      .done(function (data) {
        const docs = (data && Array.isArray(data.docs)) ? data.docs : [];

        // A new search always replaces the old results and resets to page 1
        state.term = term;
        state.page = 1;
        state.results = $.map(docs.slice(0, MAX_RESULTS), toSearchBook);

        if (!state.results.length) {
          clearResults();
          showMessage($resultsStatus, 'info', 'No books found',
            `Nothing matched "${term}". Check the spelling or try different keywords.`);
          return;
        }
        $resultsStatus.empty();
        renderPage(1, data.numFound);
      })
      .fail(function (xhr, textStatus) {
        clearResults();
        showMessage($resultsStatus, 'error', 'Search failed',
          describeError(xhr, textStatus) + ' Your search was not lost.',
          function () { runSearch(term); });
      })
      .always(function () {
        setSearching(false);
        $results.attr('aria-busy', 'false').removeClass('is-loading');
      });
  }

  /* Normalize a search doc into the shape the cards use */
  function toSearchBook(doc) {
    if (!doc || !doc.key) return null;          // $.map drops nulls
    const authors = Array.isArray(doc.author_name) ? doc.author_name : [];
    const meta = [];
    if (authors.length) meta.push(authors[0] + (authors.length > 1 ? ' and others' : ''));
    if (doc.first_publish_year) meta.push(doc.first_publish_year);
    return {
      workId: workIdFromKey(doc.key),
      title: doc.title || 'Untitled',
      coverId: doc.cover_i || null,
      authors: authors,
      meta: meta.join(', ')
    };
  }

  function setSearching(isOn) {
    state.searching = isOn;
    $button.prop('disabled', isOn).text(isOn ? 'Searching…' : 'Search');
    $input.prop('readonly', isOn);
    $pager.find('button').prop('disabled', isOn);
  }

  function clearResults() {
    state.results = [];
    $results.empty();
    $summary.prop('hidden', true);
    $indicator.prop('hidden', true);
    $pager.prop('hidden', true).empty();
  }

  /* ==========================================================
     Task 3: Pagination (10 per view, built from the saved results)
     ========================================================== */
  function totalPages() {
    return Math.ceil(state.results.length / PER_PAGE);
  }

  function renderPage(page, numFound) {
    const pages = totalPages();
    state.page = Math.min(Math.max(page, 1), pages);

    const start = (state.page - 1) * PER_PAGE;
    const pageBooks = state.results.slice(start, start + PER_PAGE);

    $results.empty();
    $.each(pageBooks, function (i, book) {
      $results.append(buildBookCard(book, 'Search results'));
    });

    // Current-view indicator and summary
    $indicator.text(`Page ${state.page} of ${pages}`).prop('hidden', false);
    let summary = `Showing ${start + 1}–${start + pageBooks.length} of ${state.results.length} ` +
                  `result${state.results.length === 1 ? '' : 's'} for "${state.term}"`;
    if (numFound !== undefined) state.numFound = numFound;
    if (state.numFound > MAX_RESULTS) {
      summary += ` (first ${MAX_RESULTS} of ${Number(state.numFound).toLocaleString()} matches)`;
    }
    $summary.text(summary).prop('hidden', false);

    renderPager(pages);
  }

  /* Previous, numbered views, Next. Only the views that are needed are shown. */
  function renderPager(pages) {
    $pager.empty();
    if (pages <= 1) { $pager.prop('hidden', true); return; }

    $('<button type="button" class="page-btn">').text('Previous')
      .attr('data-page', state.page - 1).prop('disabled', state.page === 1).appendTo($pager);

    for (let p = 1; p <= pages; p++) {
      const $b = $('<button type="button" class="page-btn page-num">')
        .text(p).attr({ 'data-page': p, 'aria-label': `Page ${p} of ${pages}` });
      if (p === state.page) $b.addClass('is-current').attr('aria-current', 'page');
      $pager.append($b);
    }

    $('<button type="button" class="page-btn">').text('Next')
      .attr('data-page', state.page + 1).prop('disabled', state.page === pages).appendTo($pager);

    $pager.prop('hidden', false);
  }

  $pager.on('click', '.page-btn', function () {
    const page = Number($(this).attr('data-page'));
    if (!page || page === state.page || state.searching) return;
    renderPage(page);
    // Bring the top of the results back into view on small screens
    const top = $('#resultsSection').offset().top - ($('header').css('position') === 'sticky' ? $('header').outerHeight() + 12 : 12);
    if ($(window).scrollTop() > top) $('html, body').animate({ scrollTop: top }, 200);
  });

  /* ==========================================================
     Task 4: Selected-book details
     ========================================================== */
  $('#results, #collection').on('click', '.book-card', function () {
    const book = $(this).data('book');
    const source = $(this).data('source');
    selectBook(book, source);
  });

  function selectBook(book, source) {
    if (!book || !book.workId) return;
    state.selectedId = book.workId;
    $('.book-card').removeClass('is-selected');
    $(`.book-card`).filter(function () { return $(this).data('book').workId === book.workId; }).addClass('is-selected');

    // Cancel a slower request for a book the user already moved on from
    if (state.detailsRequest) state.detailsRequest.abort();

    if (detailsCache[book.workId]) {
      renderDetails(book, source, detailsCache[book.workId]);
      focusDetails();
      return;
    }

    $details.prop('hidden', true);
    showMessage($detailsStatus, 'loading', 'Loading book details…', `Getting "${book.title}" from Open Library.`);
    focusDetails();

    const request = ajaxJSON(`${API}/works/${encodeURIComponent(book.workId)}.json`);
    state.detailsRequest = request;

    request
      .then(followRedirect)
      .then(function (work) {
        return loadAuthors(work, book).then(function (authors) {
          return { work: work, authors: authors };
        });
      })
      .done(function (result) {
        if (state.selectedId !== book.workId) return;   // user picked another book meanwhile
        detailsCache[book.workId] = result;
        renderDetails(book, source, result);
      })
      .fail(function (xhr, textStatus) {
        if (textStatus === 'abort' || state.selectedId !== book.workId) return;
        $details.prop('hidden', true);
        showMessage($detailsStatus, 'error', 'Could not load book details',
          describeError(xhr, textStatus), function () { selectBook(book, source); });
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

  /* Reuse author names from the search or collection data when we have them.
     Otherwise look up to 3 author records from the work's author keys. */
  function loadAuthors(work, book) {
    if (book.authors && book.authors.length) {
      return $.Deferred().resolve(book.authors).promise();
    }
    const keys = $.map(Array.isArray(work.authors) ? work.authors : [], function (a) {
      return (a && a.author && a.author.key) || (a && a.key) || null;
    }).slice(0, 3);
    if (!keys.length) return $.Deferred().resolve([]).promise();

    const names = [];
    const lookups = $.map(keys, function (key, i) {
      const done = $.Deferred();
      ajaxJSON(`${API}${key}.json`)
        .done(function (a) { if (a && a.name) names[i] = a.name; })
        .always(function () { done.resolve(); });     // one failed author never breaks the details
      return done.promise();
    });
    return $.when.apply($, lookups).then(function () {
      return $.grep(names, Boolean);
    });
  }

  /* Description arrives as plain text OR as { type, value } */
  function getDescription(desc) {
    let text = '';
    if (typeof desc === 'string') text = desc;
    else if (desc && typeof desc === 'object' && typeof desc.value === 'string') text = desc.value;
    return cleanDescription(text);
  }

  /* Strip Open Library's markdown leftovers (source links, "contained in" lists) */
  function cleanDescription(text) {
    return text
      .split(/\r?\n-{3,}\r?\n/)[0]
      .replace(/^\s*\[\d+\]:.*$/gm, '')
      .replace(/\(\[source\]\[\d+\]\)/gi, '')
      .replace(/\[([^\]]+)\]\[\d+\]/g, '$1')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
      .trim();
  }

  function renderDetails(book, source, result) {
    const work = result.work || {};
    const workId = workIdFromKey(work.key) || book.workId;
    const title = work.title || book.title || 'Untitled';

    // Cover: work record first, then the cover from the card
    $('#detailCover').empty().append(buildCover(firstCoverId(work.covers) || book.coverId, title, 'L'));

    $('#detailSource').text(`Selected from: ${source}`);
    $('#detailTitle').text(title);
    $('#detailAuthors')
      .text(result.authors.length ? 'by ' + result.authors.join(', ') : 'Author information is not available.')
      .toggleClass('fallback', !result.authors.length);
    $('#detailWorkId').text(workId);
    $('#detailPublished').text(work.first_publish_date || 'Not listed');

    // Description with fallback
    const description = getDescription(work.description);
    const $desc = $('#detailDescription').empty();
    if (description) {
      $.each(description.split(/\r?\n\s*\r?\n/), function (i, para) {
        if ($.trim(para)) $('<p>').text($.trim(para)).appendTo($desc);
      });
    } else {
      $('<p class="fallback">').text('No description is available for this book on Open Library.').appendTo($desc);
    }

    // Up to 10 subjects
    const subjects = Array.isArray(work.subjects) ? work.subjects.slice(0, MAX_SUBJECTS) : [];
    const $subjects = $('#detailSubjects').empty();
    if (subjects.length) {
      $.each(subjects, function (i, s) { $('<li class="tag">').text(s).appendTo($subjects); });
    } else {
      $('<li class="fallback">').text('No subjects are listed for this book.').appendTo($subjects);
    }

    $('#detailLink').attr('href', `${API}/works/${workId}`);

    $detailsStatus.empty();
    $details.prop('hidden', false);
  }

  /* On narrow screens the details sit below the results, so scroll to them */
  function focusDetails() {
    if (window.matchMedia('(max-width: 900px)').matches) {
      const offset = $('header').css('position') === 'sticky' ? $('header').outerHeight() + 12 : 12;
      $('html, body').animate({ scrollTop: $detailsPanel.offset().top - offset }, 250);
    }
  }

  /* ==========================================================
     Task 5: Predefined collection (Open Library Subjects API)
     ========================================================== */
  function loadCollection() {
    showMessage($collectionStatus, 'loading', `Loading the ${COLLECTION.label} collection…`, '');
    $collection.attr('aria-busy', 'true').empty();
    $('#collectionCount').text('');

    ajaxJSON(`${API}/subjects/${COLLECTION.slug}.json`, { limit: COLLECTION.limit })
      .done(function (data) {
        const works = (data && Array.isArray(data.works)) ? data.works.slice(0, COLLECTION.limit) : [];
        const books = $.map(works, toCollectionBook);

        if (!books.length) {
          showMessage($collectionStatus, 'info', 'This collection is empty right now',
            `Open Library returned no ${COLLECTION.label} books. Try again later.`,
            loadCollection);
          return;
        }
        $collectionStatus.empty();
        $.each(books, function (i, book) {
          $collection.append(buildBookCard(book, `${COLLECTION.label} collection`));
        });
        $('#collectionCount').text(`${books.length} book${books.length === 1 ? '' : 's'}`);
      })
      .fail(function (xhr, textStatus) {
        showMessage($collectionStatus, 'error', 'The collection could not be loaded',
          describeError(xhr, textStatus), loadCollection);
      })
      .always(function () {
        $collection.attr('aria-busy', 'false');
      });
  }

  /* Subject works use cover_id and an authors array of { key, name } */
  function toCollectionBook(work) {
    if (!work || !work.key) return null;
    const authors = $.map(Array.isArray(work.authors) ? work.authors : [], function (a) {
      return (a && a.name) || null;
    });
    const meta = [];
    if (authors.length) meta.push(authors[0] + (authors.length > 1 ? ' and others' : ''));
    if (work.first_publish_year) meta.push(work.first_publish_year);
    return {
      workId: workIdFromKey(work.key),
      title: work.title || 'Untitled',
      coverId: work.cover_id || null,
      authors: authors,
      meta: meta.join(', ')
    };
  }

  loadCollection();
});
