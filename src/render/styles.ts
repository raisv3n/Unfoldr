// Shared stylesheet for the offline HTML archive.
export const ARCHIVE_CSS = `:root {
  --fg: #1f2328; --muted: #59636e; --bg: #ffffff; --soft: #f6f8fa; --border: #d1d9e0;
  --accent: #0969da; --warn-bg: #fff8c5; --warn-border: #d4a72c; --code-bg: #f6f8fa;
}
@media (prefers-color-scheme: dark) {
  :root { --fg: #e6edf3; --muted: #9198a1; --bg: #0d1117; --soft: #151b23; --border: #3d444d;
    --accent: #4493f8; --warn-bg: #2e2a1a; --warn-border: #9e6a03; --code-bg: #151b23; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 24px 20px 80px; }
a { color: var(--accent); }
a.external::after { content: " ↗"; font-size: 0.8em; }
nav.crumbs { font-size: 14px; color: var(--muted); margin-bottom: 16px; }
h1 { font-size: 2em; line-height: 1.25; margin: 0.2em 0 0.4em; }
h2 { font-size: 1.5em; margin: 1.4em 0 0.4em; } h3 { font-size: 1.25em; margin: 1.2em 0 0.3em; } h4 { font-size: 1.05em; margin: 1em 0 0.3em; }
.meta { font-size: 13px; color: var(--muted); border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 20px; word-break: break-all; }
.meta dt { font-weight: 600; display: inline; } .meta dd { display: inline; margin: 0 12px 0 4px; }
.warnings { background: var(--warn-bg); border: 1px solid var(--warn-border); border-radius: 6px; padding: 8px 14px; font-size: 14px; margin-bottom: 20px; }
.warnings summary { cursor: pointer; font-weight: 600; }
p { margin: 0.5em 0; }
ul, ol { padding-left: 1.6em; margin: 0.4em 0; }
ul.todo { list-style: none; padding-left: 0.4em; } ul.todo input { margin-right: 0.5em; }
blockquote { margin: 0.8em 0; padding: 0 1em; border-left: 3px solid var(--border); color: var(--muted); }
pre { background: var(--code-bg); padding: 12px 14px; border-radius: 6px; overflow-x: auto; font-size: 14px; line-height: 1.45; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
:not(pre) > code { background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 4px; }
hr { border: 0; border-top: 1px solid var(--border); margin: 1.5em 0; }
table { border-collapse: collapse; width: 100%; margin: 0.8em 0; font-size: 14px; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: var(--soft); }
figure { margin: 1em 0; } figure img { max-width: 100%; height: auto; border-radius: 4px; }
figcaption { font-size: 14px; color: var(--muted); margin-top: 4px; }
details { margin: 0.4em 0; padding: 0.2em 0 0.2em 0.2em; }
details > summary { cursor: pointer; }
details > summary > h2, details > summary > h3, details > summary > h4 { display: inline; }
details > .toggle-body { padding-left: 1.4em; border-left: 2px solid var(--border); margin-left: 0.3em; }
.callout { display: flex; gap: 10px; background: var(--soft); border-radius: 6px; padding: 12px 14px; margin: 0.8em 0; }
.callout .icon { flex: none; }
.columns { display: flex; gap: 24px; flex-wrap: wrap; } .columns > .column { flex: 1 1 220px; min-width: 0; }
.page-link { margin: 0.3em 0; } .page-link .icon { margin-right: 0.3em; }
.bookmark, .embed { border: 1px solid var(--border); border-radius: 6px; padding: 10px 14px; margin: 0.8em 0; word-break: break-all; }
.embed.video { border: 0; padding: 0; } .video-thumb { position: relative; display: inline-block; max-width: 100%; }
.video-thumb img { display: block; max-width: 100%; border-radius: 6px; }
.video-thumb .play { position: absolute; inset: 0; margin: auto; width: 64px; height: 44px; border-radius: 12px; background: rgba(0,0,0,.7);
  color: #fff; font-size: 22px; line-height: 44px; text-align: center; }
.bookmark .desc { color: var(--muted); font-size: 14px; }
.mention { background: var(--soft); border-radius: 4px; padding: 0 0.25em; }
.equation { overflow-x: auto; }
.missing { color: var(--muted); font-style: italic; }
.synced { border-left: 2px dashed var(--border); padding-left: 10px; }
.database { margin: 1em 0; } .database h3 { margin-top: 0.4em; }
.status { display: inline-block; font-size: 12px; padding: 1px 8px; border-radius: 10px; border: 1px solid var(--border); margin-left: 8px; vertical-align: middle; }
.status.partial { background: var(--warn-bg); border-color: var(--warn-border); }
.backlinks { margin-top: 48px; border-top: 1px solid var(--border); padding-top: 12px; font-size: 14px; }
.tree ul { list-style: none; padding-left: 1.2em; } .tree > ul { padding-left: 0; }
@media print { details > .toggle-body { display: block; } a.external::after { content: ""; } }
`;
