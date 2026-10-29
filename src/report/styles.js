// The report's styles, shared with the web app (docs/app), so both look the same in light and
// dark. Colors: --s1 / --s2 are the two targets (blue, green), --tie for ties, --r1..--r3 cost roles.
export const REPORT_CSS = `:root{color-scheme:light;--bg:#f9f9f7;--fg:#0b0b0b;--fg2:#52514e;--muted:#6a6964;--card:#fcfcfb;--line:#e1e0d9;--axis:#c3c2b7;--ok:#006300;--bad:#b42318;--accent:#1c5cab;
  --s1:#2a78d6;--s2:#00873c;--tie:#c3c2b7;--r1:#1baf7a;--r2:#eda100;--r3:#e87ba4;--s1w:#eaf2fc;--s2w:#e5f3ea;--u:#f1f0ec;--band:#1baf7a22}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#0d0d0d;--fg:#f0efec;--fg2:#c3c2b7;--muted:#a3a29b;--card:#1a1a19;--line:#2c2c2a;--axis:#383835;--ok:#0ca30c;--bad:#ff8a80;--accent:#7fb0ef;
  --s1:#3987e5;--s2:#00873c;--tie:#5b5a55;--r1:#199e70;--r2:#c98500;--r3:#d55181;--s1w:#18263a;--s2w:#13281b;--u:#262624;--band:#199e7033}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.5rem;margin:0}.back{margin:0 0 10px;font-size:.9rem}.back a{color:var(--accent);text-decoration:none}.back a:hover{text-decoration:underline}.subhead{font-size:1.1rem;color:var(--accent);margin:2px 0 8px;font-weight:500}h2{font-size:1.15rem;margin:34px 0 6px}h3{font-size:1rem;margin:18px 0 6px}
.muted{color:var(--muted)}.small{font-size:.85rem}.lead{color:var(--fg2);margin:0 0 10px}
.banner{border:2px solid var(--bad);color:var(--bad);border-radius:10px;padding:8px 12px;margin:12px 0}
table{border-collapse:collapse;width:100%;margin:8px 0;background:var(--card)}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}
td{font-variant-numeric:tabular-nums}td.best{font-weight:700}.dir{display:block;font-weight:400;font-size:.75rem;color:var(--muted)}
.verdict{background:var(--card);border:1px solid var(--line);border-left:6px solid var(--muted);border-radius:10px;padding:4px 18px 8px;margin:16px 0}
.verdict.clear{border-left-color:var(--ok)}.verdict.leaning{border-left-color:var(--accent)}.verdict h2{margin:12px 0 4px;font-size:1.3rem}.verdict ul{margin:4px 0 8px;padding-left:20px}
.value{margin:6px 0}
.notes{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:2px 18px 10px;margin:16px 0}.notes h2{margin-top:12px}.notes h3,.notes h4{margin:14px 0 4px}.notes ul{padding-left:20px}
ul.findings{padding-left:20px}ul.findings li{margin:4px 0}ul.findings li.f-case,ul.findings li.f-check{color:var(--fg)}ul.findings li.f-case::marker,ul.findings li.f-check::marker{color:var(--bad)}
.tcards{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.tcard{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:4px 14px 10px}
.tcard h3{display:flex;align-items:center;gap:8px}.sw{display:inline-block;width:12px;height:12px;border-radius:3px}
pre{white-space:pre-wrap;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:.82rem}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;margin:6px 0;font-size:.85rem;color:var(--fg2)}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;vertical-align:0}
.chart{width:100%;height:auto;display:block;overflow:visible}.chart text{font:12px system-ui,-apple-system,"Segoe UI",sans-serif}
.chart .lab{fill:var(--fg2)}.chart .tick{fill:var(--muted);font-size:11px}.chart .val{fill:var(--fg);font-variant-numeric:tabular-nums}.chart .in{fill:#fff;font-weight:600}.chart .in.dark{fill:#0b0b0b}
@media (prefers-color-scheme:dark){.chart .in.dark{fill:#f0efec}}
.chart .ref,.chart .axis{stroke:var(--axis);stroke-width:1}.chart .grid{stroke:var(--line);stroke-width:1}.chart .limit{stroke:var(--bad);stroke-width:1.5;stroke-dasharray:4 3}
.chart .band{fill:var(--band)}.chart .dot{stroke:var(--card);stroke-width:2}.chart [data-tip]{cursor:default}.chart [data-tip]:hover{opacity:.85}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px 22px;margin:8px 0}
.mini{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px}.mini figcaption{font-size:.9rem;font-weight:600;margin-bottom:6px}
.mini .note{font-size:.78rem;color:var(--muted);margin:4px 0 0}
.tiles{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 14px;min-width:200px;display:flex;flex-direction:column}
.tile .k{font-size:.85rem;color:var(--fg2)}.tile .v{font-size:1.6rem;font-weight:650}
details.tv{margin:6px 0 0}details.tv summary,details summary{cursor:pointer;color:var(--accent);font-size:.88rem}
details.conv{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:8px 0}details.conv summary{color:var(--fg);font-size:.95rem}
.transcript{display:flex;flex-direction:column;gap:6px;margin:8px 0}
.msg{padding:8px 12px;border-radius:10px;max-width:85%;white-space:pre-wrap}.msg.user{background:var(--u);margin-left:auto}
.msg.s1{background:var(--s1w);border-left:3px solid var(--s1)}.msg.s2{background:var(--s2w);border-left:3px solid var(--s2)}
.msg.alt{margin-top:6px;max-width:100%}.who{display:block;font-size:.75rem;color:var(--muted)}
.note{font-size:.8rem;color:var(--muted);margin-top:4px;white-space:normal}.shadow summary{font-size:.8rem;margin-top:6px}
.checks{list-style:none;padding:0;margin:4px 0}.pass{color:var(--ok)}.fail{color:var(--bad)}
.info{display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border-radius:50%;border:1px solid var(--axis);background:var(--card);color:var(--accent);
  font:italic 700 11px/1 Georgia,serif;cursor:pointer;vertical-align:1px;padding:0;margin-left:2px}.info:hover{border-color:var(--accent)}
.pop{max-width:440px;border:1px solid var(--axis);border-radius:12px;padding:14px 16px;background:var(--card);color:var(--fg);box-shadow:0 8px 30px #0003;font-size:.9rem}
.pop dl,.glossary dl{margin:6px 0 0}.pop dt,.glossary dt{font-weight:650;font-size:.8rem;color:var(--accent);margin-top:6px}.pop dd,.glossary dd{margin:0}
.pop-close{margin-top:10px;border:1px solid var(--line);background:var(--bg);color:var(--fg);border-radius:8px;padding:3px 10px;cursor:pointer}
.glossary{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}.glossary section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:4px 14px 10px}.glossary h3{margin:8px 0 0}
#tip{position:fixed;z-index:10;pointer-events:none;background:var(--fg);color:var(--bg);font-size:.8rem;padding:4px 8px;border-radius:6px;max-width:320px}
ul.cases{padding-left:20px}ul.cases li{margin:3px 0}
details.cases-d{margin:14px 0}details.cases-d>summary{color:var(--fg)}
.v-chart{margin:8px 0 4px}.v-chart .legend{margin-top:0}
.clamp{position:relative;max-height:330px;overflow:hidden}.clamp::after{content:"";position:absolute;left:0;right:0;bottom:0;height:90px;background:linear-gradient(to bottom,transparent,var(--card));pointer-events:none}
.clamp.open{max-height:none}.clamp.open::after{display:none}
.more{border:1px solid var(--line);background:var(--bg);color:var(--accent);border-radius:8px;padding:4px 12px;margin:6px 0 4px;cursor:pointer;font:inherit;font-size:.88rem}
`;
