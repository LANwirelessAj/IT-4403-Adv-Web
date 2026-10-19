<?php
// Lab 4 Part 3 (optional): consume a REST service with PHP.
// PHP requests the JSON on the server, so the browser never calls the API directly.
const API = 'https://jsonplaceholder.typicode.com';

function get_json(string $url): ?array {
    $context = stream_context_create(['http' => ['timeout' => 10, 'header' => "Accept: application/json\r\n"]]);
    $body = @file_get_contents($url, false, $context);
    if ($body === false) return null;
    $data = json_decode($body, true);
    return is_array($data) ? $data : null;
}

function e($value): string {
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

$postId = filter_input(INPUT_GET, 'postId', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 100]]) ?: 1;

// Mashup: three requests combined into one page
$post     = get_json(API . "/posts/$postId");
$user     = $post ? get_json(API . '/users/' . (int) $post['userId']) : null;
$comments = get_json(API . "/posts/$postId/comments");
$failed   = $post === null || $comments === null;
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Part 3: PHP REST Client | Lab 4: RESTful Web APIs | Lawrence Ajayi</title>
<style>
  :root { --bg:#0f172a; --panel:#1e293b; --panel2:#273449; --text:#e2e8f0; --heading:#f8fafc; --link:#7dd3fc; --muted:#94a3b8; --line:#334155; --good:#4ade80; --bad:#f87171; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI', Arial, sans-serif; background:var(--bg); color:var(--text); line-height:1.6; }
  a { color:var(--link); text-decoration:none; } a:hover { text-decoration:underline; }
  a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible { outline:3px solid var(--link); outline-offset:2px; }
  header { background:var(--panel); padding:1rem 2rem; position:sticky; top:0; z-index:100; }
  .nav-container { display:flex; justify-content:space-between; align-items:center; max-width:1100px; margin:0 auto; gap:1rem; flex-wrap:wrap; }
  .site-title { font-size:1.3rem; font-weight:bold; color:var(--heading); }
  header nav ul { list-style:none; display:flex; gap:1.5rem; flex-wrap:wrap; }
  header nav a { color:var(--text); font-weight:500; }
  main { max-width:1100px; margin:0 auto; padding:2rem 2rem 3rem; }
  .crumbs { list-style:none; display:flex; flex-wrap:wrap; gap:.4rem; font-size:.9rem; color:var(--muted); margin-bottom:1.25rem; }
  .crumbs li + li::before { content:"/"; margin-right:.4rem; }
  h1 { font-size:clamp(1.7rem,4vw,2.3rem); line-height:1.2; color:var(--heading); margin-bottom:.4rem; }
  h2 { font-size:1.3rem; color:var(--heading); margin-bottom:.75rem; }
  h3 { font-size:1.05rem; color:var(--heading); margin-bottom:.5rem; }
  .lead { color:var(--muted); max-width:75ch; margin-bottom:2rem; }
  .card { background:var(--panel); border-radius:8px; padding:1.5rem; margin-bottom:1.5rem; }
  .card p + p { margin-top:.6rem; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:1.25rem; }
  button { font:inherit; font-weight:600; cursor:pointer; background:var(--link); color:var(--bg); border:0; border-radius:6px; padding:.5rem 1rem; }
  button:hover { background:#bae6fd; }
  button.alt { background:transparent; color:var(--link); border:2px solid var(--link); }
  button.alt:hover { background:var(--panel2); }
  .controls { display:flex; flex-wrap:wrap; gap:.5rem; margin:1rem 0; }
  pre { background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:1rem; overflow-x:auto; font:0.85rem/1.5 Consolas, 'Courier New', monospace; color:#cbd5e1; }
  code { font-family:Consolas, 'Courier New', monospace; background:var(--bg); padding:0 .3rem; border-radius:4px; font-size:.9em; }
  pre code { padding:0; background:none; font-size:inherit; }
  .out { background:var(--panel2); border-left:4px solid var(--link); border-radius:6px; padding:.75rem 1rem; margin-top:.75rem; min-height:2.6rem; }
  .muted { color:var(--muted); }
  .ok { color:var(--good); } .err { color:var(--bad); }
  label { display:block; font-weight:600; color:var(--muted); font-size:.9rem; margin-bottom:.25rem; }
  input, select { font:inherit; width:100%; background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:6px; padding:.5rem .7rem; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:.6rem .8rem; border-bottom:1px solid var(--line); }
  th { color:var(--heading); background:var(--panel2); }
  dl.facts div { display:grid; grid-template-columns:10rem 1fr; gap:1rem; padding:.5rem 0; border-bottom:1px solid var(--line); }
  dl.facts dt { color:var(--muted); font-weight:600; }
  ul.clean { list-style:none; } ul.clean li { padding:.35rem 0; border-bottom:1px solid var(--line); }
  footer { text-align:center; padding:2rem; background:var(--panel); color:var(--muted); font-size:.9rem; }
  @media (max-width:600px) { dl.facts div { grid-template-columns:1fr; gap:0; } main { padding:1.5rem 1rem; } }


  .status { padding:1rem 1.25rem; background:var(--panel2); border-left:4px solid var(--link); border-radius:6px; margin-bottom:1.5rem; }
  .status.error { border-left-color:var(--bad); }
  .status.error strong { color:var(--bad); }
  .endpoint { font-size:.9rem; color:var(--muted); margin-top:.75rem; overflow-wrap:anywhere; }
  .flow { display:flex; flex-wrap:wrap; gap:.4rem; align-items:center; font-size:.9rem; }
  .flow span { background:var(--panel2); border:1px solid var(--line); border-radius:999px; padding:.15rem .7rem; }
  .flow b { color:var(--muted); font-weight:400; }
  .post-body { white-space:pre-line; }
  .comment { padding:1rem 0; border-bottom:1px solid var(--line); }
  .comment:last-child { border-bottom:0; }
  .comment h3 { text-transform:capitalize; margin-bottom:.15rem; }
  .comment .who { color:var(--muted); font-size:.9rem; margin-bottom:.4rem; }
  .post-nav { display:flex; gap:1rem; flex-wrap:wrap; margin-top:1rem; font-weight:600; }
</style>
</head>
<body>
<header>
  <div class="nav-container">
    <div class="site-title">Lawrence Ajayi</div>
    <nav aria-label="Main navigation">
      <ul>
        <li><a href="../index.html">Home</a></li>
        <li><a href="../index.html#labs">Lab Work</a></li>
        <li><a href="../index.html#milestones">Project</a></li>
        <li><a href="../index.html#contact">Contact</a></li>
      </ul>
    </nav>
  </div>
</header>
<main id="main">
  <nav aria-label="Breadcrumb">
    <ol class="crumbs">
      <li><a href="../index.html">Home</a></li>
      <li><a href="../index.html#lab4">Lab 4: RESTful Web APIs</a></li>
      <li aria-current="page">Part 3 (PHP)</li>
    </ol>
  </nav>
  <h1>Part 3: Consume a REST Service with PHP</h1>
  <p class="lead">Optional part. This page is built on the server by PHP, which requests JSON from JSONPlaceholder and combines a post, its author, and its comments.</p>
<?php if ($failed): ?>
  <div class="status error" role="alert"><strong>Could not load data.</strong> The server could not reach the JSONPlaceholder API. Refresh the page to try again.</div>
<?php else: ?>
  <section class="card" aria-labelledby="h-post">
    <h2 id="h-post" style="text-transform:capitalize"><?= e($post['title']) ?></h2>
    <p class="muted">Post <?= e($post['id']) ?><?php if ($user): ?> by <?= e($user['name']) ?> (<a href="mailto:<?= e($user['email']) ?>"><?= e($user['email']) ?></a>), <?= e($user['company']['name'] ?? '') ?><?php endif; ?></p>
    <p class="post-body" style="margin-top:.75rem"><?= e($post['body']) ?></p>
    <p class="post-nav">
      <?php if ($postId > 1): ?><a href="?postId=<?= $postId - 1 ?>">&larr; Previous post</a><?php endif; ?>
      <?php if ($postId < 100): ?><a href="?postId=<?= $postId + 1 ?>">Next post &rarr;</a><?php endif; ?>
    </p>
  </section>

  <section class="card" aria-labelledby="h-comments">
    <h2 id="h-comments">Comments (<?= count($comments) ?>)</h2>
<?php foreach ($comments as $comment): ?>
    <article class="comment">
      <h3><?= e($comment['id']) ?>. <?= e($comment['name']) ?></h3>
      <p class="who"><?= e($comment['email']) ?></p>
      <p class="post-body"><?= e($comment['body']) ?></p>
    </article>
<?php endforeach; ?>
  </section>
<?php endif; ?>

  <section class="card" aria-labelledby="h-how">
    <h2 id="h-how">How this page works</h2>
    <p>PHP sends three GET requests on the server with <code>file_get_contents()</code>: the post (<code>/posts/<?= $postId ?></code>), its author (<code>/users/<?= $post ? (int) $post['userId'] : 1 ?></code>), and its comments (<code>/posts/<?= $postId ?>/comments</code>). It decodes each JSON response with <code>json_decode()</code>, combines them, and sends finished HTML to the browser. That makes this a small mashup of related resources.</p>
    <p><strong>Changes from the instructor example:</strong> The original used <code>http://</code>, printed the raw JSON straight into a JavaScript variable, and built the page in the browser with an undeclared loop variable and no escaping. This version uses <code>https://</code>, renders the page in PHP, escapes all API text with <code>htmlspecialchars()</code>, and shows an error message if the API cannot be reached.</p>
    <p class="endpoint"><a href="instructor-examples/jsonplaceholder-getcomments.php">View the original instructor example</a></p>
  </section>
</main>
<footer>
  <p>Lab 4: RESTful Web APIs, Part 3 | IT 4403, Kennesaw State University</p>
  <p><a href="../index.html#lab4">Back to Lab 4: RESTful Web APIs</a></p>
</footer>

</body>
</html>
