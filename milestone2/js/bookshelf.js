/* ==========================================================
   My Bookshelf
   ========================================================== */
$(async function () {
  /* My picks: only the Work IDs live here. Titles, covers, and
     authors all come from the Open Library API. */
  const SHELF_IDS = [
    'OL16215318W',  // The Tangled Web (Michal Zalewski)
    'OL17308344W',  // Web Scraping with Python (Ryan Mitchell)
    'OL16804365W',  // The Modern Web (Peter Gasston)
    'OL21572859W',  // Modern Web Development (Dino Esposito)
    'OL45804W'      // Fantastic Mr Fox (Roald Dahl), the book from Milestone 1
  ];

  const $status = $('#status');
  const $shelf = $('#shelf');

  showMessage($status, 'loading', 'Loading your bookshelf…', '');

  /* Request every book at once and keep the original order */
  const results = await Promise.allSettled(SHELF_IDS.map(loadBook));

  $status.empty();
  $shelf.empty();
  let loaded = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      loaded++;
      $shelf.append(buildBookCard(result.value));
    } else {
      $shelf.append(
        $('<li class="book-card book-card-error">')
          .append($('<p>').text(`Could not load ${SHELF_IDS[i]} from Open Library.`))
      );
    }
  }

  $('#shelfCount').text(`${loaded} of ${SHELF_IDS.length} books loaded from Open Library`);

  if (loaded === 0) {
    $shelf.empty();
    showMessage($status, 'error', 'Bookshelf unavailable',
      'None of the books could be loaded. Open Library may be down. Refresh the page to try again.');
  }

  async function loadBook(workId) {
    const work = await fetchWork(workId);
    const authors = await getAuthorNames(work.authors, 1);
    const metaParts = [];
    if (authors.length) metaParts.push(authors[0]);
    if (work.first_publish_date) metaParts.push(work.first_publish_date);
    return {
      workId: workIdFromKey(work.key) || workId,
      title: work.title || 'Untitled',
      coverId: firstCoverId(work.covers),
      meta: metaParts.join(', ')
    };
  }
});
