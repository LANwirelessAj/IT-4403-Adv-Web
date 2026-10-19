/* ==========================================================
   Book Details
   ========================================================== */
$(async function () {
  const MAX_SUBJECTS = 10;
  const $status = $('#status');
  const $view = $('#bookView');

  /* Back link returns to the exact search page or the bookshelf when possible */
  $('#backLink').on('click', function (e) {
    if (document.referrer && document.referrer.indexOf(location.origin) === 0 && history.length > 1) {
      e.preventDefault();
      history.back();
    }
  });

  /* 1. Read the Work ID passed in the URL */
  const params = new URLSearchParams(window.location.search);
  const workId = (params.get('id') || '').trim().toUpperCase();

  if (!workId) {
    showMessage($status, 'info', 'No book selected',
      'Search for a book or open one from My Bookshelf to see its details.');
    return;
  }
  if (!/^OL\d+W$/.test(workId)) {
    showMessage($status, 'error', 'Invalid Work ID',
      `"${workId}" is not a valid Open Library Work ID. Work IDs look like OL45804W.`);
    return;
  }

  showMessage($status, 'loading', 'Loading book details…', '');

  /* 2. Build the request URL from the Work ID and fetch the record */
  try {
    const work = await fetchWork(workId);
    const realId = workIdFromKey(work.key) || workId;
    const authors = await getAuthorNames(work.authors, 3);
    $status.empty();
    renderWork(work, realId, authors);
  } catch (err) {
    if (err.status === 404) {
      showMessage($status, 'error', 'Book not found',
        `Open Library has no work with the ID ${workId}.`);
    } else {
      showMessage($status, 'error', 'Could not load this book',
        `The request to Open Library failed (${err.message}). Refresh the page to try again.`);
    }
  }

  /* Description can be a plain string OR an object like { type, value } */
  function getDescription(desc) {
    let text = '';
    if (typeof desc === 'string') text = desc;
    else if (desc && typeof desc === 'object' && typeof desc.value === 'string') text = desc.value;
    return cleanDescription(text);
  }

  /* Removes Open Library's markdown leftovers: source links and "contained in" lists */
  function cleanDescription(text) {
    return text
      .split(/\r?\n-{3,}\r?\n/)[0]
      .replace(/^\s*\[\d+\]:.*$/gm, '')
      .replace(/\(\[source\]\[\d+\]\)/gi, '')
      .replace(/\[([^\]]+)\]\[\d+\]/g, '$1')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
      .trim();
  }

  function renderWork(work, id, authors) {
    const title = work.title || 'Untitled';
    document.title = `${title} | Milestone 2 | Lawrence Ajayi`;

    /* Cover */
    $('#detailCover').empty().append(buildCover(firstCoverId(work.covers), title, 'M'));

    /* Title, authors, quick facts */
    $('#detailTitle').text(title);
    if (work.subtitle) $('#detailSubtitle').text(work.subtitle).prop('hidden', false);
    $('#detailAuthors').text(authors.length ? 'by ' + authors.join(', ') : 'Author not listed');
    $('#detailWorkId').text(id);
    $('#detailPublished').text(work.first_publish_date || 'Not listed');

    /* Description with fallback */
    const description = getDescription(work.description);
    const $desc = $('#detailDescription').empty();
    if (description) {
      description.split(/\r?\n\s*\r?\n/).forEach(para => {
        if (para.trim()) $('<p>').text(para.trim()).appendTo($desc);
      });
    } else {
      $('<p class="fallback">').text('No description is available for this book on Open Library.').appendTo($desc);
    }

    /* Up to 10 subjects; each one starts a new search */
    const subjects = Array.isArray(work.subjects) ? work.subjects.slice(0, MAX_SUBJECTS) : [];
    const $subjects = $('#detailSubjects').empty();
    if (subjects.length) {
      subjects.forEach(subject => {
        $('<li>').append(
          $('<a class="chip">').attr('href', 'index.html?q=' + encodeURIComponent(subject)).text(subject)
        ).appendTo($subjects);
      });
    } else {
      $('<li class="fallback">').text('No subjects listed.').appendTo($subjects);
    }

    /* Link to the book's Open Library page */
    $('#detailLink').attr('href', `${OL.api}/works/${id}`);

    $view.prop('hidden', false);
  }
});
